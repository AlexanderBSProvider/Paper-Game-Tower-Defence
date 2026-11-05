// Бестіарій режиму lane: варіанти ворогів для шоуруму й гри.
//
// Стиль (після двох відгуків власника): чіткий контур, світла рівна заливка
// тим самим кольором, трохи темніша тінь справа знизу, очі — дірки в заливці
// (крізь них папір), мінімум деталей.
//
// Головне правило — ЧАСТИНИ НЕ НАКЛАДАЮТЬСЯ:
//   - вуха, роги, вусики, морди ростуть із контуру НАЗОВНІ (sprout): їхня
//     заливка обмежена дугою контуру, тож не лягає на тіло другим шаром;
//   - шолом, панцир, візор — у тій самій коробці, що й тіло, а тіло під ними
//     вирізане (cut): заливка одна, лінії не перетинаються;
//   - ноги стоять під тілом, руки, крила, щити й хвости кріпляться збоку й
//     ідуть убік;
//   - накладки олівцем/маркером (зіниці, шолом, панцир) мають ту саму коробку,
//     що й тіло, тож стають рівно на місце без підгонки координат.
//
// Усе — МАСКИ (біле на прозорому), колір дає перо частини в rigs.json.
// Кожна функція малює в коробку w × h пікселів; розміри — parts.json.

import type { Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penPath } from './ink.js';
import type { PenOpts } from './ink.js';
import type { Vec2 } from '../types.js';

type Doodle = (g: Graphics, w: number, h: number, lw: number) => void;

const W = '#ffffff';
const TAU = Math.PI * 2;
const ink = (o: PenOpts = {}): PenOpts => ({ color: W, halo: 0.05, jitter: 0.6, ...o });
const flat = (pts: Vec2[]) => pts.flat();

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- геометрія -------------------------------------------------------------------

const N = 48;

