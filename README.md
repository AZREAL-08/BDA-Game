# HexDominion: Hardcore 1v1 Tactical Arena ⚔️🍃

> **Real-time, state-driven 1v1 territory conquest game built on MongoDB atomic CRUD operations, featuring Clash Royale-style Elixir mechanics, supply line encirclement, fog of war, and a live MongoDB query telemetry stream.**

In **HexDominion**, the database **is** the board state. Every player maneuver (claiming territory, fortifying defenses, launching flanking assaults, recalculating supply lines, and spending action points) is executed directly as deterministic, atomic MongoDB queries with zero in-memory server state.

---

## 🌟 Key Features & Gameplay Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │                   HEXDOMINION ARENA                    │
                    └────────────────────────────────────────────────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼                                                               ▼
  ┌─────────────────────────┐                                     ┌─────────────────────────┐
  │   1v1 ARENA DUEL (UI)   │                                     │ LIVE MONGO INSPECTOR UI │
  │   http://localhost:3000 │                                     │  /mongo-monitor.html    │
  └────────────┬────────────┘                                     └────────────▲────────────┘
               │ (Moves & Actions)                                             │ (Live Stream)
               ▼                                                               │
  ┌────────────────────────────────────────────────────────────────────────────┴────────────┐
  │                           STATELESS APPLICATION SERVER (Node.js/Express)                │
  │                  Socket.io Live Sync  •  Cube Coordinate Engine  •  Mongo Telemetry      │
  └────────────────────────────────────────────┬────────────────────────────────────────────┘
                                               │ (Atomic CRUD & Command Monitoring)
                                               ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │                                     MONGODB STATE TIER                                  │
  │     db.tiles (Spatial $O(1))  •  db.matches (Match Rooms)  •  db.action_logs (Audits)   │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. ⚡ Clash Royale Elixir System
* **2-Second Recharge Rate**: Generates **+1 AP every 2 seconds**.
* **Max Capacity**: Capped at **10 AP**.
* **Continuous Replenishment**: Whenever AP is spent (1 AP for Claim, 1–3 AP for Fortify, 2 AP for Attack), it automatically begins recharging back to 10.
* **Liquid Shimmer HUD**: A 60fps glowing pink/purple 10-segment Elixir bar with animated wave shimmer and live numeric readout.
* **🔥 Double Elixir Overtime**: At the 90-second mark, Double Elixir activates automatically (**+1 AP every 1 second**) with a fiery animated HUD bar!

### 2. ⚠️ Supply Lines & Encirclement Cut (*"Risk / Go" Strategy*)
* Every claimed tile must maintain an unbroken chain of friendly tiles connected back to your **Spawn Base**:
  * **Player 1 Base**: Northwest `q:-3, r:0, s:3`
  * **Player 2 Base**: Southeast `q:3, r:0, s:-3`
* **The Cut-Off Penalty**: If your opponent captures a tile in the middle and severs your front line from your base:
  * Those severed tiles immediately become **`⚠️ CUT OFF (ISOLATED)`**.
  * Isolated tiles **CANNOT attack**!
  * Isolated tiles **CANNOT be fortified**!
  * Render with a pulsating hazard dashed border and warning icon.
* **Tactical Depth**: Slicing an opponent's thin supply line instantly paralyzes their forward army!

### 3. 💥 Battle Casualties & Recoil Damage
Attacking carries real strategic risk:
* **Recoil on Defeat**: If you launch an underpowered attack and fail, the defending garrison repels you with casualties—every participating attacking tile suffers **-1 Defense Recoil Damage** (down to minimum 1)!
* **Casualties on Victory**: Breaching a fortress is costly. Every participating attacking tile suffers **-1 Defense Attrition** (down to minimum 1) from battle exhaustion. You can no longer steamroll through 5 tiles in 10 seconds without stopping to reinforce!
* **Combat Fatigue Cooldown**: Participating units enter a **3-second Combat Fatigue Cooldown** before they can assault again.

