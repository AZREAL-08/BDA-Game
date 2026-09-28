import { Request, Response } from 'express';
import { getDB } from '../config/database.js';
import { ConquestService } from '../engine/conquest.js';
import { syncPlayerAP, calculateLazyAP } from '../engine/ap.js';
import { Player, HexTile } from '../models/types.js';

export async function registerPlayer(req: Request, res: Response): Promise<void> {
  try {
    const { username, colorHex } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Username is required.' });
      return;
    }

    const db = getDB();
    const result = await ConquestService.registerPlayer(
      db,
      username.trim(),
      colorHex || '#3b82f6'
    );

    res.status(201).json({
      success: true,
      message: `Player ${username} successfully registered and spawned!`,
      player: result.player,
      spawnTile: result.spawnTile,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function getPlayer(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.id as string;
    const db = getDB();

    const player = await syncPlayerAP(db, playerId);
    const apInfo = calculateLazyAP(player);

    const ownedTilesCount = await db.collection<HexTile>('tiles').countDocuments({
      owner_id: playerId,
    });

    res.json({
      success: true,
      player,
      apDetails: {
        currentAP: apInfo.currentAP,
        msUntilNextAP: apInfo.msUntilNextAP,
        maxAP: 12,
      },
      stats: {
        ownedTiles: ownedTilesCount,
      },
    });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
}

export async function listPlayers(req: Request, res: Response): Promise<void> {
  try {
    const db = getDB();
    const players = await db.collection<Player>('players').find({}).toArray();

    // Attach tile counts to each player
    const tileCounts = await db
      .collection<HexTile>('tiles')
      .aggregate<{ _id: string; count: number }>([
        { $match: { owner_id: { $ne: null } } },
        { $group: { _id: '$owner_id', count: { $sum: 1 } } },
      ])
      .toArray();

    const countMap: Record<string, number> = {};
    for (const c of tileCounts) {
      if (c._id) countMap[c._id] = c.count;
    }

    const leaderboard = players.map((p) => ({
      id: p._id,
      username: p.username,
      color: p.color_hex,
      status: p.status,
      ap: p.ap_current,
      tilesOwned: countMap[p._id] || 0,
      createdAt: p.created_at,
    }));

    leaderboard.sort((a, b) => b.tilesOwned - a.tilesOwned);

    res.json({
      success: true,
      players: leaderboard,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