/** Контур кулі: точка i лежить на куті TAU·i/N (y вниз, 0 — праворуч). */
function ballPts(cx: number, cy: number, rx: number, ry: number, seed: number, wob = 0.03): Vec2[] {
  const r = seeded(seed);
  const ph = r() * 6.28, ph2 = r() * 6.28;
  const pts: Vec2[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const k = 1 + wob * (Math.sin(a * 2 + ph) * 0.6 + Math.sin(a * 3 + ph2) * 0.4);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

const idx = (n: number, a: number) => Math.round(((((a % TAU) + TAU) % TAU) / TAU) * n) % n;

/** Точки контуру від кута a0 до a1 за годинниковою (на екрані), включно. */
function arc(pts: Vec2[], a0: number, a1: number): Vec2[] {
  const n = pts.length, i0 = idx(n, a0), i1 = idx(n, a1);
  const out: Vec2[] = [];
  for (let i = i0; ; i = (i + 1) % n) { out.push(pts[i]); if (i === i1) break; }
  return out;
}
const at = (pts: Vec2[], a: number) => pts[idx(pts.length, a)];

interface Hole { x: number; y: number; rx: number; ry: number }

/** Заливка з дірками (еліпси) і вирізами (багатокутники). */
function fillWith(g: Graphics, pts: Vec2[], alpha: number, holes: Hole[] = [], cuts: Vec2[][] = []) {
  g.poly(flat(pts)).fill({ color: W, alpha });
  for (const h of holes) g.ellipse(h.x, h.y, h.rx, h.ry).cut();
  for (const c of cuts) g.poly(flat(c)).cut();
}
function outline(g: Graphics, pts: Vec2[], lw: number, closed = true) {
  penPath(g, pts, ink({ width: lw * 1.1, closed, overshoot: lw * 0.3, step: lw * 3, pressure: 0.2 }));
}
function line(g: Graphics, pts: Vec2[], lw: number, k = 0.8) {
  penStroke(g, pts, ink({ width: lw * k, overshoot: 0, step: lw * 2.5, pressure: 0.25 }));
}
function dot(g: Graphics, x: number, y: number, r: number) {
  g.circle(x, y, r).fill({ color: W, alpha: 1 });
}
function rim(g: Graphics, h: Hole, lw: number) {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 20; i++) { const a = (i / 20) * TAU; pts.push([h.x + Math.cos(a) * h.rx, h.y + Math.sin(a) * h.ry]); }
  line(g, pts, lw, 0.75);
}

/** Півмісяць тіні справа знизу (світло зліва згори — як в усьому зошиті). */
function shade(cx: number, cy: number, rx: number, ry: number): Vec2[] {
  const out: Vec2[] = [], back: Vec2[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = -0.4 + (2.4 * i) / 16;
    out.push([cx + Math.cos(a) * rx * 0.97, cy + Math.sin(a) * ry * 0.97]);
    back.push([cx - rx * 0.15 + Math.cos(a) * rx * 0.8, cy - ry * 0.15 + Math.sin(a) * ry * 0.8]);
  }
  return [...out, ...back.reverse()];
}

interface Ell { cx: number; cy: number; rx: number; ry: number }

/** Куля-тіло: заливка з дірками/вирізами, тінь, контур. */
function ball(g: Graphics, pts: Vec2[], c: Ell, lw: number, holes: Hole[] = [], cuts: Vec2[][] = []) {
  fillWith(g, pts, 0.2, holes, cuts);
  fillWith(g, shade(c.cx, c.cy, c.rx, c.ry), 0.15, holes, cuts);
  outline(g, pts, lw);
}

/**
 * Виріст назовні з контуру (вухо, ріг, морда): від точки контуру на куті a0
 * через `outer` до точки на куті a1. Заливка обмежена дугою контуру між ними,
 * тому на тіло не лягає. Обводимо лише зовнішню частину — дугу вже обвело тіло.
 */
function sprout(g: Graphics, body: Vec2[], a0: number, a1: number, outer: Vec2[], lw: number, alpha = 0.22, holes: Hole[] = []) {
  const p0 = at(body, a0), p1 = at(body, a1);
  fillWith(g, [p0, ...outer, p1, ...arc(body, a0, a1).reverse()], alpha, holes);
  outline(g, [p0, ...outer, p1], lw, false);
}

/** Ріг: квадратична крива, товщина спадає до вістря. */
function hornPts(base: Vec2, bend: Vec2, tip: Vec2, width: number): Vec2[] {
  const q = (t: number): Vec2 => {
    const u = 1 - t;
    return [u * u * base[0] + 2 * u * t * bend[0] + t * t * tip[0], u * u * base[1] + 2 * u * t * bend[1] + t * t * tip[1]];
  };
  const side = (t: number, k: number): Vec2 => {
    const a = q(Math.max(0, t - 0.01)), b = q(Math.min(1, t + 0.01)), p = q(t);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const half = (width / 2) * (1 - t) ** 0.8;
    return [p[0] - ((b[1] - a[1]) / len) * half * k, p[1] + ((b[0] - a[0]) / len) * half * k];
  };
  const l: Vec2[] = [], r: Vec2[] = [];
  for (let i = 0; i <= 12; i++) { l.push(side(i / 12, 1)); r.push(side(i / 12, -1)); }
  return [...l, ...r.reverse()];
}

/** Зіниці: дивляться вліво (туди, куди ворог іде). */
function pupils(g: Graphics, holes: Hole[], k = 0.55) {
  for (const h of holes) dot(g, h.x - h.rx * 0.32, h.y + h.ry * 0.1, Math.min(h.rx, h.ry) * k);
}

/** Ступня: невеликий кулястий шматок. */
const foot: Doodle = (g, w, h, lw) => {
  const c = { cx: w * 0.5, cy: h * 0.52, rx: w * 0.42, ry: h * 0.38 };
  ball(g, ballPts(c.cx, c.cy, c.rx, c.ry, 7), c, lw * 0.85);
};

/** Лапка з кігтиками: від плеча (праворуч) до кисті (ліворуч). */
const paw: Doodle = (g, w, h, lw) => {
  const hand: Vec2 = [w * 0.22, h * 0.52];
  line(g, [[w * 0.97, h * 0.48], [w * 0.55, h * 0.44], hand], lw, 1.0);
  for (const [x, y] of [[0.05, 0.25], [0.02, 0.55], [0.1, 0.85]] as Vec2[]) line(g, [hand, [w * x, h * y]], lw, 0.6);
};

// =============================================================================
// ЗВИЧАЙНІ
// =============================================================================

// --- Вухань: яйце з довгими вухами -------------------------------------------------
const impC = (w: number, h: number): Ell => ({ cx: w * 0.5, cy: h * 0.66, rx: w * 0.36, ry: h * 0.31 });
const impEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.36, y: h * 0.61, rx: w * 0.1, ry: h * 0.1 },
  { x: w * 0.59, y: h * 0.61, rx: w * 0.09, ry: h * 0.093 },
];
const impBody: Doodle = (g, w, h, lw) => {
  const c = impC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 131), eyes = impEyes(w, h);
  ball(g, b, c, lw, eyes);
  sprout(g, b, -2.6, -2.1, [[w * 0.06, h * 0.03]], lw);
  sprout(g, b, -1.05, -0.55, [[w * 0.94, h * 0.03]], lw);
  for (const e of eyes) rim(g, e, lw);
  line(g, [[w * 0.24, h * 0.47], [w * 0.43, h * 0.53]], lw, 0.95);
  line(g, [[w * 0.53, h * 0.53], [w * 0.69, h * 0.47]], lw, 0.95);
  line(g, [[w * 0.34, h * 0.78], [w * 0.48, h * 0.81], [w * 0.63, h * 0.77]], lw, 0.85);
  for (const x of [0.39, 0.55]) penPath(g, [[w * (x - 0.03), h * 0.8], [w * x, h * 0.87], [w * (x + 0.03), h * 0.8]], ink({ width: lw * 0.6, overshoot: 0 }));
};
const impPupils: Doodle = (g, w, h) => pupils(g, impEyes(w, h));

// --- Клякса: крапля, що сповзає -----------------------------------------------------
const slimeEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.38, y: h * 0.58, rx: w * 0.085, ry: h * 0.095 },
  { x: w * 0.6, y: h * 0.56, rx: w * 0.08, ry: h * 0.09 },
];
function slimePts(w: number, h: number): Vec2[] {
  const pts: Vec2[] = [];
  const tip: Vec2 = [w * 0.58, h * 0.04];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    let x = w * 0.5 + Math.cos(a) * w * 0.45, y = h * 0.64 + Math.sin(a) * h * 0.33;
    const d = Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)); // 0 — угорі
    const k = Math.exp(-((d / 0.75) ** 2)) * 0.95;
    x += (tip[0] - x) * k; y += (tip[1] - y) * k;
    pts.push([x, Math.min(y, h * 0.95)]);
  }
  return pts;
}
const slimeBody: Doodle = (g, w, h, lw) => {
  const pts = slimePts(w, h), eyes = slimeEyes(w, h);
  fillWith(g, pts, 0.22, eyes);
  fillWith(g, shade(w * 0.5, h * 0.64, w * 0.45, h * 0.33), 0.15, eyes);
  outline(g, pts, lw);
  for (const e of eyes) rim(g, e, lw);
  line(g, [[w * 0.36, h * 0.79], [w * 0.44, h * 0.75], [w * 0.52, h * 0.79], [w * 0.6, h * 0.75]], lw, 0.85);
  line(g, [[w * 0.3, h * 0.44], [w * 0.36, h * 0.38]], lw, 0.55);
};
const slimePupils: Doodle = (g, w, h) => pupils(g, slimeEyes(w, h), 0.6);