### 4. ⛰️ High-Ground Terrain & Neutral Garrisons
* **⛰️ Mountain Fortresses**: Defenders on mountain tiles receive a **+3 Defense High-Ground Bonus** ($\text{Effective Defense} = \text{Base} + 3$).
* **🏰 The Central Citadel (0,0,0)**: Neutral capital spawns with 5 defense plus a +3 Citadel bonus (8 Effective Defense!). Capturing the center is a major mid-game objective.
* **Active Neutral Resistance**: Neutral plains spawn with **1–2 defense**. You can no longer brainlessly click unowned tiles for 1 AP—you must use **ATTACK (2 AP)** with flanking power to actively conquer them!

### 5. 📈 Escalating Fortification Costs
Prevents players from effortlessly stacking a single tile to 10 defense:
* **Defense 1 to 3**: Costs **1 AP**
* **Defense 4 to 6**: Costs **2 AP**
* **Defense 7 to 9**: Costs **3 AP**

### 6. 🌫️ Fog of War & Scouting
* Players only have visual intelligence on hexes within **1 hex distance** of their connected territory.
* Tiles outside vision range are shrouded in dark mist, displaying as mystery `?` tiles with hidden defense numbers.
* Toggle Fog of War on/off anytime using the `🌫️` button in the topbar.

---

## 🍃 Real-Time MongoDB Query Inspector (`/mongo-monitor.html`)

HexDominion includes a dedicated live query inspector designed to demonstrate the real-world application of MongoDB:

* **Direct URL**: **[http://localhost:3000/mongo-monitor.html](http://localhost:3000/mongo-monitor.html)**
* **From the Game**: Click the green **🍃** leaf button in the topbar or the lobby dialog.

### Features:
1. **Live Query Terminal**: Streams every single query executed by the game engine in real time using native MongoDB Command Monitoring.
2. **Runnable Mongo Shell Snippets**: Each query card provides formatted JavaScript/Mongo shell syntax:
   ```javascript
   db.tiles.updateOne(
     { "arena_id": "match_aaob4vj", "coord_id": "q:-2,r:0,s:2", "owner_id": "p2_6ypian" },
     { "$set": { "owner_id": "p1_ubb8g8", "defense_power": 3, "last_modified": ISODate(...) } }
   )
   ```
3. **Game Context Translation**: Translates queries into human-readable actions (*"Atomic Hex Conquest"*, *"Clash Royale AP spend ($inc)"*, *"Supply Line Encirclement Evaluation"*).
4. **Live Document Explorer**: Raw JSON document viewer for `db.tiles`, `db.matches`, and `db.players`.
5. **Filters & Metrics**: Filter by command (`update`, `find`, `insert`) and collection, with live latency timers (typically $1.2\text{ms} - 3\text{ms}$).

---

## 🎮 Quick Start Guide (Testing 1v1 in 2 Tabs)

### 1. Prerequisites & Installation
- **Node.js** (v18+)
- **MongoDB** (running on `mongodb://127.0.0.1:27017` or configured via `.env`)

```bash
# Clone & enter directory
cd HexDominion

# Install dependencies
npm install

# Seed initial world grid
npm run seed

# Build TypeScript
npm run build

# Start game server
npm start
```
The server will start at **[http://localhost:3000](http://localhost:3000)**.

### 2. Side-by-Side Dual-Screen Demo:
1. **Window 1 (The Game Arena)**:
   - Open [http://localhost:3000](http://localhost:3000) in **Tab 1** -> Enter name `AetherLord` (Blue) -> Click **⚡ QUICK MATCH (1v1)**.
   - Open [http://localhost:3000](http://localhost:3000) in **Tab 2** -> Enter name `PyroViper` (Red) -> Click **⚡ QUICK MATCH (1v1)**.
   - **The match begins instantly!**
2. **Window 2 (The Live MongoDB Inspector)**:
   - Open **[http://localhost:3000/mongo-monitor.html](http://localhost:3000/mongo-monitor.html)** in a separate tab or window.
3. **Play the Game**:
   - Watch the Elixir bar recharge (+1 AP every 2 seconds).
   - Claim adjacent neutral tiles (1 AP) or conquer garrisons (2 AP).
   - Fortify high-ground mountain choke points.
   - Flank and cut off the opponent's supply line to paralyze their army!
   - Watch MongoDB execute every atomic operation live with sub-3ms latency!

---

## 📡 REST API & WebSocket Reference

| Method / Channel | Endpoint / Event | Description |
|---|---|---|
| `POST` | `/api/arena/quick` | Quick Match matchmaking (pairs or creates room) |
| `POST` | `/api/arena/create` | Create a private arena with a 4-letter code |
| `POST` | `/api/arena/join` | Join private arena via room code |
| `GET` | `/api/arena/:id` | Fetch live match state with synced AP for both players |
| `POST` | `/api/arena/:id/claim` | Spend 1 AP to claim an adjacent hex |
| `POST` | `/api/arena/:id/fortify`| Spend 1–3 AP to fortify a friendly hex |
| `POST` | `/api/arena/:id/attack` | Spend 2 AP to launch a flanking assault |
| `GET` | `/api/mongodb/telemetry` | Fetch recent query logs and latency metrics |
| `GET` | `/api/mongodb/collections`| Fetch live collection stats and sample documents |
| `POST` | `/api/mongodb/clear` | Clear telemetry query buffer |
| `WS (In)` | `arena:join_room` | Join match room for real-time state broadcast |
| `WS (Out)` | `arena:sync` | Emits updated board and player AP to room |
| `WS (Out)` | `mongo:live_query` | Streams live MongoDB queries to `/mongo-monitor.html` |

---

## 🧪 Automated Test Suite

```bash
npm test
```
The test suite ([`tests/runTests.ts`](file:///media/aryan-mishra/DATA10/Main%20File/blockchain/BDA/tests/runTests.ts)) runs 25 automated tests against MongoDB:
* **Geometry Invariants**: $q + r + s = 0$ validation, distance formulas, neighbor derivations.
* **Clash Royale Elixir**: 2-second replenishment, 10 AP cap, and 90-second Double Elixir trigger.
* **Supply Line Encirclement**: BFS graph traversal from base and isolation detection.
* **Combat Mechanics**: High ground +3 bonus, recoil casualties on defeat, breach attrition on victory, and defender elimination.

---

## 📁 Project Structure

```
BDA/
├── src/
│   ├── config/
│   │   ├── database.ts        # MongoDB client connection & command monitor
│   │   └── mongoLogger.ts     # Telemetry manager & live query broadcaster
│   ├── engine/
│   │   ├── coordinates.ts     # Cube coordinate formulas & neighbor lookups
│   │   ├── ap.ts              # Stateless lazy AP evaluation & Double Elixir
│   │   ├── arena.ts           # 1v1 arena matchmaking, supply lines & combat
│   │   └── conquest.ts        # Legacy open-world conquest logic
│   ├── models/
│   │   └── types.ts           # HexTile, ArenaMatch, Player, CombatResult types
│   ├── controllers/
│   │   ├── arenaController.ts # 1v1 arena action controllers
│   │   ├── mongoMonitorController.ts # Live telemetry & collection inspectors
│   │   ├── boardController.ts # Legacy board query controller
│   │   └── playerController.ts# Player registration & profile controllers
│   ├── routes/
│   │   └── api.ts             # REST API router
│   ├── scripts/
│   │   └── seedGrid.ts        # Radius 5 world grid generator
│   ├── public/
│   │   ├── index.html         # 1v1 Arena tactical interface
│   │   ├── style.css          # Clash Royale style dark tactical theme
│   │   ├── app.js             # Canvas renderer, 60fps elixir loop & Web Audio
│   │   ├── mongo-monitor.html # Live MongoDB Query Inspector dashboard
│   │   ├── mongo-monitor.css  # MongoDB Green cyber terminal styling
│   │   └── mongo-monitor.js   # Live query stream & JSON explorer controller
│   └── server.ts              # Express & Socket.io server entrypoint
├── tests/
│   └── runTests.ts            # Automated unit & integration test suite
├── package.json
├── tsconfig.json
└── README.md
```
