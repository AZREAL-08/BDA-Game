# HexDominion: Hardcore 1v1 Tactical Arena ⚔️🍃

> **Competitive Real-Time 1v1 Conquest with Clash Royale Elixir, Supply Lines, Fog of War & Live MongoDB Telemetry.**

---

## 🍃 Real-Time MongoDB Query Inspector (`/mongo-monitor.html`)

HexDominion is completely state-driven: the database **is** the board state. Every action (claiming, fortifying, attacking, supply recalculation, AP regeneration) executes as deterministic MongoDB CRUD operations.

To demonstrate the real-world application of MongoDB in gaming and distributed architectures, we have built a **Live MongoDB Query Inspector & Telemetry Dashboard**:

### 🔍 Live Dashboard Features:
1. **Real-Time Query Stream**:
   - Captures every driver command (`updateOne`, `updateMany`, `find`, `insertMany`, `aggregate`) using native MongoDB Command Monitoring.
   - Shows exact execution latency (e.g. `⚡ 1.2ms`), timestamp with millisecond precision, and affected document counts.
   - Displays runnable Mongo Shell code for every move:
     ```javascript
     db.tiles.updateOne(
       { "arena_id": "match_3x8f", "coord_id": "q:0,r:1,s:-1", "owner_id": "p2_99" },
       { "$set": { "owner_id": "p1_12", "defense_power": 4, "last_modified": ISODate(...) } }
     )
     ```
2. **Game-to-Database Context**:
   - Explains *why* the query ran in game terms (e.g., *"Atomic Flanking Conquest"*, *"Clash Royale AP spend ($inc)"*, *"Supply Line Encirclement Evaluation"*).
3. **Live Document Explorer**:
   - Inspect raw JSON documents in real-time for `db.tiles`, `db.matches`, and `db.players`.
   - Explains compound primary key indexing (`_id: "match_id:q:X,r:Y,s:Z"`) for $O(1)$ spatial point lookups.
4. **Interactive Controls**:
   - Filter by Command (`update`, `find`, `insert`).
   - Filter by Collection (`tiles`, `matches`, `players`).
   - Pause / Resume live stream and clear buffer buttons.

---

## 🛡️ Hardcore Tactical Mechanics

### 1. Supply Lines & Encirclement Cut ("Risk / Go" Strategy)
- Every territory must maintain an unbroken chain back to your **Spawn Base** (`(-3, 0, 3)` for P1, `(3, 0, -3)` for P2).
- **The Cut-Off Penalty**: Severed tiles become **`⚠️ CUT OFF (ISOLATED)`**:
  - Cannot launch attacks.
  - Cannot be fortified.
  - Pulsate with hazard dashed borders.

### 2. Combat Casualties & Recoil Attrition
- **Recoil Damage on Defeat**: Attacking friendly tiles suffer **-1 Defense Recoil Damage** (min 1).
- **Casualty Attrition on Victory**: Breaching a fortress inflicts **-1 Defense Attrition** (min 1) on attacking friendly units.
- **Combat Fatigue Cooldown**: 3-second recovery before participating units can attack again.

### 3. Terrain High Ground & Citadel Advantage
- **⛰️ Mountains**: Grant **+3 Defense High Ground Bonus** to the defender.
- **🏰 Central Capital (0,0,0)**: Neutral citadel with 5 base defense + 3 citadel bonus (8 Effective Defense!).
- **Active Neutral Garrisons**: Neutral plains spawn with 1-2 defense, requiring flanking combat to conquer.

### 4. 🌫️ Fog of War & Scouting
- Visual intelligence limited to **1 hex distance** from connected territory.
- Unscouted enemy tiles appear as mystery `?` hexes shrouded in dark mist. Toggle via the topbar `🌫️` button.

### 5. 🔥 Overtime: Double Elixir
- Normal recharge (**+1 AP / 2s**) for the first 90 seconds.
- Automatically transitions to **Double Elixir Overtime (+1 AP / 1s)** with a fiery animated HUD bar!

---

## 🎮 How to Experience the Live MongoDB Game:

### 1. Start Server
```bash
npm run build
npm start
```
Server runs on **[http://localhost:3000](http://localhost:3000)**.

### 2. Dual-Screen Experience (Game + Live MongoDB Inspector):
1. **Window 1 (The Game Arena)**:
   - Open [http://localhost:3000](http://localhost:3000) in two tabs or side-by-side to play 1v1.
2. **Window 2 (The Live MongoDB Inspector)**:
   - Open **[http://localhost:3000/mongo-monitor.html](http://localhost:3000/mongo-monitor.html)** (or click the green **🍃** leaf button in the game header).
3. **Watch the Magic**:
   - Every time Player 1 or Player 2 clicks **Claim**, **Fortify**, or **Attack**, watch the MongoDB terminal stream the exact atomic MongoDB operations (`updateOne`, `$set`, `$inc`, `$max`, `$subtract`) in real-time with sub-2ms latency!

---

## 🧪 Test Suite

```bash
npm test
```
All 25 hardcore tactical mechanics and MongoDB tests pass with zero failures.