// --- Одноокий: куля з одним оком і вусиками -------------------------------------------
const cycC = (w: number, h: number): Ell => ({ cx: w * 0.5, cy: h * 0.66, rx: w * 0.38, ry: h * 0.31 });
const cycEye = (w: number, h: number): Hole[] => [{ x: w * 0.45, y: h * 0.6, rx: w * 0.15, ry: h * 0.13 }];
const cycBody: Doodle = (g, w, h, lw) => {
  const c = cycC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 151), eye = cycEye(w, h);
  ball(g, b, c, lw, eye);
  rim(g, eye[0], lw);
  for (const [a, tx, ty] of [[-2.05, 0.2, 0.08], [-1.1, 0.78, 0.06]]) {
    const p = at(b, a);
    const k: Ell = { cx: w * tx, cy: h * ty, rx: w * 0.05, ry: h * 0.045 };
    line(g, [p, [(p[0] + k.cx) / 2, h * 0.2], [k.cx, k.cy + k.ry]], lw, 0.85);
    ball(g, ballPts(k.cx, k.cy, k.rx, k.ry, 3), k, lw * 0.7);
  }
  line(g, [[w * 0.28, h * 0.42], [w * 0.62, h * 0.45]], lw, 1.0);
  line(g, [[w * 0.3, h * 0.79], [w * 0.62, h * 0.8]], lw, 0.85);
  for (let i = 0; i < 4; i++) {
    const x = w * (0.32 + i * 0.075);
    penPath(g, [[x, h * 0.795], [x + w * 0.035, h * 0.85], [x + w * 0.07, h * 0.797]], ink({ width: lw * 0.55, overshoot: 0 }));
  }
};
const cycPupils: Doodle = (g, w, h) => pupils(g, cycEye(w, h), 0.5);

// --- Грибник: капелюх на ніжці, обличчя на ніжці ---------------------------------------
const mushEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.42, y: h * 0.66, rx: w * 0.05, ry: h * 0.045 },
  { x: w * 0.58, y: h * 0.66, rx: w * 0.05, ry: h * 0.045 },
];
const mushStem = (w: number, h: number): Vec2[] => [
  [w * 0.31, h * 0.5], [w * 0.69, h * 0.5], [w * 0.72, h * 0.75], [w * 0.7, h * 0.93], [w * 0.62, h * 0.97],
  [w * 0.38, h * 0.97], [w * 0.3, h * 0.93], [w * 0.28, h * 0.75],
];
function mushCap(w: number, h: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI + (Math.PI * i) / 24;
    pts.push([w * 0.5 + Math.cos(a) * w * 0.47, h * 0.5 + Math.sin(a) * h * 0.45]);
  }
  return pts;
}
const mushSpots = (w: number, h: number): Hole[] => [
  { x: w * 0.28, y: h * 0.32, rx: w * 0.07, ry: h * 0.055 },
  { x: w * 0.55, y: h * 0.17, rx: w * 0.06, ry: h * 0.05 },
  { x: w * 0.73, y: h * 0.36, rx: w * 0.05, ry: h * 0.045 },
];
const mushBody: Doodle = (g, w, h, lw) => {
  const stem = mushStem(w, h), cap = mushCap(w, h), eyes = mushEyes(w, h), spots = mushSpots(w, h);
  fillWith(g, stem, 0.16, eyes);
  fillWith(g, cap, 0.26, spots);
  outline(g, stem, lw);
  outline(g, cap, lw);
  for (const s of spots) rim(g, s, lw);
  for (const e of eyes) rim(g, e, lw);
  line(g, [[w * 0.36, h * 0.58], [w * 0.46, h * 0.62]], lw, 0.85);
  line(g, [[w * 0.54, h * 0.62], [w * 0.64, h * 0.58]], lw, 0.85);
  line(g, [[w * 0.43, h * 0.82], [w * 0.5, h * 0.78], [w * 0.57, h * 0.82]], lw, 0.8);
};
const mushPupils: Doodle = (g, w, h) => pupils(g, mushEyes(w, h), 0.6);

