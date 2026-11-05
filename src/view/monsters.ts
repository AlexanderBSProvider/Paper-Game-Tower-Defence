// Вороги режиму lane — чистий стиль.
//
// Друга спроба. Перша «заливала» тіла штриховкою пером, і власник сказав
// прямо: забагато замальовки, вороги дивні. Тепер правило інше:
//   - чіткий контур одним товстим штрихом;
//   - усередині — світла рівна заливка тим самим кольором (як маркер, що ледь
//     торкнувся паперу) і ще одна, трохи темніша, — тінь справа знизу;
//   - очі — дірки в заливці: крізь них видно папір, тож вони «білі»;
//   - деталей мало: один-два акценти на ворога, не більше.
//
// Два набори, щоб власник обрав:
//   A — його силуети зі скетчу: сніговик, павучок, рогатий з крилами;
//   B — нові: вухань-яйце з довгими вухами й великими очима, здоровань у шоломі.
// Павучок спільний.
//
// Усе — МАСКИ (біле на прозорому), колір дає перо частини в rigs.json.

import type { Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penPath } from './ink.js';
import type { PenOpts } from './ink.js';
import type { Vec2 } from '../types.js';

type Doodle = (g: Graphics, w: number, h: number, lw: number) => void;

const W = '#ffffff';
const ink = (o: PenOpts = {}): PenOpts => ({ color: W, halo: 0.06, ...o });

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Нерівна куля: рука не малює циркулем. */
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, wob = 0.04, n = 30): Vec2[] {
  const r = seeded(seed);
  const ph = r() * 6.28, ph2 = r() * 6.28;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * (Math.sin(a * 2 + ph) * 0.6 + Math.sin(a * 3 + ph2) * 0.4);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/** Півмісяць тіні справа знизу (світло — зліва згори, як в усьому зошиті). */
function shadeOf(cx: number, cy: number, rx: number, ry: number): Vec2[] {
  const out: Vec2[] = [], back: Vec2[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = -0.5 + (2.6 * i) / 16;
    out.push([cx + Math.cos(a) * rx * 0.98, cy + Math.sin(a) * ry * 0.98]);
    back.push([cx - rx * 0.16 + Math.cos(a) * rx * 0.8, cy - ry * 0.16 + Math.sin(a) * ry * 0.8]);
  }
  return [...out, ...back.reverse()];
}

const flat = (pts: Vec2[]) => pts.flat();

interface Hole { x: number; y: number; r: number; ry?: number }

/**
 * Тіло: світла заливка з дірками-очима, тінь, контур.
 * @param holes де вирізати заливку: крізь дірку видно папір — «білі» очі
 */
function shape(g: Graphics, pts: Vec2[], lw: number, o: { fill?: number; shade?: Vec2[] | null; holes?: Hole[] } = {}) {
  g.poly(flat(pts)).fill({ color: W, alpha: o.fill ?? 0.2 });
  for (const h of o.holes ?? []) g.ellipse(h.x, h.y, h.r, h.ry ?? h.r).cut();
  if (o.shade) {
    g.poly(flat(o.shade)).fill({ color: W, alpha: 0.16 });
    for (const h of o.holes ?? []) g.ellipse(h.x, h.y, h.r, h.ry ?? h.r).cut();
  }
  penPath(g, pts, ink({ width: lw * 1.15, closed: true, jitter: lw * 0.12, overshoot: lw * 0.4, step: lw * 3, pressure: 0.25 }));
}

/** Куля: shape для нерівного кола з тінню. */
function ball(g: Graphics, cx: number, cy: number, rx: number, ry: number, lw: number, seed: number, holes?: Hole[]) {
  const pts = blob(cx, cy, rx, ry, seed);
  shape(g, pts, lw, { shade: shadeOf(cx, cy, rx, ry), holes });
  return pts;
}

/** Жирна точка: зіниця, вуглинка. */
function dot(g: Graphics, x: number, y: number, r: number) {
  g.circle(x, y, r).fill({ color: W, alpha: 1 });
}

/** Обідок ока довкола дірки. */
function eyeRim(g: Graphics, x: number, y: number, r: number, lw: number, ry = r) {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * ry]); }
  penStroke(g, pts, ink({ width: lw * 0.75, overshoot: 0, jitter: lw * 0.08, step: lw * 2 }));
}

