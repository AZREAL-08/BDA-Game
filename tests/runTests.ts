import {
  cubeDistance,
  areNeighbors,
  formatCoordinateId,
  parseCoordinateId,
  generateHexDisk,
} from '../src/engine/coordinates.js';
import { calculateLazyAP, MAX_AP } from '../src/engine/ap.js';
import {
  ArenaService,
  getFortifyCost,
  getTerrainDefenseBonus,
  computeSupplyLines,
} from '../src/engine/arena.js';
import { connectDB, closeDB } from '../src/config/database.js';
import { HexTile } from '../src/models/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runHardcoreMechanicsTests() {
  console.log('\n--- 1. Testing Hardcore Combat Modifiers & Escalating Costs ---');

  // Escalating costs
  assert(getFortifyCost(1) === 1, 'Defense 1 costs 1 AP to fortify');
  assert(getFortifyCost(3) === 1, 'Defense 3 costs 1 AP to fortify');
  assert(getFortifyCost(4) === 2, 'Defense 4 costs 2 AP to fortify (escalating cost)');
  assert(getFortifyCost(6) === 2, 'Defense 6 costs 2 AP to fortify');
  assert(getFortifyCost(7) === 3, 'Defense 7 costs 3 AP to fortify (elite defense)');

  // Terrain defense bonus
  assert(getTerrainDefenseBonus('MOUNTAIN') === 3, 'Mountain provides +3 High Ground defense bonus');
  assert(getTerrainDefenseBonus('CAPITAL') === 3, 'Capital provides +3 Citadel defense bonus');
  assert(getTerrainDefenseBonus('PLAIN') === 0, 'Plain provides 0 terrain bonus');

  // Double Elixir timing
  const start = new Date('2026-09-28T12:00:00Z');
  const dummy = { ap_current: 5, last_ap_tick: start };

  const earlyGame = calculateLazyAP(dummy, new Date(start.getTime() + 30000), start);
  assert(earlyGame.isDoubleElixir === false, '0-90s is normal elixir speed');

  const overtime = calculateLazyAP(dummy, new Date(start.getTime() + 95000), start);
  assert(overtime.isDoubleElixir === true, 'After 90s, Double Elixir activates automatically!');
}

async function runSupplyLineEncirclementTests() {
  console.log('\n--- 2. Testing Supply Lines & Encirclement Cut Logic ---');

  const p1Base = 'q:-3,r:0,s:3';
  const dummyTiles: HexTile[] = [
    { _id: '1', coord_id: p1Base, q: -3, r: 0, s: 3, owner_id: 'p1', defense_power: 3, terrain: 'PLAIN', last_modified: new Date() },
    { _id: '2', coord_id: 'q:-2,r:0,s:2', q: -2, r: 0, s: 2, owner_id: 'p1', defense_power: 2, terrain: 'PLAIN', last_modified: new Date() },
    { _id: '3', coord_id: 'q:-1,r:0,s:1', q: -1, r: 0, s: 1, owner_id: 'p1', defense_power: 2, terrain: 'PLAIN', last_modified: new Date() },
    // Disconnected pocket tile on the other side
    { _id: '4', coord_id: 'q:2,r:0,s:-2', q: 2, r: 0, s: -2, owner_id: 'p1', defense_power: 2, terrain: 'PLAIN', last_modified: new Date() },
  ];

  const supplied = computeSupplyLines(dummyTiles, p1Base, 'p1');
  assert(supplied.has(p1Base), 'Base tile is supplied');
  assert(supplied.has('q:-2,r:0,s:2'), 'Connected neighbor is supplied');
  assert(supplied.has('q:-1,r:0,s:1'), 'Connected chain is supplied');
  assert(!supplied.has('q:2,r:0,s:-2'), 'Severed pocket tile is correctly detected as ISOLATED!');
}