// --- Привид: простирадло з хвилястим краєм ----------------------------------------------
function ghostPts(w: number, h: number): Vec2[] {
  const pts: Vec2[] = [];
  // ліва ручка-обрубок, купол, права ручка, хвилястий поділ — одним контуром
  pts.push([w * 0.14, h * 0.86], [w * 0.13, h * 0.64], [w * 0.04, h * 0.62], [w * 0.05, h * 0.53], [w * 0.13, h * 0.5]);
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI + (Math.PI * i) / 18;
    pts.push([w * 0.5 + Math.cos(a) * w * 0.37, h * 0.45 + Math.sin(a) * h * 0.4]);
  }
  pts.push([w * 0.87, h * 0.5], [w * 0.95, h * 0.55], [w * 0.93, h * 0.63], [w * 0.86, h * 0.63], [w * 0.86, h * 0.86]);
  const waves = 4;
  for (let i = 0; i <= waves * 4; i++) {
    const t = i / (waves * 4);
    pts.push([w * (0.86 - t * 0.72), h * (0.88 + Math.sin(t * Math.PI * waves) * 0.07)]);
  }
  return pts;
}
const ghostEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.38, y: h * 0.42, rx: w * 0.07, ry: h * 0.09 },
  { x: w * 0.58, y: h * 0.42, rx: w * 0.065, ry: h * 0.085 },
];
const ghostMouth = (w: number, h: number): Hole => ({ x: w * 0.47, y: h * 0.63, rx: w * 0.06, ry: h * 0.07 });
const ghostBody: Doodle = (g, w, h, lw) => {
  const pts = ghostPts(w, h), eyes = ghostEyes(w, h), m = ghostMouth(w, h);
  fillWith(g, pts, 0.16, [...eyes, m]);
  fillWith(g, shade(w * 0.5, h * 0.6, w * 0.36, h * 0.3), 0.1, [...eyes, m]);
  outline(g, pts, lw);
  rim(g, m, lw);
};
/** Очі привида — суцільні темні овали, без зіниць: так страшніше. */
const ghostPupils: Doodle = (g, w, h) => {
  for (const e of ghostEyes(w, h)) g.ellipse(e.x, e.y, e.rx, e.ry).fill({ color: W, alpha: 1 });
};

// =============================================================================
// ШВИДКІ
// =============================================================================

// --- Павук: голова й черевце торкаються, шість лап назовні ------------------------------
// Спільна коробка для тіла й обох трійок лап: лапи починаються на контурі й
// ідуть лише назовні — коліно й ступня завжди поза тілом.
const spAbd = (w: number, h: number): Ell => ({ cx: w * 0.6, cy: h * 0.5, rx: w * 0.17, ry: h * 0.3 });
const spHead = (w: number, h: number): Ell => ({ cx: w * 0.335, cy: h * 0.56, rx: w * 0.1, ry: h * 0.2 });
const spEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.3, y: h * 0.5, rx: w * 0.032, ry: h * 0.06 },
  { x: w * 0.365, y: h * 0.48, rx: w * 0.028, ry: h * 0.052 },
];
const spiderBody: Doodle = (g, w, h, lw) => {
  const a = spAbd(w, h), hd = spHead(w, h);
  ball(g, ballPts(a.cx, a.cy, a.rx, a.ry, 51), a, lw);
  ball(g, ballPts(hd.cx, hd.cy, hd.rx, hd.ry, 63), hd, lw, spEyes(w, h));
  for (const e of spEyes(w, h)) rim(g, e, lw * 0.9);
  line(g, [[a.cx - a.rx * 0.1, a.cy - a.ry * 0.9], [a.cx + a.rx * 0.25, a.cy], [a.cx - a.rx * 0.05, a.cy + a.ry * 0.9]], lw, 0.8);
};
const spiderPupils: Doodle = (g, w, h) => pupils(g, spEyes(w, h), 0.6);
function spiderLegs(g: Graphics, w: number, h: number, lw: number, set: number[]) {
  const a = spAbd(w, h), hd = spHead(w, h);
  const ab = ballPts(a.cx, a.cy, a.rx, a.ry, 51), he = ballPts(hd.cx, hd.cy, hd.rx, hd.ry, 63);
  const legs: Vec2[][] = [
    [at(he, 2.6), [w * 0.12, h * 0.2], [w * 0.03, h * 0.97]],
    [at(he, 1.9), [w * 0.2, h * 0.86], [w * 0.15, h * 0.98]],
    [at(ab, 2.3), [w * 0.46, h * 0.9], [w * 0.42, h * 0.99]],
    [at(ab, 1.3), [w * 0.66, h * 0.9], [w * 0.72, h * 0.99]],
    [at(ab, 0.7), [w * 0.86, h * 0.78], [w * 0.88, h * 0.99]],
    [at(ab, -0.2), [w * 0.9, h * 0.12], [w * 0.98, h * 0.97]],
  ];
  for (const i of set) line(g, legs[i], lw, 0.9);
}
const spiderLegsA: Doodle = (g, w, h, lw) => spiderLegs(g, w, h, lw, [0, 3, 4]);
const spiderLegsB: Doodle = (g, w, h, lw) => spiderLegs(g, w, h, lw, [1, 2, 5]);

