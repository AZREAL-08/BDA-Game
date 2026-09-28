import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { connectDB, closeDB, getDB } from './config/database.js';
import { apiRouter } from './routes/api.js';
import { ArenaService } from './engine/arena.js';

dotenv.config();

import { MongoTelemetry } from './config/mongoLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

MongoTelemetry.setSocketIO(io);

const port = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json());

// Serve static frontend assets
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// API router
app.use('/api', apiRouter);

// Fallback route for SPA
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Socket.io Real-Time Match Handler
io.on('connection', (socket) => {
  socket.on('arena:join_room', async ({ matchId }) => {
    if (!matchId) return;
    socket.join(matchId);

    try {
      const db = getDB();
      const state = await ArenaService.getMatchState(db, matchId);
      io.to(matchId).emit('arena:sync', state);
    } catch (err: any) {
      socket.emit('arena:error', { error: err.message });
    }
  });

  socket.on('arena:action_performed', async ({ matchId, actionType, sound }) => {
    if (!matchId) return;
    try {
      const db = getDB();
      const state = await ArenaService.getMatchState(db, matchId);
      io.to(matchId).emit('arena:sync', state);
      io.to(matchId).emit('arena:event', { actionType, sound });
    } catch (err: any) {
      socket.emit('arena:error', { error: err.message });
    }
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

async function startServer() {
  try {
    await connectDB();
    httpServer.listen(port, () => {
      console.log(`\n=================================================`);
      console.log(`🏰 HexDominion 1v1 Arena Server running on port ${port}`);
      console.log(`🌐 Play Game: http://localhost:${port}`);
      console.log(`📡 REST API:  http://localhost:${port}/api`);
      console.log(`⚡ WebSocket: Socket.io Live Sync Enabled`);
      console.log(`=================================================\n`);
    });

    const shutdown = async () => {
      console.log('\n[Server] Shutting down gracefully...');
      httpServer.close(async () => {
        await closeDB();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('[Server] Failed to initialize server:', error);
    process.exit(1);
  }
}

startServer();
