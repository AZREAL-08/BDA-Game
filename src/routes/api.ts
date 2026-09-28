import { Router } from 'express';
import { getBoard } from '../controllers/boardController.js';
import { registerPlayer, getPlayer, listPlayers } from '../controllers/playerController.js';
import { claimTile, fortifyTile, attackTile, getActionLogs } from '../controllers/actionController.js';
import {
  createArenaMatch,
  joinArenaMatch,
  quickMatch,
  getArenaState,
  arenaClaim,
  arenaFortify,
  arenaAttack,
} from '../controllers/arenaController.js';
import {
  getLiveTelemetry,
  getDatabaseCollections,
  clearTelemetryLogs,
} from '../controllers/mongoMonitorController.js';

export const apiRouter = Router();

// Global Board routes (legacy / open world)
apiRouter.get('/board', getBoard);

// Player routes
apiRouter.post('/players/register', registerPlayer);
apiRouter.get('/players', listPlayers);
apiRouter.get('/players/:id', getPlayer);

// Global Tile action routes
apiRouter.post('/tiles/claim', claimTile);
apiRouter.post('/tiles/fortify', fortifyTile);
apiRouter.post('/tiles/attack', attackTile);

// Global Logs route
apiRouter.get('/logs', getActionLogs);

// 1v1 Arena Routes (Clash Royale Style Real-Time Matches)
apiRouter.post('/arena/create', createArenaMatch);
apiRouter.post('/arena/join', joinArenaMatch);
apiRouter.post('/arena/quick', quickMatch);
apiRouter.get('/arena/:id', getArenaState);
apiRouter.post('/arena/:id/claim', arenaClaim);
apiRouter.post('/arena/:id/fortify', arenaFortify);
apiRouter.post('/arena/:id/attack', arenaAttack);

// Live MongoDB Telemetry & Inspector Routes
apiRouter.get('/mongodb/telemetry', getLiveTelemetry);
apiRouter.get('/mongodb/collections', getDatabaseCollections);
apiRouter.post('/mongodb/clear', clearTelemetryLogs);