// --- Кажан: кругле тільце з вухами, крила окремо збоку ---------------------------------
const batC = (w: number, h: number): Ell => ({ cx: w * 0.5, cy: h * 0.58, rx: w * 0.3, ry: h * 0.3 });
const batEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.4, y: h * 0.53, rx: w * 0.075, ry: h * 0.08 },
  { x: w * 0.6, y: h * 0.53, rx: w * 0.07, ry: h * 0.075 },
];
const batBody: Doodle = (g, w, h, lw) => {
  const c = batC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 71), eyes = batEyes(w, h);
  ball(g, b, c, lw, eyes);
  sprout(g, b, -2.45, -1.95, [[w * 0.2, h * 0.06]], lw);
  sprout(g, b, -1.2, -0.7, [[w * 0.8, h * 0.06]], lw);
  for (const e of eyes) rim(g, e, lw);
  line(g, [[w * 0.4, h * 0.72], [w * 0.5, h * 0.75], [w * 0.6, h * 0.72]], lw, 0.8);
  for (const x of [0.44, 0.56]) penPath(g, [[w * (x - 0.025), h * 0.735], [w * x, h * 0.82], [w * (x + 0.025), h * 0.74]], ink({ width: lw * 0.6, overshoot: 0 }));
};
const batPupils: Doodle = (g, w, h) => pupils(g, batEyes(w, h));
/** Крило: плече праворуч (там шарнір), перетинка фестонами вліво. */
const batWing: Doodle = (g, w, h, lw) => {
  const sh: Vec2 = [w * 0.97, h * 0.45];
  const pts: Vec2[] = [sh, [w * 0.6, h * 0.08], [w * 0.28, h * 0.04], [w * 0.03, h * 0.3], [w * 0.2, h * 0.5], [w * 0.1, h * 0.75], [w * 0.38, h * 0.68], [w * 0.45, h * 0.95], [w * 0.7, h * 0.7], [w * 0.97, h * 0.62]];
  fillWith(g, pts, 0.2);
  outline(g, pts, lw * 0.9);
  for (const t of [[0.28, 0.04], [0.03, 0.3], [0.1, 0.75]] as Vec2[]) line(g, [[w * 0.62, h * 0.3], [w * t[0], h * t[1]]], lw, 0.6);
  line(g, [sh, [w * 0.62, h * 0.3]], lw, 0.9);
};

// --- Щур: тіло, морда-виріст, вухо-виріст, хвіст окремо, лапки під черевом -------------
const ratC = (w: number, h: number): Ell => ({ cx: w * 0.58, cy: h * 0.55, rx: w * 0.25, ry: h * 0.3 });
const ratEye = (w: number, h: number): Hole[] => [{ x: w * 0.25, y: h * 0.48, rx: w * 0.035, ry: h * 0.065 }];
const ratBody: Doodle = (g, w, h, lw) => {
  const c = ratC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 91);
  ball(g, b, c, lw);
  // морда: виріст ліворуч від контуру, око в ній
  sprout(g, b, 2.55, 3.75, [[w * 0.2, h * 0.68], [w * 0.06, h * 0.6], [w * 0.13, h * 0.45], [w * 0.24, h * 0.36]], lw, 0.2, ratEye(w, h));
  rim(g, ratEye(w, h)[0], lw * 0.9);
  dot(g, w * 0.07, h * 0.6, lw * 1.1);
  for (const [y0, y1] of [[0.6, 0.55], [0.64, 0.7]]) line(g, [[w * 0.12, h * y0], [w * 0.01, h * y1]], lw, 0.45);
  // вухо: кругле, назовні
  sprout(g, b, -2.25, -1.75, [[w * 0.36, h * 0.12], [w * 0.44, h * 0.05], [w * 0.52, h * 0.14]], lw);
};
const ratPupils: Doodle = (g, w, h) => pupils(g, ratEye(w, h), 0.6);
function ratLegs(g: Graphics, w: number, h: number, lw: number, set: number[]) {
  const c = ratC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 91);
  const legs: Vec2[][] = [
    [at(b, 2.1), [w * 0.4, h * 0.92], [w * 0.34, h * 0.98]],
    [at(b, 1.75), [w * 0.5, h * 0.95], [w * 0.46, h * 0.99]],
    [at(b, 1.15), [w * 0.7, h * 0.95], [w * 0.66, h * 0.99]],
    [at(b, 0.75), [w * 0.8, h * 0.92], [w * 0.77, h * 0.98]],
  ];
  for (const i of set) line(g, legs[i], lw, 0.9);
}
const ratLegsA: Doodle = (g, w, h, lw) => ratLegs(g, w, h, lw, [0, 2]);
const ratLegsB: Doodle = (g, w, h, lw) => ratLegs(g, w, h, lw, [1, 3]);
/** Хвіст: шарнір ліворуч, закручується вгору-вправо. */
const ratTail: Doodle = (g, w, h, lw) => {
  line(g, [[w * 0.02, h * 0.7], [w * 0.3, h * 0.82], [w * 0.62, h * 0.7], [w * 0.85, h * 0.4], [w * 0.8, h * 0.12], [w * 0.62, h * 0.18]], lw, 0.85);
};

