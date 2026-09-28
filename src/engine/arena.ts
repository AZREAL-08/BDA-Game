import { Db } from 'mongodb';
import { ArenaMatch, ArenaPlayer, HexTile, CombatResult, TerrainType } from '../models/types.js';
import { generateHexDisk, formatCoordinateId, getNeighborCoordinates } from './coordinates.js';
import { calculateLazyAP } from './ap.js';

export const ARENA_RADIUS = 3; // 37 tiles
export const COMBAT_COOLDOWN_MS = 3000; // 3s combat fatigue cooldown

export function getFortifyCost(currentDefense: number): number {
  if (currentDefense < 4) return 1; // 1-3 defense: 1 AP
  if (currentDefense < 7) return 2; // 4-6 defense: 2 AP
  return 3;                         // 7-9 defense: 3 AP
}

export function getTerrainDefenseBonus(terrain: TerrainType): number {
  if (terrain === 'MOUNTAIN') return 3; // High ground advantage
  if (terrain === 'CAPITAL') return 3;  // Fortified citadel
  return 0;
}

/**
 * Computes connected supply lines back to the player's spawn base.
 * Any tile not connected through a continuous chain of friendly tiles is isolated.
 */
export function computeSupplyLines(
  tiles: HexTile[],
  baseCoordId: string,
  playerId: string
): Set<string> {
  const connected = new Set<string>();
  const playerTiles = tiles.filter((t) => t.owner_id === playerId);
  const tileMap = new Map(playerTiles.map((t) => [t.coord_id, t]));

  // If the base itself was conquered, the player is cut off
  if (!tileMap.has(baseCoordId)) {
    return connected;
  }

  const queue: string[] = [baseCoordId];
  connected.add(baseCoordId);

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const currTile = tileMap.get(currId)!;
    const neighbors = getNeighborCoordinates(currTile).map((c) =>
      formatCoordinateId(c.q, c.r, c.s)
    );

    for (const nId of neighbors) {
      if (tileMap.has(nId) && !connected.has(nId)) {
        connected.add(nId);
        queue.push(nId);
      }
    }
  }

  return connected;
}

