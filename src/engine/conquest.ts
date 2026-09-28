import { Db } from 'mongodb';
import { HexTile, Player, ActionLog, CombatResult } from '../models/types.js';
import { parseCoordinateId, getNeighborIds } from './coordinates.js';
import { spendAP } from './ap.js';

export class ConquestService {
  /**
   * Claim an unoccupied tile (Cost: 1 AP)
   */
  static async claimTile(
    db: Db,
    playerId: string,
    tileId: string
  ): Promise<{ tile: HexTile; remainingAP: number }> {
    const tile = await db.collection<HexTile>('tiles').findOne({ _id: tileId });
    if (!tile) {
      throw new Error(`Tile "${tileId}" does not exist.`);
    }

    if (tile.owner_id !== null) {
      throw new Error(`Tile "${tileId}" is already claimed by ${tile.owner_id}.`);
    }

    // Check territorial contiguity if player already owns tiles
    const ownedTilesCount = await db.collection<HexTile>('tiles').countDocuments({
      owner_id: playerId,
    });

    if (ownedTilesCount > 0) {
      const neighborIds = getNeighborIds(tile);
      const adjacentFriendly = await db.collection<HexTile>('tiles').countDocuments({
        _id: { $in: neighborIds },
        owner_id: playerId,
      });

      if (adjacentFriendly === 0) {
        throw new Error('New claims must be adjacent to existing friendly territory.');
      }
    }

    // Deduct 1 AP atomically
    const { remainingAP } = await spendAP(db, playerId, 1);

    // Atomically claim the tile
    const updateResult = await db.collection<HexTile>('tiles').findOneAndUpdate(
      { _id: tileId, owner_id: null },
      {
        $set: {
          owner_id: playerId,
          defense_power: 1,
          last_modified: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      // Rollback AP if another player claimed at the same instant
      await db.collection<Player>('players').updateOne(
        { _id: playerId },
        { $inc: { ap_current: 1 } }
      );
      throw new Error('Failed to claim: Tile was claimed by another player.');
    }

    // Record action log
    await db.collection<ActionLog>('action_logs').insertOne({
      player_id: playerId,
      action_type: 'CLAIM',
      target_tile_id: tileId,
      details: { ap_spent: 1, outcome: 'SUCCESS' },
      timestamp: new Date(),
    });

    return { tile: updateResult, remainingAP };
  }

  /**
   * Fortify a friendly tile (Cost: 1 AP, +1 Defense up to 10)
   */
  static async fortifyTile(
    db: Db,
    playerId: string,
    tileId: string
  ): Promise<{ tile: HexTile; remainingAP: number }> {
    const tile = await db.collection<HexTile>('tiles').findOne({ _id: tileId });
    if (!tile) {
      throw new Error(`Tile "${tileId}" does not exist.`);
    }

    if (tile.owner_id !== playerId) {
      throw new Error(`Cannot fortify: You do not own tile "${tileId}".`);
    }

    if (tile.defense_power >= 10) {
      throw new Error(`Tile "${tileId}" has already reached the maximum defense cap (10).`);
    }

    // Deduct 1 AP atomically
    const { remainingAP } = await spendAP(db, playerId, 1);

    // Atomically fortify
    const updateResult = await db.collection<HexTile>('tiles').findOneAndUpdate(
      {
        _id: tileId,
        owner_id: playerId,
        defense_power: { $lt: 10 },
      },
      {
        $inc: { defense_power: 1 },
        $set: { last_modified: new Date() },
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      // Rollback AP if state changed
      await db.collection<Player>('players').updateOne(
        { _id: playerId },
        { $inc: { ap_current: 1 } }
      );
      throw new Error('Fortification failed: Defense cap reached or ownership changed.');
    }

    // Record action log
    await db.collection<ActionLog>('action_logs').insertOne({
      player_id: playerId,
      action_type: 'FORTIFY',
      target_tile_id: tileId,
      details: { ap_spent: 1, outcome: 'SUCCESS' },
      timestamp: new Date(),
    });

    return { tile: updateResult, remainingAP };
  }

  /**
   * Launch Attack on an adjacent enemy tile (Cost: 2 AP)
   * Resolves flanking bonus, captures, morale boost, and defender elimination.
   */
  static async attackTile(
    db: Db,
    playerId: string,
    targetTileId: string
  ): Promise<{ combat: CombatResult; tile: HexTile; remainingAP: number }> {
    const targetTile = await db.collection<HexTile>('tiles').findOne({ _id: targetTileId });
    if (!targetTile) {
      throw new Error(`Target tile "${targetTileId}" does not exist.`);
    }

    if (!targetTile.owner_id) {
      throw new Error(`Cannot attack unowned tile "${targetTileId}". Use claim instead.`);
    }

    if (targetTile.owner_id === playerId) {
      throw new Error(`Cannot attack your own tile "${targetTileId}". Use fortify instead.`);
    }

    const defenderId = targetTile.owner_id;
    const neighborIds = getNeighborIds(targetTile);

    // Find all friendly neighbors adjacent to target
    const friendlyNeighbors = await db
      .collection<HexTile>('tiles')
      .find({
        _id: { $in: neighborIds },
        owner_id: playerId,
      })
      .toArray();

    if (friendlyNeighbors.length === 0) {
      throw new Error('Cannot attack: You have no adjacent friendly tiles surrounding this target.');
    }

    // Flanking Multiplier / Attack Power:
    // Total Attack Power = Sum of Defense of all friendly tiles adjacent to target
    const attackPower = friendlyNeighbors.reduce(
      (sum, t) => sum + (t.defense_power || 1),
      0
    );
    const targetDefense = targetTile.defense_power;

    // Deduct 2 AP
    const { remainingAP } = await spendAP(db, playerId, 2);

    const isVictory = attackPower > targetDefense;

    if (!isVictory) {
      // Repelled!
      await db.collection<ActionLog>('action_logs').insertOne({
        player_id: playerId,
        action_type: 'ATTACK',
        target_tile_id: targetTileId,
        details: {
          ap_spent: 2,
          attack_power: attackPower,
          target_defense: targetDefense,
          outcome: 'DEFEAT',
          previous_owner: defenderId,
        },
        timestamp: new Date(),
      });

      return {
        combat: {
          victory: false,
          attackPower,
          targetDefense,
          excessForce: 0,
          moraleBoostedTiles: [],
          defenderEliminated: false,
          defenderId,
        },
        tile: targetTile,
        remainingAP,
      };
    }

    // VICTORY: Calculate excess force capped at 10 (minimum 1)
    const excessForce = Math.min(10, Math.max(1, attackPower - targetDefense));

    // 1. Update captured tile owner and remaining defense
    const capturedTile = await db.collection<HexTile>('tiles').findOneAndUpdate(
      { _id: targetTileId, owner_id: defenderId },
      {
        $set: {
          owner_id: playerId,
          defense_power: excessForce,
          last_modified: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!capturedTile) {
      // Race condition occurred
      throw new Error('Target tile ownership changed during attack resolution.');
    }

    // 2. Boost morale defense of surviving friendly adjacent tiles (+1 defense, capped at 10)
    const boostedIds = friendlyNeighbors
      .filter((t) => t.defense_power < 10)
      .map((t) => t._id);

    if (boostedIds.length > 0) {
      await db.collection<HexTile>('tiles').updateMany(
        {
          _id: { $in: boostedIds },
          owner_id: playerId,
          defense_power: { $lt: 10 },
        },
        {
          $inc: { defense_power: 1 },
          $set: { last_modified: new Date() },
        }
      );
    }

    // 3. Elimination Check: Count defender's remaining tiles
    const defenderRemainingTiles = await db.collection<HexTile>('tiles').countDocuments({
      owner_id: defenderId,
    });

    let defenderEliminated = false;
    if (defenderRemainingTiles === 0) {
      defenderEliminated = true;
      await db.collection<Player>('players').updateOne(
        { _id: defenderId },
        {
          $set: {
            status: 'ELIMINATED',
          },
        }
      );
    }

    const combatResult: CombatResult = {
      victory: true,
      attackPower,
      targetDefense,
      excessForce,
      moraleBoostedTiles: boostedIds,
      defenderEliminated,
      defenderId,
    };

    // Log the event
    await db.collection<ActionLog>('action_logs').insertOne({
      player_id: playerId,
      action_type: 'ATTACK',
      target_tile_id: targetTileId,
      details: {
        ap_spent: 2,
        attack_power: attackPower,
        target_defense: targetDefense,
        excess_force: excessForce,
        outcome: 'VICTORY',
        previous_owner: defenderId,
        eliminated_player_id: defenderEliminated ? defenderId : null,
        morale_boosted_tiles: boostedIds,
      },
      timestamp: new Date(),
    });

    return {
      combat: combatResult,
      tile: capturedTile,
      remainingAP,
    };
  }

  /**
   * Register a new player and automatically assign a spawn tile.
   */
  static async registerPlayer(
    db: Db,
    username: string,
    colorHex: string
  ): Promise<{ player: Player; spawnTile: HexTile }> {
    const existing = await db.collection<Player>('players').findOne({ username });
    if (existing) {
      throw new Error(`Username "${username}" is already taken.`);
    }

    const playerId = `player_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();

    const newPlayer: Player = {
      _id: playerId,
      username,
      color_hex: colorHex || '#3b82f6',
      ap_current: 12, // Start with maximum AP
      last_ap_tick: now,
      status: 'ACTIVE',
      created_at: now,
    };

    // Find an unoccupied tile to spawn on (preferably non-center, perimeter tile or any unowned plain)
    const availableTiles = await db
      .collection<HexTile>('tiles')
      .find({ owner_id: null, terrain: { $ne: 'CAPITAL' } })
      .toArray();

    if (availableTiles.length === 0) {
      throw new Error('Game board is full! No available tiles to spawn.');
    }

    // Pick a random available tile
    const spawnChoice = availableTiles[Math.floor(Math.random() * availableTiles.length)];

    await db.collection<Player>('players').insertOne(newPlayer);

    const claimedTile = await db.collection<HexTile>('tiles').findOneAndUpdate(
      { _id: spawnChoice._id, owner_id: null },
      {
        $set: {
          owner_id: playerId,
          defense_power: 3, // Spawn bonus defense
          last_modified: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!claimedTile) {
      throw new Error('Spawn conflict: Selected tile was taken. Please retry registration.');
    }

    await db.collection<ActionLog>('action_logs').insertOne({
      player_id: playerId,
      action_type: 'SPAWN',
      target_tile_id: claimedTile._id,
      details: { ap_spent: 0, outcome: 'SUCCESS' },
      timestamp: now,
    });

    return { player: newPlayer, spawnTile: claimedTile };
  }
}
