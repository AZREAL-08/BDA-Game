import { MongoClient, Db, CommandSucceededEvent } from 'mongodb';
import dotenv from 'dotenv';
import { MongoTelemetry } from './mongoLogger.js';

dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.DB_NAME || 'hexdominion';

let client: MongoClient | null = null;
let dbInstance: Db | null = null;

// Track pending command contexts
const commandContextMap = new Map<number, { context: string }>();

export function setNextCommandContext(context: string) {
  // Can be used to inject explicit game context
}

export async function connectDB(): Promise<Db> {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    client = new MongoClient(uri, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      monitorCommands: true, // Enable native MongoDB Command Monitoring!
    });

    // Native MongoDB Command Monitoring
    client.on('commandSucceeded', (event: CommandSucceededEvent) => {
      const ignoredCommands = ['hello', 'isMaster', 'ping', 'buildInfo', 'getLog', 'endSessions'];
      if (ignoredCommands.includes(event.commandName)) return;

      const collName = (event as any).command?.find ||
        (event as any).command?.update ||
        (event as any).command?.insert ||
        (event as any).command?.delete ||
        (event as any).command?.aggregate ||
        'tiles';

      const filter = (event as any).command?.filter || (event as any).command?.updates?.[0]?.q || undefined;
      const update = (event as any).command?.updates?.[0]?.u || (event as any).command?.documents?.[0] || undefined;

      let gameContext = 'Game State Synchronization';
      if (collName === 'matches' && event.commandName === 'update') gameContext = 'Atomic Match & Elixir Sync ($set)';
      else if (collName === 'tiles' && event.commandName === 'update') gameContext = 'Atomic Hex Conquest / Fortification ($inc / $set)';
      else if (collName === 'tiles' && event.commandName === 'find') gameContext = 'Hex Grid Board Retrieval';
      else if (collName === 'matches' && event.commandName === 'find') gameContext = 'Match State & Encirclement Evaluation';
      else if (collName === 'tiles' && event.commandName === 'insert') gameContext = 'Arena Hex Grid Generation ($insertMany)';

      MongoTelemetry.logQuery(
        event.commandName,
        typeof collName === 'string' ? collName : 'tiles',
        gameContext,
        filter,
        update,
        event.duration,
        ((event.reply as any)?.nModified || (event.reply as any)?.n || 1)
      );
    });

    await client.connect();
    dbInstance = client.db(dbName);
    console.log(`[Database] Connected successfully to MongoDB at ${uri}/${dbName}`);
    return dbInstance;
  } catch (error) {
    console.error('[Database] Connection failed:', error);
    throw error;
  }
}

export function getDB(): Db {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return dbInstance;
}

export async function closeDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    dbInstance = null;
    console.log('[Database] Connection closed.');
  }
}
