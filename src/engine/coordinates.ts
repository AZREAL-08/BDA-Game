import { CubeCoordinate } from '../models/types.js';

export const CUBE_DIRECTIONS: readonly CubeCoordinate[] = [
  { q: 1, r: -1, s: 0 },
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
] as const;

export function formatCoordinateId(q: number, r: number, s: number): string {
  if (q + r + s !== 0) {
    throw new Error(`Invalid cube coordinate: q(${q}) + r(${r}) + s(${s}) must equal 0`);
  }
  return `q:${q},r:${r},s:${s}`;
}

export function parseCoordinateId(id: string): CubeCoordinate {
  const match = id.match(/^q:(-?\d+),r:(-?\d+),s:(-?\d+)$/);
  if (!match) {
    throw new Error(`Invalid coordinate ID format: "${id}". Expected "q:X,r:Y,s:Z"`);
  }
  const q = parseInt(match[1], 10);
  const r = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  if (q + r + s !== 0) {
    throw new Error(`Coordinate invariant violated in ID "${id}": q+r+s !== 0`);
  }
  return { q, r, s };
}

export function cubeDistance(a: CubeCoordinate, b: CubeCoordinate): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

export function areNeighbors(a: CubeCoordinate, b: CubeCoordinate): boolean {
  return cubeDistance(a, b) === 1;
}

export function getNeighborCoordinates(center: CubeCoordinate): CubeCoordinate[] {
  return CUBE_DIRECTIONS.map((dir) => ({
    q: center.q + dir.q,
    r: center.r + dir.r,
    s: center.s + dir.s,
  }));
}

export function getNeighborIds(center: CubeCoordinate): string[] {
  return getNeighborCoordinates(center).map((coord) =>
    formatCoordinateId(coord.q, coord.r, coord.s)
  );
}

export function generateHexDisk(radius: number): CubeCoordinate[] {
  if (radius < 0) {
    throw new Error('Hex disk radius must be non-negative');
  }
  const coordinates: CubeCoordinate[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      const s = -q - r;
      coordinates.push({ q, r, s });
    }
  }
  return coordinates;
}

/**
 * Converts cube coordinates to 2D Cartesian pixels (flat-topped orientation)
 */
export function cubeToPixel(
  q: number,
  r: number,
  size: number
): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = size * ((3 / 2) * r);
  return { x, y };
}
