import { Request, Response } from 'express';
import { getDB } from '../config/database.js';
import { HexTile, Player } from '../models/types.js';

export async function getBoard(req: Request, res: Response): Promise<void> {
  try {
    const db = getDB();
    const tiles = await db.collection<HexTile>('tiles').find({}).toArray();
    const players = await db.collection<Player>('players').find({}).toArray();

    // Map players by _id for fast lookup
    const playerMap: Record<string, { username: string; color_hex: string; status: string }> = {};
    for (const p of players) {
      playerMap[p._id] = {
        username: p.username,
        color_hex: p.color_hex,
        status: p.status,
      };
    }

    const claimedCount = tiles.filter((t) => t.owner_id !== null).length;

    res.json({
      success: true,
      stats: {
        totalTiles: tiles.length,
        claimedTiles: claimedCount,
        unclaimedTiles: tiles.length - claimedCount,
        activePlayers: players.filter((p) => p.status === 'ACTIVE').length,
      },
      players: playerMap,
      tiles,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