export class ArenaService {
  static generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /**
   * Create a new Hardcore 1v1 Arena Match with active neutral resistance
   */
  static async createMatch(
    db: Db,
    username: string,
    colorHex: string = '#3b82f6',
    radius: number = ARENA_RADIUS
  ): Promise<{ match: ArenaMatch; tiles: HexTile[] }> {
    const matchId = `match_${Math.random().toString(36).substring(2, 9)}`;
    const code = this.generateCode();
    const now = new Date();

    const p1Id = `p1_${Math.random().toString(36).substring(2, 8)}`;
    const player1: ArenaPlayer = {
      id: p1Id,
      username,
      color_hex: colorHex,
      ap_current: 5,
      last_ap_tick: now,
      tiles_owned: 1,
    };

    const coords = generateHexDisk(radius);
    const p1SpawnCoord = formatCoordinateId(-radius, 0, radius); // Northwest spawn
    const p2SpawnCoord = formatCoordinateId(radius, 0, -radius); // Southeast spawn

    // Generate grid tiles with active neutral resistance
    const tiles: HexTile[] = coords.map((c) => {
      const coordId = formatCoordinateId(c.q, c.r, c.s);
      let terrain: TerrainType = 'PLAIN';
      let defense = 1; // Base neutral resistance
      let ownerId: string | null = null;

      const distFromCenter = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s));

      if (c.q === 0 && c.r === 0 && c.s === 0) {
        terrain = 'CAPITAL';
        defense = 5; // Neutral central capital
      } else if (coordId === p1SpawnCoord) {
        ownerId = p1Id;
        defense = 3; // P1 Base
      } else if (distFromCenter === 1 && Math.random() < 0.4) {
        terrain = 'MOUNTAIN';
        defense = 3; // Mountain garrison
      } else if (distFromCenter === 1) {
        defense = 2; // Inner choke points have 2 defense
      }

      return {
        _id: `${matchId}:${coordId}`,
        arena_id: matchId,
        coord_id: coordId,
        q: c.q,
        r: c.r,
        s: c.s,
        owner_id: ownerId,
        defense_power: defense,
        terrain,
        last_modified: now,
        is_isolated: false,
      };
    });

    const match: ArenaMatch = {
      _id: matchId,
      code,
      status: 'WAITING',
      radius,
      player1,
      player2: null,
      winner_id: null,
      winner_username: null,
      created_at: now,
      updated_at: now,
      started_at: undefined,
      is_double_elixir: false,
    };

    await db.collection<ArenaMatch>('matches').insertOne(match);
    await db.collection<HexTile>('tiles').insertMany(tiles);

    return { match, tiles };
  }

  /**
   * Join an existing match
   */
  static async joinMatch(
    db: Db,
    codeOrId: string,
    username: string,
    colorHex: string = '#ef4444'
  ): Promise<{ match: ArenaMatch; tiles: HexTile[] }> {
    const cleanSearch = codeOrId.trim().toUpperCase();
    const match = await db.collection<ArenaMatch>('matches').findOne({
      $or: [{ code: cleanSearch }, { _id: codeOrId.trim() }],
      status: 'WAITING',
    });

    if (!match) {
      throw new Error(`Match "${codeOrId}" not found or already in progress.`);
    }

    if (match.player1.username.toLowerCase() === username.trim().toLowerCase()) {
      throw new Error('You cannot play against yourself in the same arena!');
    }

    const now = new Date();
    const p2Id = `p2_${Math.random().toString(36).substring(2, 8)}`;
    const player2: ArenaPlayer = {
      id: p2Id,
      username: username.trim(),
      color_hex: colorHex,
      ap_current: 5,
      last_ap_tick: now,
      tiles_owned: 1,
    };

    // Assign P2 spawn base
    const p2SpawnCoord = formatCoordinateId(match.radius, 0, -match.radius);
    await db.collection<HexTile>('tiles').updateOne(
      { arena_id: match._id, coord_id: p2SpawnCoord },
      {
        $set: {
          owner_id: p2Id,
          defense_power: 3,
          last_modified: now,
          is_isolated: false,
        },
      }
    );

    const updatedMatch = await db.collection<ArenaMatch>('matches').findOneAndUpdate(
      { _id: match._id, status: 'WAITING' },
      {
        $set: {
          player2,
          status: 'PLAYING',
          started_at: now,
          updated_at: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!updatedMatch) {
      throw new Error('Failed to join match: status changed.');
    }

    const tiles = await db.collection<HexTile>('tiles').find({ arena_id: match._id }).toArray();
    return { match: updatedMatch, tiles };
  }

  /**
   * Matchmaking find or create
   */
  static async findOrCreateMatch(
    db: Db,
    username: string,
    colorHex: string
  ): Promise<{ match: ArenaMatch; tiles: HexTile[]; isNew: boolean }> {
    const openMatch = await db.collection<ArenaMatch>('matches').findOne({
      status: 'WAITING',
      'player1.username': { $ne: username.trim() },
    });

    if (openMatch) {
      const joined = await this.joinMatch(db, openMatch._id, username, colorHex || '#ef4444');
      return { match: joined.match, tiles: joined.tiles, isNew: false };
    }

    const created = await this.createMatch(db, username, colorHex || '#3b82f6');
    return { match: created.match, tiles: created.tiles, isNew: true };
  }

  /**
   * Get Live Match State, compute supply line encirclements, and evaluate win condition
   */
  static async getMatchState(
    db: Db,
    matchId: string,
    now: Date = new Date()
  ): Promise<{ match: ArenaMatch; tiles: HexTile[] }> {
    const match = await db.collection<ArenaMatch>('matches').findOne({ _id: matchId });
    if (!match) {
      throw new Error(`Match "${matchId}" not found`);
    }

    let tiles = await db.collection<HexTile>('tiles').find({ arena_id: matchId }).toArray();

    // 1. Evaluate Supply Lines for both players
    const p1BaseCoord = formatCoordinateId(-match.radius, 0, match.radius);
    const p2BaseCoord = formatCoordinateId(match.radius, 0, -match.radius);

    const p1Supplied = computeSupplyLines(tiles, p1BaseCoord, match.player1.id);
    const p2Supplied = match.player2
      ? computeSupplyLines(tiles, p2BaseCoord, match.player2.id)
      : new Set<string>();

    let tilesNeedUpdate = false;
    tiles = tiles.map((t) => {
      let isIsolated = false;
      if (t.owner_id === match.player1.id) {
        isIsolated = !p1Supplied.has(t.coord_id);
      } else if (match.player2 && t.owner_id === match.player2.id) {
        isIsolated = !p2Supplied.has(t.coord_id);
      }

      if (t.is_isolated !== isIsolated) {
        t.is_isolated = isIsolated;
        tilesNeedUpdate = true;
      }
      return t;
    });

    if (tilesNeedUpdate) {
      for (const t of tiles) {
        await db.collection<HexTile>('tiles').updateOne(
          { _id: t._id },
          { $set: { is_isolated: t.is_isolated } }
        );
      }
    }

    // 2. Count live owned tiles
    let p1Tiles = 0;
    let p2Tiles = 0;
    for (const t of tiles) {
      if (t.owner_id === match.player1.id) p1Tiles++;
      else if (match.player2 && t.owner_id === match.player2.id) p2Tiles++;
    }

    // 3. Double Elixir & AP Synchronization
    const p1AP = calculateLazyAP(match.player1, now, match.started_at);
    match.player1.ap_current = p1AP.currentAP;
    match.player1.last_ap_tick = p1AP.newTick;
    match.player1.tiles_owned = p1Tiles;

    if (match.player2) {
      const p2AP = calculateLazyAP(match.player2, now, match.started_at);
      match.player2.ap_current = p2AP.currentAP;
      match.player2.last_ap_tick = p2AP.newTick;
      match.player2.tiles_owned = p2Tiles;
    }

    const isDoubleElixir = p1AP.isDoubleElixir;

    // 4. Win Condition Check
    let winnerId: string | null = match.winner_id || null;
    let winnerUsername: string | null = match.winner_username || null;
    let isFinished = match.status === 'FINISHED';

    if (match.status === 'PLAYING' && match.player2) {
      const totalTiles = tiles.length;
      if (p2Tiles === 0 || p1Tiles === totalTiles) {
        isFinished = true;
        winnerId = match.player1.id;
        winnerUsername = match.player1.username;
      } else if (p1Tiles === 0 || p2Tiles === totalTiles) {
        isFinished = true;
        winnerId = match.player2.id;
        winnerUsername = match.player2.username;
      }
    }

    const updatedMatch: ArenaMatch = {
      ...match,
      status: isFinished ? 'FINISHED' : match.status,
      winner_id: winnerId,
      winner_username: winnerUsername,
      is_double_elixir: isDoubleElixir,
      updated_at: now,
    };

    await db.collection<ArenaMatch>('matches').updateOne(
      { _id: matchId },
      {
        $set: {
          'player1.ap_current': updatedMatch.player1.ap_current,
          'player1.last_ap_tick': updatedMatch.player1.last_ap_tick,
          'player1.tiles_owned': p1Tiles,
          ...(updatedMatch.player2
            ? {
                'player2.ap_current': updatedMatch.player2.ap_current,
                'player2.last_ap_tick': updatedMatch.player2.last_ap_tick,
                'player2.tiles_owned': p2Tiles,
              }
            : {}),
          status: updatedMatch.status,
          winner_id: winnerId,
          winner_username: winnerUsername,
          is_double_elixir: isDoubleElixir,
          updated_at: now,
        },
      }
    );

    return { match: updatedMatch, tiles };
  }

  /**
   * Spend AP with validation
   */
  static async spendArenaAP(
    db: Db,
    matchId: string,
    playerId: string,
    cost: number,
    now: Date = new Date()
  ): Promise<{ match: ArenaMatch; remainingAP: number }> {
    const { match } = await this.getMatchState(db, matchId, now);

    const isP1 = match.player1.id === playerId;
    const isP2 = match.player2?.id === playerId;

    if (!isP1 && !isP2) {
      throw new Error('Player not in this arena match.');
    }

    const player = isP1 ? match.player1 : match.player2!;
    const apInfo = calculateLazyAP(player, now, match.started_at);

    if (apInfo.currentAP < cost) {
      throw new Error(`Insufficient Elixir / AP! Needed ${cost}, have ${apInfo.currentAP}.`);
    }

    const remainingAP = apInfo.currentAP - cost;
    const fieldPrefix = isP1 ? 'player1' : 'player2';

    await db.collection<ArenaMatch>('matches').updateOne(
      { _id: matchId },
      {
        $set: {
          [`${fieldPrefix}.ap_current`]: remainingAP,
          [`${fieldPrefix}.last_ap_tick`]: apInfo.newTick,
          updated_at: now,
        },
      }
    );

    player.ap_current = remainingAP;
    player.last_ap_tick = apInfo.newTick;

    return { match, remainingAP };
  }

  /**
   * 1v1 Claim Action (Cost: 1 AP for def 0 neutral, or errors if neutral has garrison)
   */
  static async claimTile(
    db: Db,
    matchId: string,
    playerId: string,
    coordId: string
  ): Promise<{ tile: HexTile; remainingAP: number; match: ArenaMatch }> {
    const { match, tiles } = await this.getMatchState(db, matchId);

    if (match.status !== 'PLAYING') {
      throw new Error('Cannot take action: Match is not active.');
    }

    const tile = tiles.find((t) => t.coord_id === coordId);
    if (!tile) throw new Error(`Tile "${coordId}" not found in arena.`);
    if (tile.owner_id !== null) throw new Error('Tile is already owned!');

    if (tile.defense_power > 0) {
      throw new Error(
        `Neutral tile is guarded by a garrison (Defense ${tile.defense_power})! You must ATTACK it to conquer it.`
      );
    }

    // Must be adjacent to an active (non-isolated) friendly tile
    const neighborCoords = getNeighborCoordinates(tile);
    const neighborIds = neighborCoords.map((c) => formatCoordinateId(c.q, c.r, c.s));
    const friendlyAdjacent = tiles.some(
      (t) => neighborIds.includes(t.coord_id) && t.owner_id === playerId && !t.is_isolated
    );

    if (!friendlyAdjacent) {
      throw new Error('Must claim tiles adjacent to your connected territory!');
    }

    const { remainingAP } = await this.spendArenaAP(db, matchId, playerId, 1);

    const updated = await db.collection<HexTile>('tiles').findOneAndUpdate(
      { arena_id: matchId, coord_id: coordId, owner_id: null },
      {
        $set: {
          owner_id: playerId,
          defense_power: 1,
          last_modified: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!updated) throw new Error('Tile claim conflict.');

    const finalState = await this.getMatchState(db, matchId);
    return { tile: updated, remainingAP, match: finalState.match };
  }

  /**
   * 1v1 Fortify Action with Escalating Costs & Supply Line Check
   */
  static async fortifyTile(
    db: Db,
    matchId: string,
    playerId: string,
    coordId: string
  ): Promise<{ tile: HexTile; remainingAP: number; match: ArenaMatch }> {
    const { match, tiles } = await this.getMatchState(db, matchId);

    if (match.status !== 'PLAYING') {
      throw new Error('Cannot fortify: Match is not active.');
    }

    const tile = tiles.find((t) => t.coord_id === coordId);
    if (!tile) throw new Error('Tile not found.');
    if (tile.owner_id !== playerId) throw new Error('You do not own this tile.');
    if (tile.defense_power >= 10) throw new Error('Tile is at maximum fortification (10).');

    // Isolated check
    if (tile.is_isolated) {
      throw new Error('Cannot fortify: This tile is ISOLATED from your supply line!');
    }

    // Escalating cost
    const cost = getFortifyCost(tile.defense_power);

    const { remainingAP } = await this.spendArenaAP(db, matchId, playerId, cost);

    const updated = await db.collection<HexTile>('tiles').findOneAndUpdate(
      { arena_id: matchId, coord_id: coordId, owner_id: playerId, defense_power: { $lt: 10 } },
      {
        $inc: { defense_power: 1 },
        $set: { last_modified: new Date() },
      },
      { returnDocument: 'after' }
    );

    if (!updated) throw new Error('Fortification failed.');

    const finalState = await this.getMatchState(db, matchId);
    return { tile: updated, remainingAP, match: finalState.match };
  }

  /**
   * 1v1 Flanking Combat with Recoil Casualties, Terrain Bonuses & Fatigue Cooldown
   */
  static async attackTile(
    db: Db,
    matchId: string,
    playerId: string,
    targetCoordId: string
  ): Promise<{ combat: CombatResult; tile: HexTile; remainingAP: number; match: ArenaMatch }> {
    const { match, tiles } = await this.getMatchState(db, matchId);

    if (match.status !== 'PLAYING') {
      throw new Error('Cannot attack: Match is not active.');
    }

    const targetTile = tiles.find((t) => t.coord_id === targetCoordId);
    if (!targetTile) throw new Error('Target tile not found.');
    if (targetTile.owner_id === playerId) throw new Error('Cannot attack your own tile.');

    const defenderId = targetTile.owner_id;
    const neighborCoords = getNeighborCoordinates(targetTile);
    const neighborIds = neighborCoords.map((c) => formatCoordinateId(c.q, c.r, c.s));

    const now = new Date();

    // Friendly adjacent tiles that are NOT isolated and NOT fatigued
    const friendlyAdjacent = tiles.filter((t) => {
      if (!neighborIds.includes(t.coord_id) || t.owner_id !== playerId) return false;
      if (t.is_isolated) return false;
      if (t.cooldown_until && new Date(t.cooldown_until) > now) return false;
      return true;
    });

    if (friendlyAdjacent.length === 0) {
      throw new Error(
        'No ready friendly tiles adjacent to target! (Friendly tiles may be isolated or in combat cooldown).'
      );
    }

    // Spend 2 AP
    const { remainingAP } = await this.spendArenaAP(db, matchId, playerId, 2);

    // Calculate Flanking Attack Power
    const attackPower = friendlyAdjacent.reduce((sum, t) => sum + (t.defense_power || 1), 0);

    // Terrain modifier for defender: Mountains and Capital gain +3 defense!
    const terrainBonus = getTerrainDefenseBonus(targetTile.terrain);
    const effectiveDefense = targetTile.defense_power + terrainBonus;

    const isVictory = attackPower > effectiveDefense;
    const cooldownDate = new Date(now.getTime() + COMBAT_COOLDOWN_MS);

    if (!isVictory) {
      // DEFEAT / REPELLED:
      // Attacking friendly tiles take 1 Recoil Damage each (down to min 1) and enter cooldown!
      const friendlyIds = friendlyAdjacent.map((t) => t.coord_id);

      await db.collection<HexTile>('tiles').updateMany(
        {
          arena_id: matchId,
          coord_id: { $in: friendlyIds },
          owner_id: playerId,
        },
        [
          {
            $set: {
              defense_power: { $max: [1, { $subtract: ['$defense_power', 1] }] },
              cooldown_until: cooldownDate,
              last_modified: now,
            },
          },
        ]
      );

      const finalState = await this.getMatchState(db, matchId);
      return {
        combat: {
          victory: false,
          attackPower,
          targetDefense: effectiveDefense,
          excessForce: 0,
          recoilDamageApplied: true,
          attritionApplied: false,
          defenderEliminated: false,
          defenderId,
        },
        tile: targetTile,
        remainingAP,
        match: finalState.match,
      };
    }

    // VICTORY:
    // 1. Attackers suffer 1 casualty attrition each (down to min 1) and enter cooldown!
    const friendlyIds = friendlyAdjacent.map((t) => t.coord_id);
    await db.collection<HexTile>('tiles').updateMany(
      {
        arena_id: matchId,
        coord_id: { $in: friendlyIds },
        owner_id: playerId,
      },
      [
        {
          $set: {
            defense_power: { $max: [1, { $subtract: ['$defense_power', 1] }] },
            cooldown_until: cooldownDate,
            last_modified: now,
          },
        },
      ]
    );

    // 2. Occupy captured tile with excess force
    const excessForce = Math.min(10, Math.max(1, attackPower - effectiveDefense));
    const capturedTile = await db.collection<HexTile>('tiles').findOneAndUpdate(
      { arena_id: matchId, coord_id: targetCoordId },
      {
        $set: {
          owner_id: playerId,
          defense_power: excessForce,
          cooldown_until: cooldownDate,
          last_modified: now,
        },
      },
      { returnDocument: 'after' }
    );

    if (!capturedTile) throw new Error('Target tile update failed.');

    // 3. Check defender survival
    const finalState = await this.getMatchState(db, matchId);
    let defenderEliminated = false;
    if (defenderId) {
      const defenderRemaining = finalState.tiles.filter((t) => t.owner_id === defenderId).length;
      defenderEliminated = defenderRemaining === 0;
    }

    return {
      combat: {
        victory: true,
        attackPower,
        targetDefense: effectiveDefense,
        excessForce,
        recoilDamageApplied: false,
        attritionApplied: true,
        defenderEliminated,
        defenderId,
      },
      tile: capturedTile,
      remainingAP,
      match: finalState.match,
    };
  }
}
