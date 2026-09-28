import { Request, Response } from 'express';
import { getDB } from '../config/database.js';
import { ConquestService } from '../engine/conquest.js';
import { ActionLog } from '../models/types.js';

export async function claimTile(req: Request, res: Response): Promise<void> {
  try {
    const { playerId, tileId } = req.body;
    if (!playerId || !tileId) {
      res.status(400).json({ success: false, error: 'Both playerId and tileId are required.' });
      return;
    }

    const db = getDB();
    const result = await ConquestService.claimTile(db, playerId, tileId);

    res.json({
      success: true,
      message: `Successfully claimed tile ${tileId}!`,
      tile: result.tile,
      remainingAP: result.remainingAP,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function fortifyTile(req: Request, res: Response): Promise<void> {
  try {
    const { playerId, tileId } = req.body;
    if (!playerId || !tileId) {
      res.status(400).json({ success: false, error: 'Both playerId and tileId are required.' });
      return;
    }

    const db = getDB();
    const result = await ConquestService.fortifyTile(db, playerId, tileId);

    res.json({
      success: true,
      message: `Successfully fortified tile ${tileId} to defense ${result.tile.defense_power}!`,
      tile: result.tile,
      remainingAP: result.remainingAP,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function attackTile(req: Request, res: Response): Promise<void> {
  try {
    const { playerId, targetTileId } = req.body;
    if (!playerId || !targetTileId) {
      res.status(400).json({
        success: false,
        error: 'Both playerId and targetTileId are required.',
      });
      return;
    }

    const db = getDB();
    const result = await ConquestService.attackTile(db, playerId, targetTileId);

    if (result.combat.victory) {
      res.json({
        success: true,
        message: `Victory! Captured tile ${targetTileId} with excess force of ${result.combat.excessForce}!`,
        combat: result.combat,
        tile: result.tile,
        remainingAP: result.remainingAP,
      });
    } else {
      res.json({
        success: false,
        message: `Attack failed! Attack power (${result.combat.attackPower}) was insufficient against defender's defense (${result.combat.targetDefense}).`,
        combat: result.combat,
        tile: result.tile,
        remainingAP: result.remainingAP,
      });
    }
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function getActionLogs(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(50, parseInt((req.query.limit as string) || '20', 10));
    const db = getDB();

    const logs = await db
      .collection<ActionLog>('action_logs')
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      logs,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
