import { Request, Response } from 'express';
import { getDB } from '../config/database.js';
import { ArenaService } from '../engine/arena.js';

export async function createArenaMatch(req: Request, res: Response): Promise<void> {
  try {
    const { username, colorHex } = req.body;
    if (!username) {
      res.status(400).json({ success: false, error: 'Username is required.' });
      return;
    }
    const db = getDB();
    const result = await ArenaService.createMatch(db, username.trim(), colorHex || '#3b82f6');
    res.status(201).json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function joinArenaMatch(req: Request, res: Response): Promise<void> {
  try {
    const { code, username, colorHex } = req.body;
    if (!code || !username) {
      res.status(400).json({ success: false, error: 'Match code and username are required.' });
      return;
    }
    const db = getDB();
    const result = await ArenaService.joinMatch(db, code, username.trim(), colorHex || '#ef4444');
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function quickMatch(req: Request, res: Response): Promise<void> {
  try {
    const { username, colorHex } = req.body;
    if (!username) {
      res.status(400).json({ success: false, error: 'Username is required.' });
      return;
    }
    const db = getDB();
    const result = await ArenaService.findOrCreateMatch(db, username.trim(), colorHex || '#3b82f6');
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function getArenaState(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.id as string;
    const db = getDB();
    const result = await ArenaService.getMatchState(db, matchId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
}

export async function arenaClaim(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.id as string;
    const { playerId, coordId } = req.body;
    const db = getDB();
    const result = await ArenaService.claimTile(db, matchId, playerId, coordId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function arenaFortify(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.id as string;
    const { playerId, coordId } = req.body;
    const db = getDB();
    const result = await ArenaService.fortifyTile(db, matchId, playerId, coordId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function arenaAttack(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.id as string;
    const { playerId, targetCoordId } = req.body;
    const db = getDB();
    const result = await ArenaService.attackTile(db, matchId, playerId, targetCoordId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}
