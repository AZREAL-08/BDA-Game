import { Db } from 'mongodb';
import { Player, ArenaPlayer } from '../models/types.js';

export const BASE_AP_INTERVAL_MS = 2000;   // 2 seconds per AP normal
export const DOUBLE_AP_INTERVAL_MS = 1000; // 1 second per AP in Double Elixir Overtime
export const MAX_AP = 10;                  // Capped at 10 AP max

export interface LazyAPCalculation {
  currentAP: number;
  newTick: Date;
  gainedAP: number;
  msUntilNextAP: number;
  fractionalProgress: number; // 0.0 to 1.0 for smooth elixir bar animations
  isDoubleElixir: boolean;
}

/**
 * Deterministically calculates player AP based on elapsed real-world time.
 * Supports Double Elixir overtime after 90 seconds.
 */
export function calculateLazyAP(
  player: { ap_current: number; last_ap_tick: Date | string },
  now: Date = new Date(),
  matchStartedAt?: Date | string
): LazyAPCalculation {
  const lastTickTime = new Date(player.last_ap_tick).getTime();
  const nowTime = now.getTime();

  let isDoubleElixir = false;
  if (matchStartedAt) {
    const elapsedSinceStart = nowTime - new Date(matchStartedAt).getTime();
    if (elapsedSinceStart >= 90 * 1000) {
      isDoubleElixir = true;
    }
  }

  const interval = isDoubleElixir ? DOUBLE_AP_INTERVAL_MS : BASE_AP_INTERVAL_MS;

  if (player.ap_current >= MAX_AP) {
    return {
      currentAP: MAX_AP,
      newTick: now,
      gainedAP: 0,
      msUntilNextAP: 0,
      fractionalProgress: 1.0,
      isDoubleElixir,
    };
  }

  const elapsedMs = Math.max(0, nowTime - lastTickTime);
  const gainedAP = Math.floor(elapsedMs / interval);

  if (gainedAP <= 0) {
    const msUntilNextAP = interval - (elapsedMs % interval);
    const fractionalProgress = (elapsedMs % interval) / interval;
    return {
      currentAP: player.ap_current,
      newTick: new Date(player.last_ap_tick),
      gainedAP: 0,
      msUntilNextAP,
      fractionalProgress,
      isDoubleElixir,
    };
  }

  const potentialAP = player.ap_current + gainedAP;
  const currentAP = Math.min(MAX_AP, potentialAP);

  const newTick =
    currentAP >= MAX_AP
      ? now
      : new Date(lastTickTime + gainedAP * interval);

  const msElapsedInCurrentCycle = (nowTime - newTick.getTime()) % interval;
  const msUntilNextAP =
    currentAP >= MAX_AP ? 0 : interval - msElapsedInCurrentCycle;
  const fractionalProgress =
    currentAP >= MAX_AP ? 1.0 : msElapsedInCurrentCycle / interval;

  return {
    currentAP,
    newTick,
    gainedAP,
    msUntilNextAP,
    fractionalProgress,
    isDoubleElixir,
  };
}

/**
 * Synchronizes player AP to the database.
 */
export async function syncPlayerAP(
  db: Db,
  playerId: string,
  now: Date = new Date()
): Promise<Player> {
  const player = await db.collection<Player>('players').findOne({ _id: playerId });
  if (!player) {
    throw new Error(`Player "${playerId}" not found`);
  }

  const { currentAP, newTick, gainedAP } = calculateLazyAP(player, now);

  if (gainedAP > 0 && currentAP !== player.ap_current) {
    const updated = await db.collection<Player>('players').findOneAndUpdate(
      { _id: playerId },
      {
        $set: {
          ap_current: currentAP,
          last_ap_tick: newTick,
        },
      },
      { returnDocument: 'after' }
    );
    if (updated) return updated;
  }

  return player;
}

/**
 * Atomically checks, updates lazy AP, and deducts the requested cost.
 */
export async function spendAP(
  db: Db,
  playerId: string,
  cost: number,
  now: Date = new Date()
): Promise<{ remainingAP: number; player: Player }> {
  const player = await db.collection<Player>('players').findOne({ _id: playerId });
  if (!player) {
    throw new Error(`Player "${playerId}" not found`);
  }

  if (player.status === 'ELIMINATED') {
    throw new Error(`Player "${playerId}" is eliminated from the game.`);
  }

  const { currentAP, newTick } = calculateLazyAP(player, now);

  if (currentAP < cost) {
    throw new Error(
      `Insufficient Elixir / AP! Required: ${cost}, Available: ${currentAP}`
    );
  }

  const updatedPlayer = await db.collection<Player>('players').findOneAndUpdate(
    { _id: playerId },
    {
      $set: {
        ap_current: currentAP - cost,
        last_ap_tick: newTick,
      },
    },
    { returnDocument: 'after' }
  );

  if (!updatedPlayer) {
    throw new Error('AP deduction conflict. Please retry your action.');
  }

  return {
    remainingAP: updatedPlayer.ap_current,
    player: updatedPlayer,
  };
}
