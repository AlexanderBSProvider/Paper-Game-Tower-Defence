// Математика траси. Без залежностей і без Pixi — тому її можна ганяти в node
// (див. tools/selfcheck.js). Усі координати в клітинках.

import type { Vec2 } from '../types.js';

export interface Seg {
  x0: number; y0: number; x1: number; y1: number;
  len: number;
  /** довжина траси до початку цього сегмента */
  start: number;
  /** одиничний напрямок */
  ux: number; uy: number;
}

export interface Path {
  segs: Seg[];
  length: number;
}

export interface PathPos {
  x: number;
  y: number;
  angle: number;
  seg: number;
}

/** Полілінія → сегменти з накопиченою довжиною. */
export function buildPath(waypoints: Vec2[]): Path {
  const segs: Seg[] = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const [x0, y0] = waypoints[i - 1];
    const [x1, y1] = waypoints[i];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    segs.push({ x0, y0, x1, y1, len, start: total, ux: dx / len, uy: dy / len });
    total += len;
  }
  if (!segs.length) throw new Error('buildPath: траса порожня');
  return { segs, length: total };
}

/**
 * Точка на відстані d від початку траси.
 * hint — індекс сегмента з попереднього кадру: вороги йдуть уперед, тому пошук
 * зазвичай не робить жодної ітерації.
 */
export function posAt(path: Path, d: number, hint = 0): PathPos {
  const { segs } = path;
  const dist = Math.min(Math.max(d, 0), path.length);

  let i = Math.min(Math.max(hint, 0), segs.length - 1);
  while (i > 0 && dist < segs[i].start) i--;
  while (i < segs.length - 1 && dist > segs[i].start + segs[i].len) i++;

  const s = segs[i];
  const t = Math.min(Math.max(dist - s.start, 0), s.len);
  return {
    x: s.x0 + s.ux * t,
    y: s.y0 + s.uy * t,
    angle: Math.atan2(s.uy, s.ux),
    seg: i,
  };
}

/** Відстань від точки до найближчого місця траси — валідатор для забудови. */
export function distToPath(path: Path, x: number, y: number): number {
  let best = Infinity;
  for (const s of path.segs) {
    const t = Math.min(Math.max((x - s.x0) * s.ux + (y - s.y0) * s.uy, 0), s.len);
    const dx = x - (s.x0 + s.ux * t);
    const dy = y - (s.y0 + s.uy * t);
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}