// =============================================================================
// A1 — сніговик (зі скетчу): дві кулі, вуглинки-очі, рука-гілка, морквина.
// =============================================================================

function snowBody(g: Graphics, w: number, h: number, lw: number) {
  ball(g, w * 0.5, h * 0.53, w * 0.44, h * 0.43, lw, 11);
  for (const y of [0.38, 0.56]) dot(g, w * 0.42, h * y, lw * 0.9);
}

function snowFoot(g: Graphics, w: number, h: number, lw: number) {
  ball(g, w * 0.5, h * 0.52, w * 0.42, h * 0.36, lw * 0.85, 23);
}

/** Рука-гілка: від плеча (праворуч) до кисті (ліворуч), три пальці-гілочки. */
function snowArm(g: Graphics, w: number, h: number, lw: number) {
  const hand: Vec2 = [w * 0.16, h * 0.5];
  penStroke(g, [[w * 0.95, h * 0.5], [w * 0.6, h * 0.44], [w * 0.35, h * 0.54], hand], ink({ width: lw * 1.0, pressure: 0.35 }));
  for (const [ex, ey] of [[0.03, 0.25], [0.0, 0.52], [0.06, 0.8]] as Vec2[]) {
    penStroke(g, [hand, [w * ex, h * ey]], ink({ width: lw * 0.7 }));
  }
}

/** Голова: куля з насупленими бровами. Очі й рот — окремо олівцем. */
function snowHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.6, rx = w * 0.38, ry = h * 0.36;
  ball(g, cx, cy, rx, ry, lw, 37);
  for (const s of [-1, 1]) {
    penStroke(g, [[cx + s * rx * 0.62 - rx * 0.12, cy - ry * 0.5], [cx + s * rx * 0.14 - rx * 0.12, cy - ry * 0.28]], ink({ width: lw * 1.0, pressure: 0.4 }));
  }
}

/** Очі-вуглинки: дві жирні точки, що дивляться вліво. */
function snowEyes(g: Graphics, w: number, h: number, lw: number) {
  for (const s of [-1, 1]) dot(g, w * 0.5 + s * w * 0.24 - w * 0.04, h * 0.5, Math.min(w * 0.11, h * 0.36));
}

/** Рот: криві вуглинки підковою донизу — сердитий. */
function snowMouth(g: Graphics, w: number, h: number, lw: number) {
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    dot(g, w * (0.12 + t * 0.76), h * (0.75 - Math.sin(t * Math.PI) * 0.45), lw * 0.75);
  }
}

/** Ніс-морквина вістрям уліво: єдиний помаранчевий акцент. */
function snowNose(g: Graphics, w: number, h: number, lw: number) {
  const tri: Vec2[] = [[w * 0.98, h * 0.15], [w * 0.04, h * 0.55], [w * 0.98, h * 0.88]];
  shape(g, tri, lw * 0.8, { fill: 0.55 });
}

// =============================================================================
// Спільний — павучок-бігун: кругле черевце, велика голова з очима, шість лапок.
// =============================================================================

/**
 * Трійка лап на один такт (тринога, як у комах). Павук дивиться вліво, тож
 * ліві лапи — передні, праві — задні. Лапи розведені віялом далеко за тіло:
 * коліно високо над спиною, ступня далеко вбік — інакше шість ліній злипаються
 * під черевцем у мазанину.
 */
function crawlLegs(g: Graphics, w: number, h: number, lw: number, swap: boolean) {
  const cx = w * 0.5, hipY = h * 0.5;
  const k = swap ? -1 : 1;
  // [бік, номер у віялі 0..2]: 0 — найближча до тіла, 2 — найдальша
  const legs: [number, number][] = [[-k, 2], [k, 1], [-k, 0]];
  for (const [s, n] of legs) {
    const hip: Vec2 = [cx + s * w * 0.06, hipY];
    const knee: Vec2 = [cx + s * w * (0.16 + n * 0.08), h * (0.04 + n * 0.03)];
    const foot: Vec2 = [cx + s * w * (0.27 + n * 0.1), h * 0.96];
    penStroke(g, [hip, knee, foot], ink({ width: lw * 1.0, pressure: 0.15, halo: 0, jitter: lw * 0.1, overshoot: 0 }));
  }
}
const crawlLegsA: Doodle = (g, w, h, lw) => crawlLegs(g, w, h, lw, false);
const crawlLegsB: Doodle = (g, w, h, lw) => crawlLegs(g, w, h, lw, true);