// --- Жук: панцир, голова торкається, вусики назовні ----------------------------------------
const bugShell = (w: number, h: number): Ell => ({ cx: w * 0.58, cy: h * 0.5, rx: w * 0.26, ry: h * 0.32 });
const bugHead = (w: number, h: number): Ell => ({ cx: w * 0.235, cy: h * 0.58, rx: w * 0.09, ry: h * 0.17 });
const bugEye = (w: number, h: number): Hole[] => [{ x: w * 0.21, y: h * 0.54, rx: w * 0.03, ry: h * 0.05 }];
const bugBody: Doodle = (g, w, h, lw) => {
  const s = bugShell(w, h), hd = bugHead(w, h);
  const sb = ballPts(s.cx, s.cy, s.rx, s.ry, 33), hb = ballPts(hd.cx, hd.cy, hd.rx, hd.ry, 43);
  const spots: Hole[] = [
    { x: w * 0.5, y: h * 0.38, rx: w * 0.035, ry: h * 0.055 },
    { x: w * 0.67, y: h * 0.4, rx: w * 0.04, ry: h * 0.06 },
    { x: w * 0.6, y: h * 0.64, rx: w * 0.035, ry: h * 0.05 },
  ];
  ball(g, sb, s, lw, spots);
  for (const sp of spots) rim(g, sp, lw * 0.8);
  line(g, [[s.cx - s.rx * 0.15, s.cy - s.ry * 0.97], [s.cx - s.rx * 0.05, s.cy + s.ry * 0.97]], lw, 0.8);
  ball(g, hb, hd, lw, bugEye(w, h));
  rim(g, bugEye(w, h)[0], lw * 0.85);
  for (const [a, tx, ty] of [[-2.3, 0.04, 0.08], [-1.7, 0.2, 0.02]]) {
    const p = at(hb, a);
    line(g, [p, [(p[0] + w * tx) / 2, h * 0.2], [w * tx, h * ty]], lw, 0.7);
  }
};
const bugPupils: Doodle = (g, w, h) => pupils(g, bugEye(w, h), 0.6);
function bugLegs(g: Graphics, w: number, h: number, lw: number, set: number[]) {
  const s = bugShell(w, h), sb = ballPts(s.cx, s.cy, s.rx, s.ry, 33);
  const legs: Vec2[][] = [
    [at(sb, 2.4), [w * 0.3, h * 0.9], [w * 0.26, h * 0.99]],
    [at(sb, 1.8), [w * 0.46, h * 0.95], [w * 0.42, h * 0.99]],
    [at(sb, 1.3), [w * 0.64, h * 0.95], [w * 0.62, h * 0.99]],
    [at(sb, 0.8), [w * 0.8, h * 0.9], [w * 0.84, h * 0.99]],
    [at(sb, 0.3), [w * 0.92, h * 0.75], [w * 0.97, h * 0.97]],
    [at(sb, 2.0), [w * 0.38, h * 0.94], [w * 0.34, h * 0.99]],
  ];
  for (const i of set) line(g, legs[i], lw, 0.8);
}
const bugLegsA: Doodle = (g, w, h, lw) => bugLegs(g, w, h, lw, [0, 2, 4]);
const bugLegsB: Doodle = (g, w, h, lw) => bugLegs(g, w, h, lw, [5, 1, 3]);

// =============================================================================
// БРОНЬОВАНІ
// =============================================================================

// --- Огр у шоломі: шолом вирізаний із тіла, ріжки ростуть із шолома ----------------------
const ogC = (w: number, h: number): Ell => ({ cx: w * 0.5, cy: h * 0.63, rx: w * 0.42, ry: h * 0.34 });
const ogEyes = (w: number, h: number): Hole[] => [
  { x: w * 0.37, y: h * 0.58, rx: w * 0.05, ry: h * 0.045 },
  { x: w * 0.55, y: h * 0.58, rx: w * 0.048, ry: h * 0.043 },
];
/** Шолом — верх кулі над лінією обідка, замкнений хордою. */
function ogHelmet(w: number, h: number): Vec2[] {
  const c = ogC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 151), y = h * 0.5;
  const n = b.length;
  const i0 = b.findIndex((p, i) => p[1] < y && b[(i - 1 + n) % n][1] >= y);
  const top: Vec2[] = [];
  for (let k = 0; k < n; k++) { const p = b[(i0 + k) % n]; if (p[1] >= y) break; top.push(p); }
  return [[top[0][0], y], ...top, [top[top.length - 1][0], y]];
}
const ogreBody: Doodle = (g, w, h, lw) => {
  const c = ogC(w, h), b = ballPts(c.cx, c.cy, c.rx, c.ry, 151), eyes = ogEyes(w, h);
  ball(g, b, c, lw, eyes, [ogHelmet(w, h)]);
  for (const e of eyes) rim(g, e, lw * 0.9);
  line(g, [[w * 0.45, h * 0.6], [w * 0.4, h * 0.69], [w * 0.48, h * 0.7]], lw, 0.8);
  line(g, [[w * 0.27, h * 0.78], [w * 0.45, h * 0.83], [w * 0.64, h * 0.77]], lw, 0.95);
  for (const x of [0.33, 0.56]) penPath(g, [[w * (x - 0.025), h * 0.81], [w * x, h * 0.73], [w * (x + 0.025), h * 0.815]], ink({ width: lw * 0.65, overshoot: 0 }));
};
/** Шолом олівцем: каска, гребінь, заклепки по обідку, ріжки назовні. */
const ogreHelmet: Doodle = (g, w, h, lw) => {
  const hp = ogHelmet(w, h), y = h * 0.5;
  fillWith(g, hp, 0.28);
  outline(g, hp, lw);
  line(g, [[w * 0.5, hp.reduce((m, p) => Math.min(m, p[1]), h)], [w * 0.5, y]], lw, 0.7);
  for (const x of [0.2, 0.34, 0.66, 0.8]) dot(g, w * x, y - h * 0.025, lw * 0.6);
  for (const s of [-1, 1]) {
    const horn = hornPts([w * (0.5 + s * 0.27), h * 0.36], [w * (0.5 + s * 0.48), h * 0.3], [w * (0.5 + s * 0.42), h * 0.03], w * 0.1);
    fillWith(g, horn, 0.3);
    outline(g, horn, lw * 0.85);
  }
};
const ogrePupils: Doodle = (g, w, h) => pupils(g, ogEyes(w, h), 0.6);
/** Дубина: руків'я праворуч у руці, суковата голова ліворуч. */
const club: Doodle = (g, w, h, lw) => {
  const pts: Vec2[] = [[w * 0.98, h * 0.45], [w * 0.58, h * 0.38], [w * 0.22, h * 0.1], [w * 0.05, h * 0.28], [w * 0.04, h * 0.72], [w * 0.22, h * 0.9], [w * 0.58, h * 0.62], [w * 0.98, h * 0.6]];
  fillWith(g, pts, 0.24);
  outline(g, pts, lw);
  line(g, [[w * 0.18, h * 0.4], [w * 0.25, h * 0.52]], lw, 0.55);
};

