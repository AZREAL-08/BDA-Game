import { Request, Response } from 'express';
import { getDB } from '../config/database.js';
import { MongoTelemetry } from '../config/mongoLogger.js';

export async function getLiveTelemetry(req: Request, res: Response): Promise<void> {
  try {
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const logs = MongoTelemetry.getRecentLogs(limit);
    const metrics = MongoTelemetry.getMetrics();

    res.json({
      success: true,
      metrics,
      logs,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getDatabaseCollections(req: Request, res: Response): Promise<void> {
  try {
    const db = getDB();

    const [tilesCount, matchesCount, playersCount, logsCount] = await Promise.all([
      db.collection('tiles').countDocuments(),
      db.collection('matches').countDocuments(),
      db.collection('players').countDocuments(),
      db.collection('action_logs').countDocuments(),
    ]);

    const sampleTiles = await db.collection('tiles').find({}).limit(4).toArray();
    const sampleMatches = await db.collection('matches').find({}).sort({ created_at: -1 }).limit(2).toArray();

    res.json({
      success: true,
      stats: {
        databaseName: db.databaseName,
        collections: {
          tiles: tilesCount,
          matches: matchesCount,
          players: playersCount,
          action_logs: logsCount,
        },
      },
      samples: {
        tiles: sampleTiles,
        matches: sampleMatches,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function clearTelemetryLogs(req: Request, res: Response): Promise<void> {
  MongoTelemetry.clear();
  res.json({ success: true, message: 'Telemetry log buffer cleared.' });
}
