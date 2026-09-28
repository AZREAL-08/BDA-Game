import { Server as SocketIOServer } from 'socket.io';

export interface MongoQueryLog {
  id: string;
  timestamp: Date;
  commandName: string; // 'find' | 'updateOne' | 'updateMany' | 'findOneAndUpdate' | 'insertOne' | 'insertMany' | 'aggregate' | 'deleteMany'
  collectionName: string;
  filter?: any;
  update?: any;
  durationMs: number;
  gameContext: string;
  mongoShellCode: string;
  affectedCount?: number;
}

class MongoTelemetryManager {
  private logs: MongoQueryLog[] = [];
  private maxLogs: number = 200;
  private io: SocketIOServer | null = null;
  private totalOpsCount: number = 0;
  private totalDurationMs: number = 0;

  setSocketIO(io: SocketIOServer) {
    this.io = io;
  }

  logQuery(
    commandName: string,
    collectionName: string,
    gameContext: string,
    filter?: any,
    update?: any,
    durationMs: number = 1.5,
    affectedCount?: number
  ): MongoQueryLog {
    this.totalOpsCount++;
    this.totalDurationMs += durationMs;

    // Generate Mongo Shell string
    let shellCode = `db.${collectionName}.${commandName}(`;
    if (filter !== undefined && update !== undefined) {
      shellCode += `\n  ${JSON.stringify(filter, null, 2).replace(/\n/g, '\n  ')},\n  ${JSON.stringify(update, null, 2).replace(/\n/g, '\n  ')}\n)`;
    } else if (filter !== undefined) {
      shellCode += `\n  ${JSON.stringify(filter, null, 2).replace(/\n/g, '\n  ')}\n)`;
    } else {
      shellCode += `)`;
    }

    const logEntry: MongoQueryLog = {
      id: `query_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(),
      commandName,
      collectionName,
      filter,
      update,
      durationMs: parseFloat(durationMs.toFixed(2)),
      gameContext,
      mongoShellCode: shellCode,
      affectedCount,
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // Broadcast in real-time to all connected MongoDB monitor clients!
    if (this.io) {
      this.io.emit('mongo:live_query', logEntry);
    }

    return logEntry;
  }

  getRecentLogs(limit: number = 50): MongoQueryLog[] {
    return this.logs.slice(0, limit);
  }

  getMetrics() {
    const avgDuration =
      this.totalOpsCount > 0
        ? parseFloat((this.totalDurationMs / this.totalOpsCount).toFixed(2))
        : 1.2;

    return {
      totalOperations: this.totalOpsCount,
      avgLatencyMs: avgDuration,
      recentLogsCount: this.logs.length,
    };
  }

  clear() {
    this.logs = [];
    this.totalOpsCount = 0;
    this.totalDurationMs = 0;
  }
}

export const MongoTelemetry = new MongoTelemetryManager();