// --- Лицар-відро: тулуб, відро-шолом із візором, щит збоку -------------------------------
const knTorso = (w: number, h: number): Vec2[] => [[w * 0.3, h * 0.52], [w * 0.7, h * 0.52], [w * 0.8, h * 0.94], [w * 0.2, h * 0.94]];
const knBucket = (w: number, h: number): Vec2[] => [[w * 0.33, h * 0.12], [w * 0.67, h * 0.12], [w * 0.71, h * 0.52], [w * 0.29, h * 0.52]];
const knVisor = (w: number, h: number): Vec2[] => [[w * 0.35, h * 0.27], [w * 0.66, h * 0.27], [w * 0.66, h * 0.34], [w * 0.35, h * 0.34]];
const knightBody: Doodle = (g, w, h, lw) => {
  const t = knTorso(w, h);
  fillWith(g, t, 0.2);
  fillWith(g, [[w * 0.56, h * 0.52], [w * 0.7, h * 0.52], [w * 0.8, h * 0.94], [w * 0.63, h * 0.94]], 0.12);
  outline(g, t, lw);
  line(g, [[w * 0.23, h * 0.8], [w * 0.77, h * 0.8]], lw, 0.8);
  // плюмаж: виріст угору з верху відра — на тіло не лягає
  const plume: Vec2[] = [[w * 0.45, h * 0.12], [w * 0.38, h * 0.05], [w * 0.5, h * 0.0], [w * 0.62, h * 0.03], [w * 0.56, h * 0.12]];
  fillWith(g, plume, 0.3);
  outline(g, plume, lw * 0.85);
};
/** Відро олівцем з вирізаним візором і заклепками. */
const knightHelmet: Doodle = (g, w, h, lw) => {
  const b = knBucket(w, h);
  fillWith(g, b, 0.3, [], [knVisor(w, h)]);
  outline(g, b, lw);
  outline(g, knVisor(w, h), lw * 0.8);
  line(g, [[w * 0.5, h * 0.34], [w * 0.5, h * 0.5]], lw, 0.6);
  for (const [x, y] of [[0.38, 0.18], [0.62, 0.18], [0.36, 0.46], [0.64, 0.46]]) dot(g, w * x, h * y, lw * 0.55);
};
/** Очі у візорі — дві жарини маркером. */
const knightGlow: Doodle = (g, w, h) => {
  g.rect(w * 0.39, h * 0.285, w * 0.07, h * 0.04).fill({ color: W, alpha: 1 });
  g.rect(w * 0.53, h * 0.285, w * 0.07, h * 0.04).fill({ color: W, alpha: 1 });
};
/** Щит олівцем: гербова форма з поясом і заклепкою. Шарнір праворуч. */
const shield: Doodle = (g, w, h, lw) => {
  const pts: Vec2[] = [[w * 0.08, h * 0.06], [w * 0.92, h * 0.06], [w * 0.9, h * 0.55], [w * 0.5, h * 0.96], [w * 0.1, h * 0.55]];
  fillWith(g, pts, 0.28);
  outline(g, pts, lw);
  line(g, [[w * 0.1, h * 0.36], [w * 0.9, h * 0.36]], lw, 0.8);
  dot(g, w * 0.5, h * 0.2, lw * 0.9);
};

// --- Черепаха: панцир олівцем, голова й ноги окремо від нього ----------------------------
function tuShell(w: number, h: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI + (Math.PI * i) / 24;
    pts.push([w * 0.6 + Math.cos(a) * w * 0.34, h * 0.62 + Math.sin(a) * h * 0.52]);
  }
  return pts;
}
const tuHead = (w: number, h: number): Ell => ({ cx: w * 0.14, cy: h * 0.56, rx: w * 0.105, ry: h * 0.17 });
const tuEye = (w: number, h: number): Hole[] => [{ x: w * 0.12, y: h * 0.51, rx: w * 0.032, ry: h * 0.05 }];
const turtleBody: Doodle = (g, w, h, lw) => {
  // черево: смуга під панциром, торкається його основи
  const belly: Vec2[] = [[w * 0.27, h * 0.62], [w * 0.93, h * 0.62], [w * 0.9, h * 0.74], [w * 0.3, h * 0.74]];
  fillWith(g, belly, 0.2);
  outline(g, belly, lw);
  const hd = tuHead(w, h);
  ball(g, ballPts(hd.cx, hd.cy, hd.rx, hd.ry, 29), hd, lw, tuEye(w, h));
  rim(g, tuEye(w, h)[0], lw * 0.85);
  line(g, [[w * 0.06, h * 0.45], [w * 0.17, h * 0.47]], lw, 0.9);
  line(g, [[w * 0.05, h * 0.64], [w * 0.14, h * 0.66]], lw, 0.75);
  const tail: Vec2[] = [[w * 0.93, h * 0.64], [w * 0.99, h * 0.7], [w * 0.92, h * 0.72]];
  fillWith(g, tail, 0.2);
  outline(g, tail, lw * 0.8, false);
};
/** Панцир олівцем: купол, пластини, обідок — він і є броня. */
const turtleShell: Doodle = (g, w, h, lw) => {
  const s = tuShell(w, h);
  fillWith(g, s, 0.3);
  outline(g, s, lw);
  line(g, [[w * 0.36, h * 0.5], [w * 0.84, h * 0.5]], lw, 0.7);
  for (const x of [0.48, 0.6, 0.72]) line(g, [[w * x, h * 0.5], [w * (x + (x - 0.6) * 0.3), h * 0.17]], lw, 0.7);
};
const turtlePupils: Doodle = (g, w, h) => pupils(g, tuEye(w, h), 0.6);