async function runArenaLiveHardcoreSimulation() {
  console.log('\n--- 3. Testing Live Hardcore Combat: Casualties, Recoil & Encirclement ---');
  const db = await connectDB();

  await db.collection('matches').deleteMany({});
  await db.collection('tiles').deleteMany({});

  const { match: m1 } = await ArenaService.createMatch(db, 'TacticalLord', '#3b82f6', 3);
  const { match: activeMatch } = await ArenaService.joinMatch(db, m1.code, 'IronGeneral', '#ef4444');

  const p1Id = activeMatch.player1.id;
  const p2Id = activeMatch.player2!.id;

  // Verify neutral resistance
  const capital = await db.collection<HexTile>('tiles').findOne({ arena_id: activeMatch._id, coord_id: 'q:0,r:0,s:0' });
  assert(capital?.defense_power === 5, 'Capital spawns with 5 neutral garrison defense');

  // Test Neutral Claim Resistance check
  let claimBlocked = false;
  try {
    // Attempting to claim a guarded neutral hex directly with 1 AP should be blocked
    await ArenaService.claimTile(db, activeMatch._id, p1Id, 'q:0,r:0,s:0');
  } catch (e: any) {
    claimBlocked = e.message.includes('garrison');
  }
  assert(claimBlocked, 'Claiming resistant neutral garrison without combat is prevented');

  // Setup Test Combat with Mountain Defense and Casualties:
  // P1 base is at (-3, 0, 3).
  // Target is adjacent enemy mountain at (-2, 0, 2) owned by P2 with 3 defense (+3 mountain bonus = 6 effective defense!)
  // Flanker 1 is P1 base at (-3, 0, 3) (always connected!)
  // Flanker 2 is adjacent tile at (-3, 1, 2) owned by P1 (connected to P1 base!)
  const targetMountain = 'q:-2,r:0,s:2';
  const p1Base = 'q:-3,r:0,s:3';
  const p1Flank2 = 'q:-3,r:1,s:2';

  await db.collection<HexTile>('tiles').updateOne(
    { arena_id: activeMatch._id, coord_id: targetMountain },
    { $set: { owner_id: p2Id, defense_power: 3, terrain: 'MOUNTAIN' } }
  );

  await db.collection<HexTile>('tiles').updateOne(
    { arena_id: activeMatch._id, coord_id: p1Base },
    { $set: { owner_id: p1Id, defense_power: 2 } }
  );
  await db.collection<HexTile>('tiles').updateOne(
    { arena_id: activeMatch._id, coord_id: p1Flank2 },
    { $set: { owner_id: p1Id, defense_power: 2, terrain: 'PLAIN' } }
  );

  // Give P1 enough AP
  await db.collection('matches').updateOne(
    { _id: activeMatch._id },
    { $set: { 'player1.ap_current': 5 } }
  );

  // 1. Execute Underpowered Attack on Mountain Fortress (Power 4 vs Mountain 3 + 3 = 6)
  const failAttack = await ArenaService.attackTile(db, activeMatch._id, p1Id, targetMountain);
  assert(failAttack.combat.victory === false, 'Attack on high-ground mountain fortress is repelled');
  assert(failAttack.combat.targetDefense === 6, 'Effective defense was 3 base + 3 mountain bonus = 6');
  assert(failAttack.combat.recoilDamageApplied === true, 'Recoil damage applied to attackers');

  // Check that attackers suffered -1 Recoil damage: 2 -> 1
  const baseAfterFail = await db.collection<HexTile>('tiles').findOne({ arena_id: activeMatch._id, coord_id: p1Base });
  assert(baseAfterFail?.defense_power === 1, 'Attacker took -1 recoil damage from failed breach (2 -> 1)');

  // Clear cooldown for test progression
  await db.collection<HexTile>('tiles').updateMany(
    { arena_id: activeMatch._id },
    { $set: { cooldown_until: new Date(Date.now() - 1000) } }
  );

  // 2. Reinforce Attackers and Breach Fortress!
  await db.collection<HexTile>('tiles').updateOne(
    { arena_id: activeMatch._id, coord_id: p1Base },
    { $set: { defense_power: 5 } }
  );
  await db.collection<HexTile>('tiles').updateOne(
    { arena_id: activeMatch._id, coord_id: p1Flank2 },
    { $set: { defense_power: 4 } }
  );
  // Total attack power = 5 + 4 = 9 > 6 -> VICTORY! Excess = 9 - 6 = 3.

  await db.collection('matches').updateOne(
    { _id: activeMatch._id },
    { $set: { 'player1.ap_current': 5 } }
  );

  const winAttack = await ArenaService.attackTile(db, activeMatch._id, p1Id, targetMountain);
  assert(winAttack.combat.victory === true, 'Overwhelming flanking force conquers mountain fortress');
  assert(winAttack.combat.excessForce === 3, 'Captured mountain gets excess force of 3');
  assert(winAttack.combat.attritionApplied === true, 'Casualty attrition applied to attacking units');

  // Verify casualties: friendly tiles lost 1 defense in battle exhaustion (5 -> 4, 4 -> 3)
  const flank1AfterWin = await db.collection<HexTile>('tiles').findOne({ arena_id: activeMatch._id, coord_id: p1Base });
  const flank2AfterWin = await db.collection<HexTile>('tiles').findOne({ arena_id: activeMatch._id, coord_id: p1Flank2 });
  assert(flank1AfterWin?.defense_power === 4, 'Flanker 1 suffered -1 battle casualty (5 -> 4)');
  assert(flank2AfterWin?.defense_power === 3, 'Flanker 2 suffered -1 battle casualty (4 -> 3)');

  await closeDB();
}

async function main() {
  console.log('========================================================');
  console.log('⚔️  HEXDOMINION HARDCORE TACTICAL WARFARE TEST SUITE  ⚔️');
  console.log('========================================================');

  try {
    await runHardcoreMechanicsTests();
    await runSupplyLineEncirclementTests();
    await runArenaLiveHardcoreSimulation();

    console.log('\n========================================================');
    console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log('========================================================\n');

    if (failed > 0) process.exit(1);
    else process.exit(0);
  } catch (e) {
    console.error('Test execution error:', e);
    process.exit(1);
  }
}

main();
