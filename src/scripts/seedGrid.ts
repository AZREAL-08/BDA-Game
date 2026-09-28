import { connectDB, closeDB } from '../config/database.js';
import { generateHexDisk, formatCoordinateId } from '../engine/coordinates.js';
import { HexTile, TerrainType } from '../models/types.js';
import dotenv from 'dotenv';

dotenv.config();

const RADIUS = parseInt(process.env.GRID_RADIUS || '5', 10);

export async function seedWorldGrid(radius: number = RADIUS): Promise<number> {
  const db = await connectDB();
  const tilesCollection = db.collection<HexTile>('tiles');
  const playersCollection = db.collection('players');
  const logsCollection = db.collection('action_logs');

  console.log(`[Seed] Generating Hex Grid with radius R = ${radius}...`);
  const coords = generateHexDisk(radius);
  console.log(`[Seed] Total coordinates generated: ${coords.length}`);

  // Create indexes
  await tilesCollection.createIndex({ owner_id: 1 });
  await tilesCollection.createIndex({ terrain: 1 });
  await playersCollection.createIndex({ username: 1 }, { unique: true });
  await logsCollection.createIndex({ timestamp: -1 });

  const now = new Date();
  const tilesToInsert: HexTile[] = coords.map((c) => {
    let terrain: TerrainType = 'PLAIN';
    let defense = 0;

    if (c.q === 0 && c.r === 0 && c.s === 0) {
      terrain = 'CAPITAL';
      defense = 5; // Neutral capital has intrinsic defense
    } else if ((Math.abs(c.q) + Math.abs(c.r) + Math.abs(c.s)) % 5 === 0 && Math.random() < 0.2) {
      terrain = 'MOUNTAIN';
      defense = 2;
    }

    const coordId = formatCoordinateId(c.q, c.r, c.s);
    return {
      _id: coordId,
      coord_id: coordId,
      q: c.q,
      r: c.r,
      s: c.s,
      owner_id: null,
      defense_power: defense,
      terrain,
      last_modified: now,
    };
  });

  // Use bulkWrite upsert to preserve or re-initialize without violating constraints
  const operations = tilesToInsert.map((tile) => ({
    updateOne: {
      filter: { _id: tile._id },
      update: {
        $setOnInsert: {
          q: tile.q,
          r: tile.r,
          s: tile.s,
          owner_id: null,
          defense_power: tile.defense_power,
          terrain: tile.terrain,
          last_modified: now,
        },
      },
      upsert: true,
    },
  }));

  const bulkResult = await tilesCollection.bulkWrite(operations);
  console.log(
    `[Seed] World Grid successfully seeded. Upserted: ${bulkResult.upsertedCount}, Matched: ${bulkResult.matchedCount}`
  );

  return coords.length;
}

// Direct invocation check
if (process.argv[1]?.includes('seedGrid')) {
  seedWorldGrid()
    .then((count) => {
      console.log(`[Seed] Completed successfully with ${count} tiles.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Error during seeding:', err);
      process.exit(1);
    });
}