// --- Голем: кам'яні брили, що торкаються гранями ------------------------------------------
const goTorso = (w: number, h: number): Vec2[] => [[w * 0.28, h * 0.38], [w * 0.7, h * 0.38], [w * 0.8, h * 0.55], [w * 0.74, h * 0.92], [w * 0.28, h * 0.92], [w * 0.2, h * 0.6]];
const goHead = (w: number, h: number): Vec2[] => [[w * 0.38, h * 0.12], [w * 0.6, h * 0.1], [w * 0.66, h * 0.24], [w * 0.62, h * 0.38], [w * 0.38, h * 0.38], [w * 0.34, h * 0.24]];
const golemBody: Doodle = (g, w, h, lw) => {
  const t = goTorso(w, h), hd = goHead(w, h);
  fillWith(g, t, 0.22);
  fillWith(g, [[w * 0.56, h * 0.38], [w * 0.7, h * 0.38], [w * 0.8, h * 0.55], [w * 0.74, h * 0.92], [w * 0.6, h * 0.92]], 0.12);
  outline(g, t, lw);
  fillWith(g, hd, 0.22);
  outline(g, hd, lw);
  // тріщини
  line(g, [[w * 0.42, h * 0.5], [w * 0.48, h * 0.6], [w * 0.44, h * 0.7]], lw, 0.6);
  line(g, [[w * 0.62, h * 0.75], [w * 0.68, h * 0.83]], lw, 0.6);
};
/** Очі голема — жарини маркером у щілинах. */
const golemGlow: Doodle = (g, w, h) => {
  g.poly([w * 0.39, h * 0.21, w * 0.47, h * 0.235, w * 0.46, h * 0.265, w * 0.39, h * 0.25]).fill({ color: W, alpha: 1 });
  g.poly([w * 0.52, h * 0.235, w * 0.6, h * 0.21, w * 0.6, h * 0.25, w * 0.53, h * 0.265]).fill({ color: W, alpha: 1 });
};
/** Рука-брила: шарнір угорі праворуч (плече), звисає вниз-уліво. */
const golemArm: Doodle = (g, w, h, lw) => {
  const pts: Vec2[] = [[w * 0.6, h * 0.04], [w * 0.95, h * 0.1], [w * 0.8, h * 0.55], [w * 0.62, h * 0.96], [w * 0.15, h * 0.9], [w * 0.1, h * 0.55], [w * 0.3, h * 0.2]];
  fillWith(g, pts, 0.22);
  outline(g, pts, lw);
  line(g, [[w * 0.3, h * 0.55], [w * 0.55, h * 0.6]], lw, 0.55);
};
const golemFoot: Doodle = (g, w, h, lw) => {
  const pts: Vec2[] = [[w * 0.12, h * 0.1], [w * 0.85, h * 0.06], [w * 0.95, h * 0.9], [w * 0.05, h * 0.92]];
  fillWith(g, pts, 0.22);
  outline(g, pts, lw * 0.85);
};

// =============================================================================
// Корона боса: маркером — суцільна, як і належить коштовності.
// =============================================================================
const crownPts = (w: number, h: number): Vec2[] => [
  [w * 0.04, h * 0.95], [w * 0.04, h * 0.35], [w * 0.25, h * 0.6], [w * 0.5, h * 0.05],
  [w * 0.75, h * 0.6], [w * 0.96, h * 0.35], [w * 0.96, h * 0.95],
];
const crownFill: Doodle = (g, w, h) => { g.poly(flat(crownPts(w, h))).fill({ color: W, alpha: 1 }); };
const crownLine: Doodle = (g, w, h, lw) => outline(g, crownPts(w, h), lw);

export const MONSTERS: Record<string, Doodle> = {
  m_foot: foot,
  m_paw: paw,
  m_club: club,
  m_shield: shield,
  imp_body: impBody,
  imp_pupils: impPupils,
  slime_body: slimeBody,
  slime_pupils: slimePupils,
  cyc_body: cycBody,
  cyc_pupils: cycPupils,
  mush_body: mushBody,
  mush_pupils: mushPupils,
  ghost_body: ghostBody,
  ghost_pupils: ghostPupils,
  spider_body: spiderBody,
  spider_pupils: spiderPupils,
  spider_legs_a: spiderLegsA,
  spider_legs_b: spiderLegsB,
  bat_body: batBody,
  bat_pupils: batPupils,
  bat_wing: batWing,
  rat_body: ratBody,
  rat_pupils: ratPupils,
  rat_legs_a: ratLegsA,
  rat_legs_b: ratLegsB,
  rat_tail: ratTail,
  bug_body: bugBody,
  bug_pupils: bugPupils,
  bug_legs_a: bugLegsA,
  bug_legs_b: bugLegsB,
  ogre_body: ogreBody,
  ogre_helmet: ogreHelmet,
  ogre_pupils: ogrePupils,
  knight_body: knightBody,
  knight_helmet: knightHelmet,
  knight_glow: knightGlow,
  turtle_body: turtleBody,
  turtle_shell: turtleShell,
  turtle_pupils: turtlePupils,
  golem_body: golemBody,
  golem_glow: golemGlow,
  golem_arm: golemArm,
  golem_foot: golemFoot,
  crown_fill: crownFill,
  crown_line: crownLine,
};