/** Черевце: одна смужка — і досить. */
function crawlBody(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.55, cy = h * 0.55, rx = w * 0.42, ry = h * 0.38;
  ball(g, cx, cy, rx, ry, lw, 51);
  penStroke(g, [[cx, cy - ry * 0.95], [cx + rx * 0.18, cy], [cx + rx * 0.02, cy + ry * 0.95]], ink({ width: lw * 0.8 }));
}

/** Голова з двома великими очима-дірками й іклами. */
function crawlHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.55, cy = h * 0.45, rx = w * 0.38, ry = h * 0.36;
  const eyes: Hole[] = [{ x: cx - rx * 0.42, y: cy - ry * 0.12, r: rx * 0.3 }, { x: cx + rx * 0.2, y: cy - ry * 0.2, r: rx * 0.27 }];
  ball(g, cx, cy, rx, ry, lw, 63, eyes);
  for (const e of eyes) eyeRim(g, e.x, e.y, e.r, lw);
  for (const s of [-1, 1]) {
    const x0 = cx - rx * 0.25 + s * rx * 0.2;
    penStroke(g, [[x0, cy + ry * 0.75], [x0 - rx * 0.12, cy + ry * 1.25]], ink({ width: lw * 0.8, overshoot: 0 }));
  }
}

/** Очі павучка тепер дірки в голові; маркерний відблиск лишаємо ледь-ледь. */
function crawlEyes(g: Graphics, w: number, h: number) {
  g.circle(w * 0.5, h * 0.5, 0.01).fill({ color: W, alpha: 0 });
}
/** Зіниці дивляться вліво. */
function crawlPupils(g: Graphics, w: number, h: number) {
  for (const [x, y] of [[0.2, 0.62], [0.58, 0.55]]) dot(g, w * x, h * y, Math.min(w, h) * 0.26);
}

// =============================================================================
// A3 — рогатий з крилами (зі скетчу).
// =============================================================================

/** Крило: три кістки віялом і світла перетинка фестонами. Плече праворуч. */
function hornWing(g: Graphics, w: number, h: number, lw: number) {
  const sh: Vec2 = [w * 0.92, h * 0.78], elbow: Vec2 = [w * 0.62, h * 0.3];
  const tips: Vec2[] = [[w * 0.55, h * 0.05], [w * 0.16, h * 0.13], [w * 0.04, h * 0.5]];
  const edge: Vec2[] = [tips[0], [w * 0.38, h * 0.33], tips[1], [w * 0.21, h * 0.43], tips[2], [w * 0.42, h * 0.62], [w * 0.62, h * 0.67], sh];
  g.poly(flat([elbow, ...edge])).fill({ color: W, alpha: 0.18 });
  penStroke(g, edge, ink({ width: lw * 0.8 }));
  penStroke(g, [sh, elbow], ink({ width: lw * 1.1, pressure: 0.3 }));
  for (const t of tips) penStroke(g, [elbow, t], ink({ width: lw * 0.75 }));
}

function hornBody(g: Graphics, w: number, h: number, lw: number) {
  ball(g, w * 0.5, h * 0.55, w * 0.44, h * 0.42, lw, 77);
  // пупок-ромбик: дрібниця, що робить живіт животом
  penStroke(g, [[w * 0.44, h * 0.62], [w * 0.47, h * 0.68]], ink({ width: lw * 0.6, overshoot: 0 }));
}

/** Ріг: квадратична крива, товщина спадає до вістря. */
function hornShape(base: Vec2, bend: Vec2, tip: Vec2, width: number): Vec2[] {
  const at = (t: number): Vec2 => {
    const u = 1 - t;
    return [u * u * base[0] + 2 * u * t * bend[0] + t * t * tip[0], u * u * base[1] + 2 * u * t * bend[1] + t * t * tip[1]];
  };
  const side = (t: number, k: number): Vec2 => {
    const a = at(Math.max(0, t - 0.01)), b = at(Math.min(1, t + 0.01)), p = at(t);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const half = (width / 2) * (1 - t) ** 0.8;
    return [p[0] - ((b[1] - a[1]) / len) * half * k, p[1] + ((b[0] - a[0]) / len) * half * k];
  };
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i <= 14; i++) { left.push(side(i / 14, 1)); right.push(side(i / 14, -1)); }
  return [...left, ...right.reverse()];
}

function hornHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.6, rx = w * 0.34, ry = h * 0.3;
  for (const s of [-1, 1]) {
    shape(g, hornShape([cx + s * rx * 0.55, cy - ry * 0.7], [cx + s * rx * 1.5, cy - ry * 1.05], [cx + s * rx * 1.05, h * 0.04], rx * 0.4), lw * 0.9, { fill: 0.3 });
  }
  ball(g, cx, cy, rx, ry, lw, 91);
  // насуплена брова однією лінією й паща з двома іклами
  penStroke(g, [[cx - rx * 0.8, cy - ry * 0.48], [cx - rx * 0.1, cy - ry * 0.15], [cx + rx * 0.1, cy - ry * 0.15], [cx + rx * 0.8, cy - ry * 0.48]], ink({ width: lw * 1.0, pressure: 0.4 }));
  penStroke(g, [[cx - rx * 0.6, cy + ry * 0.4], [cx + rx * 0.45, cy + ry * 0.42]], ink({ width: lw * 0.85 }));
  for (const x of [-0.42, 0.25]) {
    const x0 = cx + rx * x, y0 = cy + ry * 0.41;
    penPath(g, [[x0 - rx * 0.09, y0], [x0, y0 + ry * 0.42], [x0 + rx * 0.09, y0]], ink({ width: lw * 0.65, overshoot: 0 }));
  }
}

/** Очі-щілини маркером — світяться з-під брови. */
function hornEyes(g: Graphics, w: number, h: number) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.25;
    g.poly([cx - w * 0.16, h * 0.32, cx + w * 0.15, h * (s < 0 ? 0.48 : 0.22), cx + w * 0.12, h * 0.85, cx - w * 0.15, h * 0.85]).fill({ color: W, alpha: 1 });
  }
}
function hornPupils(g: Graphics, w: number, h: number) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.25 - w * 0.06;
    g.rect(cx - w * 0.03, h * 0.4, w * 0.06, h * 0.42).fill({ color: W, alpha: 1 });
  }
}

/** Наплічник і палиця лишились для боса B; у чистому стилі — без штриховки. */
function hornArmor(g: Graphics, w: number, h: number, lw: number) {
  const plate: Vec2[] = [[w * 0.2, h * 0.3], [w * 0.75, h * 0.24], [w * 0.8, h * 0.62], [w * 0.5, h * 0.95], [w * 0.22, h * 0.66]];
  shape(g, plate, lw, { fill: 0.25 });
  for (const [x, y] of [[0.3, 0.38], [0.66, 0.34], [0.5, 0.75]]) dot(g, w * x, h * y, lw * 0.7);
}

function hornClub(g: Graphics, w: number, h: number, lw: number) {
  penStroke(g, [[w * 0.98, h * 0.58], [w * 0.42, h * 0.5]], ink({ width: lw * 1.3, pressure: 0.3 }));
  ball(g, w * 0.26, h * 0.5, w * 0.18, h * 0.36, lw, 103);
}

function hornFoot(g: Graphics, w: number, h: number, lw: number) {
  ball(g, w * 0.5, h * 0.55, w * 0.44, h * 0.38, lw * 0.85, 117);
}

// =============================================================================
// B1 — вухань-яйце: одне тіло з довгими вухами, великі очі-дірки, два ікла.
// =============================================================================

