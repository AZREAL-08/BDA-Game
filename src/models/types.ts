export type TerrainType = 'CAPITAL' | 'PLAIN' | 'MOUNTAIN' | 'WATER';

export interface CubeCoordinate {
  q: number;
  r: number;
  s: number;
}

export interface HexTile extends CubeCoordinate {
  _id: string;               // e.g. "arena_123:q:0,r:1,s:-1"
  arena_id?: string;         // Unique match ID
  coord_id: string;          // "q:0,r:1,s:-1"
  owner_id: string | null;   // null if unoccupied
  defense_power: number;     // 0 to 10
  terrain: TerrainType;
  last_modified: Date;
  is_isolated?: boolean;     // True if severed from spawn base supply line
  cooldown_until?: Date;     // Timestamp until combat fatigue wears off
}

export interface Player {
  _id: string;
  username: string;
  color_hex: string;
  ap_current: number;        // 0 to 10
  last_ap_tick: Date;
  status: 'ACTIVE' | 'ELIMINATED';
  created_at: Date;
}

export interface ActionLog {
  _id?: string;
  arena_id?: string;
  player_id: string;
  action_type: 'CLAIM' | 'FORTIFY' | 'ATTACK' | 'SPAWN';
  target_tile_id: string;
  details: {
    ap_spent: number;
    attack_power?: number;
    target_defense?: number;
    excess_force?: number;
    outcome?: 'VICTORY' | 'DEFEAT' | 'SUCCESS';
    previous_owner?: string | null;
    eliminated_player_id?: string | null;
    morale_boosted_tiles?: string[];
  };
  timestamp: Date;
}

export interface CombatResult {
  victory: boolean;
  attackPower: number;
  targetDefense: number;
  excessForce: number;
  recoilDamageApplied?: boolean;
  attritionApplied?: boolean;
  moraleBoostedTiles?: string[];
  defenderEliminated: boolean;
  defenderId: string | null;
}

export interface ArenaPlayer {
  id: string;
  username: string;
  color_hex: string;
  socket_id?: string;
  ap_current: number;
  last_ap_tick: Date;
  tiles_owned: number;
}

export interface ArenaMatch {
  _id: string;
  code: string;
  status: 'WAITING' | 'PLAYING' | 'FINISHED';
  radius: number;
  player1: ArenaPlayer;
  player2?: ArenaPlayer | null;
  winner_id?: string | null;
  winner_username?: string | null;
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  is_double_elixir?: boolean;
}