function impBody(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.64, rx = w * 0.34, ry = h * 0.34;
  // Вуха — довгі, гострі, трохи врозліт: за них його й звуть.
  for (const s of [-1, 1]) {
    const ear: Vec2[] = [[cx + s * rx * 0.3, cy - ry * 0.85], [cx + s * rx * 1.35, h * 0.04], [cx + s * rx * 0.9, cy - ry * 0.45]];
    shape(g, ear, lw * 0.95, { fill: 0.24 });
    penStroke(g, [[cx + s * rx * 0.55, cy - ry * 0.75], [cx + s * rx * 1.08, h * 0.2]], ink({ width: lw * 0.55, overshoot: 0 }));
  }
  const eyes: Hole[] = [
    { x: cx - rx * 0.42, y: cy - ry * 0.18, r: rx * 0.27, ry: ry * 0.32 },
    { x: cx + rx * 0.22, y: cy - ry * 0.18, r: rx * 0.25, ry: ry * 0.3 },
  ];
  ball(g, cx, cy, rx, ry, lw, 131, eyes);
  for (const e of eyes) eyeRim(g, e.x, e.y, e.r, lw, e.ry);
  // насуплені брови над очима
  penStroke(g, [[cx - rx * 0.72, cy - ry * 0.58], [cx - rx * 0.2, cy - ry * 0.42]], ink({ width: lw * 0.95 }));
  penStroke(g, [[cx + rx * 0.0, cy - ry * 0.44], [cx + rx * 0.48, cy - ry * 0.6]], ink({ width: lw * 0.95 }));
  // рот і два ікла донизу
  penStroke(g, [[cx - rx * 0.45, cy + ry * 0.38], [cx - rx * 0.05, cy + ry * 0.48], [cx + rx * 0.3, cy + ry * 0.36]], ink({ width: lw * 0.85 }));
  for (const x of [-0.32, 0.12]) {
    penPath(g, [[cx + rx * x - rx * 0.07, cy + ry * 0.43], [cx + rx * x, cy + ry * 0.66], [cx + rx * x + rx * 0.07, cy + ry * 0.43]], ink({ width: lw * 0.6, overshoot: 0 }));
  }
}

/** Зіниці вуханя: дивляться вліво, кліпають. */
function impPupils(g: Graphics, w: number, h: number) {
  dot(g, w * 0.17, h * 0.56, Math.min(w, h) * 0.32);
  dot(g, w * 0.835, h * 0.56, Math.min(w, h) * 0.3);
}

function impFoot(g: Graphics, w: number, h: number, lw: number) {
  ball(g, w * 0.5, h * 0.55, w * 0.42, h * 0.36, lw * 0.85, 141);
}

/** Лапка-ручка: коротка, з трьома кігтиками. */
function impArm(g: Graphics, w: number, h: number, lw: number) {
  const hand: Vec2 = [w * 0.2, h * 0.55];
  penStroke(g, [[w * 0.95, h * 0.45], [w * 0.5, h * 0.42], hand], ink({ width: lw * 1.0 }));
  for (const [ex, ey] of [[0.04, 0.3], [0.02, 0.6], [0.1, 0.88]] as Vec2[]) penStroke(g, [hand, [w * ex, h * ey]], ink({ width: lw * 0.6 }));
}

// =============================================================================
// B3 — здоровань у шоломі: широкий, з іклами знизу й дерев'яною палицею.
// =============================================================================

function ogreBody(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.56, rx = w * 0.44, ry = h * 0.42;
  const eyes: Hole[] = [
    { x: cx - rx * 0.4, y: cy - ry * 0.12, r: rx * 0.13, ry: ry * 0.12 },
    { x: cx + rx * 0.05, y: cy - ry * 0.12, r: rx * 0.12, ry: ry * 0.11 },
  ];
  ball(g, cx, cy, rx, ry, lw, 151, eyes);
  for (const e of eyes) eyeRim(g, e.x, e.y, e.r, lw * 0.9, e.ry);
  // ніс-картоплина
  penStroke(g, [[cx - rx * 0.22, cy + ry * 0.0], [cx - rx * 0.36, cy + ry * 0.2], [cx - rx * 0.12, cy + ry * 0.24]], ink({ width: lw * 0.85 }));
  // нижня щелепа вперед і два ікла вгору
  penStroke(g, [[cx - rx * 0.62, cy + ry * 0.38], [cx - rx * 0.15, cy + ry * 0.48], [cx + rx * 0.3, cy + ry * 0.4]], ink({ width: lw * 0.95 }));
  for (const x of [-0.5, 0.15]) {
    penPath(g, [[cx + rx * x - rx * 0.07, cy + ry * 0.44], [cx + rx * x, cy + ry * 0.2], [cx + rx * x + rx * 0.07, cy + ry * 0.44]], ink({ width: lw * 0.7, overshoot: 0 }));
  }
}

function ogrePupils(g: Graphics, w: number, h: number) {
  dot(g, w * 0.16, h * 0.55, Math.min(w, h) * 0.3);
  dot(g, w * 0.754, h * 0.55, Math.min(w, h) * 0.28);
}

/**
 * Шолом олівцем — саме він каже «броньований»: залізна каска з гребенем і
 * заклепками. Один предмет замість нагрудника, наплічника й шипів.
 */
function ogreHelmet(g: Graphics, w: number, h: number, lw: number) {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (Math.PI * i) / 16;
    pts.push([w * 0.5 + Math.cos(a) * w * 0.46, h * 0.85 + Math.sin(a) * h * 0.75]);
  }
  pts.push([w * 0.96, h * 0.97], [w * 0.04, h * 0.97]);
  shape(g, pts, lw, { fill: 0.22 });
  penStroke(g, [[w * 0.5, h * 0.1], [w * 0.5, h * 0.95]], ink({ width: lw * 0.8 }));
  for (const x of [0.2, 0.38, 0.62, 0.8]) dot(g, w * x, h * 0.86, lw * 0.6);
}

/** Ріжки над шоломом. */
function ogreHorns(g: Graphics, w: number, h: number, lw: number) {
  for (const s of [-1, 1]) {
    shape(g, hornShape([w * 0.5 + s * w * 0.28, h * 0.98], [w * 0.5 + s * w * 0.5, h * 0.6], [w * 0.5 + s * w * 0.42, h * 0.05], w * 0.16), lw * 0.9, { fill: 0.3 });
  }
}

/** Палиця: суковата дубина, без шипів — і так зрозуміло, що боляче. */
function ogreClub(g: Graphics, w: number, h: number, lw: number) {
  const pts: Vec2[] = [[w * 0.98, h * 0.48], [w * 0.55, h * 0.4], [w * 0.2, h * 0.12], [w * 0.05, h * 0.3], [w * 0.04, h * 0.72], [w * 0.22, h * 0.88], [w * 0.55, h * 0.62], [w * 0.98, h * 0.62]];
  shape(g, pts, lw, { fill: 0.24 });
  penStroke(g, [[w * 0.18, h * 0.4], [w * 0.24, h * 0.5]], ink({ width: lw * 0.6, overshoot: 0 }));
}

const ogreFoot = hornFoot;

// =============================================================================
// Корона боса: маркером — суцільна, як і належить коштовності в зошиті.
// =============================================================================

const crownPts = (w: number, h: number): Vec2[] => [
  [w * 0.04, h * 0.95], [w * 0.04, h * 0.35], [w * 0.25, h * 0.6], [w * 0.5, h * 0.05],
  [w * 0.75, h * 0.6], [w * 0.96, h * 0.35], [w * 0.96, h * 0.95],
];
function crownFill(g: Graphics, w: number, h: number) {
  g.poly(flat(crownPts(w, h))).fill({ color: W, alpha: 1 });
}
function crownLine(g: Graphics, w: number, h: number, lw: number) {
  penPath(g, crownPts(w, h), ink({ width: lw * 1.0, closed: true, overshoot: lw * 0.3 }));
}

export const MONSTERS: Record<string, Doodle> = {
  snow_body: snowBody,
  snow_foot: snowFoot,
  snow_arm: snowArm,
  snow_head: snowHead,
  snow_eyes: snowEyes,
  snow_mouth: snowMouth,
  snow_nose: snowNose,
  crawl_legs_a: crawlLegsA,
  crawl_legs_b: crawlLegsB,
  crawl_body: crawlBody,
  crawl_head: crawlHead,
  crawl_eyes: crawlEyes,
  crawl_pupils: crawlPupils,
  horn_wing: hornWing,
  horn_body: hornBody,
  horn_armor: hornArmor,
  horn_head: hornHead,
  horn_eyes: hornEyes,
  horn_pupils: hornPupils,
  horn_club: hornClub,
  horn_foot: hornFoot,
  imp_body: impBody,
  imp_pupils: impPupils,
  imp_foot: impFoot,
  imp_arm: impArm,
  ogre_body: ogreBody,
  ogre_pupils: ogrePupils,
  ogre_helmet: ogreHelmet,
  ogre_horns: ogreHorns,
  ogre_club: ogreClub,
  ogre_foot: ogreFoot,
  crown_fill: crownFill,
  crown_line: crownLine,
};
