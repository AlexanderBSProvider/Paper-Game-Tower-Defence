// Вороги режиму lane: сніговик-вухань, павучок-бігун, рогатий здоровань і бос.
//
// Силуети — зі скетчу власника; тут — виконання. Попередні дудли були порожнім
// контуром з ідеальних кіл: крізь тіло просвічувала клітинка, і вороги
// читались як каркас. Тепер у кожного:
//   - нерівна куля замість циркульного кола (рука не малює ідеально);
//   - тіло «залите» штриховкою пером, тінь справа знизу — перехресною
//     (стиль зошита: суцільних заливок немає, лише штрих і маркер);
//   - контур товстіший за деталі, деталі — тонші;
//   - очі з зіницями окремою частиною (олівцем), щоб кліпати й дивитись уліво,
//     туди, куди ворог іде; акценти — помаранчевим і маркером;
//   - ноги, лапи, крила, палиця — окремі частини, щоб рухатись (rigs.json).
//
// Усе — МАСКИ (біле на прозорому), колір дає перо частини в rigs.json.
// Кожна функція малює в коробку w × h пікселів; розмір у клітинках — parts.json.

import type { Graphics } from '../../lib/pixi.min.mjs';
import { penStroke, penPath, penCircle } from './ink.js';
import type { PenOpts } from './ink.js';
import type { Vec2 } from '../types.js';

type Doodle = (g: Graphics, w: number, h: number, lw: number) => void;

const W = '#ffffff';
const ink = (o: PenOpts = {}): PenOpts => ({ color: W, ...o });

/** Детермінований шум: однакові вороги щоразу, а не нова пляма на кожен запуск. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Нерівна куля: радіус гуляє на кілька відсотків, як у живого кола. */
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, wob = 0.06, n = 28): Vec2[] {
  const r = seeded(seed);
  const ph = r() * 6.28, ph2 = r() * 6.28;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * (Math.sin(a * 3 + ph) * 0.6 + Math.sin(a * 5 + ph2) * 0.4);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/** Півмісяць тіні: зовнішня дуга кулі від a0 до a1 і внутрішня назад. */
function crescent(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, inner = 0.62, shift = 0.12): Vec2[] {
  const out: Vec2[] = [], back: Vec2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx * 0.97, cy + Math.sin(a) * ry * 0.97]);
    // Внутрішня дуга зсунута до світла: тінь товща посередині, тоншає на кінцях.
    back.push([cx - rx * shift + Math.cos(a) * rx * inner, cy - ry * shift + Math.sin(a) * ry * inner]);
  }
  return [...out, ...back.reverse()];
}

/** Перетин горизонталі-штриха з багатокутником: штриховка, обрізана контуром. */
function hatchIn(g: Graphics, poly: Vec2[], o: { gap: number; angle: number; width: number; alpha: number }) {
  const dx = Math.cos(o.angle), dy = Math.sin(o.angle);
  const nx = -dy, ny = dx;
  const proj = poly.map(([x, y]) => x * nx + y * ny);
  const lo = Math.min(...proj), hi = Math.max(...proj);
  const r = seeded(Math.round(lo * 7 + hi));
  for (let d = lo + o.gap * 0.5; d < hi; d += o.gap * (0.8 + r() * 0.4)) {
    // Лінія: p = n*d + t*dir. Шукаємо t перетинів з ребрами.
    const ts: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const pa = ax * nx + ay * ny - d, pb = bx * nx + by * ny - d;
      if ((pa > 0) === (pb > 0)) continue;
      const k = pa / (pa - pb);
      const x = ax + (bx - ax) * k, y = ay + (by - ay) * k;
      ts.push(x * dx + y * dy);
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const inset = o.width * 0.8; // штрих не вилазить на контур
      if (ts[i + 1] - ts[i] < inset * 3) continue;
      const p0: Vec2 = [nx * d + dx * (ts[i] + inset), ny * d + dy * (ts[i] + inset)];
      const p1: Vec2 = [nx * d + dx * (ts[i + 1] - inset), ny * d + dy * (ts[i + 1] - inset)];
      penStroke(g, [p0, p1], ink({ width: o.width, alpha: o.alpha, jitter: o.width * 0.3, step: o.gap * 2, overshoot: 0, halo: 0, pressure: 0.3 }));
    }
  }
}

/**
 * Тіло: світла штриховка всередині, перехресна тінь справа знизу (світло — зліва
 * згори, як в усьому зошиті), товстий контур поверх.
 */
function body(g: Graphics, cx: number, cy: number, rx: number, ry: number, lw: number, seed: number, wob = 0.06) {
  const pts = blob(cx, cy, rx, ry, seed, wob);
  hatchIn(g, pts, { gap: lw * 2.6, angle: 0.95, width: lw * 0.42, alpha: 0.5 });
  const sh = crescent(cx, cy, rx, ry, -0.35, 2.3);
  hatchIn(g, sh, { gap: lw * 1.5, angle: -0.6, width: lw * 0.42, alpha: 0.75 });
  penPath(g, pts, ink({ width: lw * 1.15, closed: true, jitter: lw * 0.15, overshoot: lw * 0.6, step: lw * 3 }));
  return pts;
}

/** Суцільна крапка: зіниця, заклепка. Не заливка — просто жирна точка пера. */
function dot(g: Graphics, x: number, y: number, r: number) {
  g.circle(x, y, r).fill({ color: W, alpha: 1 });
}

// --- 1. сніговик-вухань (standard) ----------------------------------------------

function snowBody(g: Graphics, w: number, h: number, lw: number) {
  body(g, w * 0.5, h * 0.53, w * 0.44, h * 0.43, lw, 11);
  // ґудзики-вуглинки: три кружки з крапкою
  for (const [y, s] of [[0.36, 1], [0.53, 0.9], [0.7, 0.8]] as Vec2[]) {
    penCircle(g, w * 0.44, h * y, w * 0.045 * s, ink({ width: lw * 0.7 }));
  }
}

function snowFoot(g: Graphics, w: number, h: number, lw: number) {
  body(g, w * 0.5, h * 0.52, w * 0.42, h * 0.38, lw * 0.8, 23, 0.04);
}

/** Рука-гілка: від плеча (праворуч) до кисті (ліворуч), три пальці-гілочки й сучок. */
function snowArm(g: Graphics, w: number, h: number, lw: number) {
  const sh: Vec2 = [w * 0.95, h * 0.5], hand: Vec2 = [w * 0.16, h * 0.5];
  penStroke(g, [sh, [w * 0.6, h * 0.42], [w * 0.35, h * 0.55], hand], ink({ width: lw * 1.05, pressure: 0.4 }));
  penStroke(g, [[w * 0.55, h * 0.45], [w * 0.5, h * 0.15]], ink({ width: lw * 0.6 }));
  for (const [ex, ey] of [[0.02, 0.22], [0.0, 0.52], [0.06, 0.82]] as Vec2[]) {
    penStroke(g, [hand, [w * ex, h * ey]], ink({ width: lw * 0.7 }));
  }
}

function snowHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.6, rx = w * 0.36, ry = h * 0.34;
  // Вуха — те, за що його звуть вуханем: гострі, з ямкою всередині.
  for (const s of [-1, 1]) {
    const base0: Vec2 = [cx + s * rx * 0.45, cy - ry * 0.78];
    const tip: Vec2 = [cx + s * rx * 1.18, h * 0.04];
    const base1: Vec2 = [cx + s * rx * 0.92, cy - ry * 0.25];
    const ear = [base0, tip, base1];
    hatchIn(g, [base0, tip, base1, [cx + s * rx * 0.6, cy - ry * 0.5]], { gap: lw * 1.4, angle: 0.4 * s, width: lw * 0.4, alpha: 0.7 });
    penPath(g, ear, ink({ width: lw * 1.05, overshoot: lw * 0.4 }));
  }
  body(g, cx, cy, rx, ry, lw, 37);
  // Брови: насуплені, внутрішні кінці вниз — уся лють у них.
  for (const s of [-1, 1]) {
    penStroke(g, [[cx + s * rx * 0.62 - rx * 0.12, cy - ry * 0.42], [cx + s * rx * 0.12 - rx * 0.12, cy - ry * 0.18]], ink({ width: lw * 1.1, pressure: 0.5 }));
  }
}

/** Очі: обідок і зіниця, що дивиться вліво — туди, куди він іде. */
function snowEyes(g: Graphics, w: number, h: number, lw: number) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.25, cy = h * 0.5, r = Math.min(w * 0.2, h * 0.44);
    penCircle(g, cx, cy, r, ink({ width: lw * 0.8 }));
    dot(g, cx - r * 0.35, cy + r * 0.1, r * 0.55);
  }
}

/** Рот: зубаста усмішка, всередині темно. */
function snowMouth(g: Graphics, w: number, h: number, lw: number) {
  const top: Vec2[] = [[w * 0.06, h * 0.25], [w * 0.5, h * 0.4], [w * 0.94, h * 0.18]];
  const bot: Vec2[] = [[w * 0.94, h * 0.18], [w * 0.62, h * 0.9], [w * 0.3, h * 0.88], [w * 0.06, h * 0.25]];
  hatchIn(g, [...top, ...bot.slice(1, -1)], { gap: lw * 0.9, angle: 0.3, width: lw * 0.45, alpha: 0.9 });
  penPath(g, [...top, ...bot.slice(1)], ink({ width: lw * 0.9 }));
  // зуби: трикутнички згори
  for (let i = 0; i < 4; i++) {
    const x0 = w * (0.16 + i * 0.19), y0 = h * (0.29 + (i < 2 ? i * 0.05 : (3 - i) * 0.05));
    penPath(g, [[x0, y0], [x0 + w * 0.06, y0 + h * 0.3], [x0 + w * 0.12, y0 - h * 0.02]], ink({ width: lw * 0.6, overshoot: 0 }));
  }
}

/** Ніс-морквина вістрям уліво: єдина помаранчева пляма й заразом «куди він іде». */
function snowNose(g: Graphics, w: number, h: number, lw: number) {
  const tri: Vec2[] = [[w * 0.98, h * 0.12], [w * 0.02, h * 0.55], [w * 0.98, h * 0.9]];
  hatchIn(g, tri, { gap: lw * 1.2, angle: 1.3, width: lw * 0.45, alpha: 0.8 });
  penPath(g, tri, ink({ width: lw * 0.9, closed: true, overshoot: lw * 0.3 }));
}

// --- 2. павучок-бігун (swift) -----------------------------------------------------

/** Пара лап на один такт ходи: передня ліва й задня права (або навпаки, дзеркально). */
function crawlLegs(g: Graphics, w: number, h: number, lw: number, swap: boolean) {
  const cx = w * 0.5, cy = h * 0.42;
  // Тринога, як у комах: передня й задня з одного боку, середня — з іншого.
  // Друга частина — дзеркальна трійка; разом вони перебирають у протифазі.
  const k = swap ? -1 : 1;
  const legs: [number, number][] = [[-k, 1], [k, 0.55], [-k, 0.1]];
  for (const [s, reach] of legs) {
    // Коліно високо й назовні, ступня ще далі: лапа — це «Λ», а не паличка.
    const hip: Vec2 = [cx + s * w * 0.05 - w * 0.06 * (reach - 0.5), cy];
    const knee: Vec2 = [cx + s * w * (0.2 + reach * 0.1), h * 0.06];
    const foot: Vec2 = [cx + s * w * (0.4 + reach * 0.08), h * 0.95];
    penStroke(g, [hip, knee], ink({ width: lw * 1.05, pressure: 0.3, halo: 0.05 }));
    penStroke(g, [knee, foot], ink({ width: lw * 0.85, pressure: 0.3, halo: 0.05 }));
    penStroke(g, [foot, [foot[0] + s * w * 0.05, foot[1] - h * 0.06]], ink({ width: lw * 0.55, halo: 0 }));
  }
}
const crawlLegsA: Doodle = (g, w, h, lw) => crawlLegs(g, w, h, lw, false);
const crawlLegsB: Doodle = (g, w, h, lw) => crawlLegs(g, w, h, lw, true);

/** Черевце: смугасте, з шипиками вздовж спини. */
function crawlBody(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.55, cy = h * 0.55, rx = w * 0.42, ry = h * 0.38;
  body(g, cx, cy, rx, ry, lw, 51, 0.05);
  for (const k of [-0.25, 0.15]) {
    penStroke(g, [[cx + rx * k - rx * 0.1, cy - ry * 0.92], [cx + rx * k + rx * 0.12, cy], [cx + rx * k - rx * 0.05, cy + ry * 0.93]], ink({ width: lw * 1.1, pressure: 0.4 }));
  }
  for (let i = 0; i < 4; i++) {
    const a = -2.5 + i * 0.4;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    penStroke(g, [[x, y], [x + Math.cos(a) * w * 0.07, y + Math.sin(a) * h * 0.12]], ink({ width: lw * 0.7, overshoot: 0 }));
  }
}

/** Голова з іклами-серпами. */
function crawlHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.55, cy = h * 0.45;
  body(g, cx, cy, w * 0.36, h * 0.34, lw, 63);
  for (const s of [-1, 1]) {
    const x0 = cx - w * 0.12 + s * w * 0.12;
    penStroke(g, [[x0, cy + h * 0.25], [x0 - w * 0.12, h * 0.9], [x0 - w * 0.02 + s * w * 0.05, h * 0.98]], ink({ width: lw * 0.95, pressure: 0.5 }));
  }
}

/** Чотири ока маркером: два великі, два малі. */
function crawlEyes(g: Graphics, w: number, h: number) {
  for (const [x, y, r] of [[0.3, 0.55, 0.26], [0.66, 0.5, 0.24], [0.12, 0.2, 0.13], [0.86, 0.18, 0.12]]) {
    g.circle(w * x, h * y, Math.min(w, h) * r * 1.6).fill({ color: W, alpha: 1 });
  }
}
function crawlPupils(g: Graphics, w: number, h: number) {
  for (const [x, y, r] of [[0.26, 0.6, 0.17], [0.62, 0.55, 0.15], [0.1, 0.23, 0.08], [0.84, 0.21, 0.07]]) {
    g.circle(w * x, h * y, Math.min(w, h) * r * 1.6).fill({ color: W, alpha: 1 });
  }
}

// --- 3. рогатий здоровань (armored) -----------------------------------------------

/** Крило кажана: три кістки віялом від плеча й перетинка фестонами. Плече праворуч. */
function hornWing(g: Graphics, w: number, h: number, lw: number) {
  const sh: Vec2 = [w * 0.92, h * 0.78];
  const tips: Vec2[] = [[w * 0.55, h * 0.04], [w * 0.15, h * 0.12], [w * 0.03, h * 0.5]];
  const elbow: Vec2 = [w * 0.62, h * 0.3];
  // перетинка: фестони між кінчиками й плечем
  const edge: Vec2[] = [tips[0], [w * 0.38, h * 0.32], tips[1], [w * 0.2, h * 0.42], tips[2], [w * 0.42, h * 0.62], [w * 0.62, h * 0.66], sh];
  hatchIn(g, [elbow, ...edge], { gap: lw * 1.7, angle: 1.1, width: lw * 0.42, alpha: 0.6 });
  penStroke(g, edge, ink({ width: lw * 0.8 }));
  penStroke(g, [sh, elbow], ink({ width: lw * 1.2, pressure: 0.4 }));
  for (const t of tips) penStroke(g, [elbow, t], ink({ width: lw * 0.85 }));
  // кіготь на згині
  penStroke(g, [elbow, [elbow[0] + w * 0.04, elbow[1] - h * 0.16]], ink({ width: lw * 0.8, overshoot: 0 }));
}

function hornBody(g: Graphics, w: number, h: number, lw: number) {
  body(g, w * 0.5, h * 0.55, w * 0.44, h * 0.42, lw, 77, 0.05);
}

/**
 * Броня олівцем — та, через яку його не бере меч: нагрудник із заклепками й
 * наплічник із шипами. Клас «броньований» видно раніше, ніж цифри шкоди.
 */
function hornArmor(g: Graphics, w: number, h: number, lw: number) {
  const plate: Vec2[] = [[w * 0.2, h * 0.3], [w * 0.75, h * 0.24], [w * 0.8, h * 0.62], [w * 0.5, h * 0.95], [w * 0.22, h * 0.66]];
  hatchIn(g, plate, { gap: lw * 1.3, angle: 0.8, width: lw * 0.42, alpha: 0.55 });
  penPath(g, plate, ink({ width: lw * 1.1, closed: true, overshoot: lw * 0.5 }));
  penStroke(g, [[w * 0.48, h * 0.27], [w * 0.5, h * 0.9]], ink({ width: lw * 0.7 }));
  for (const [x, y] of [[0.3, 0.38], [0.66, 0.34], [0.32, 0.6], [0.68, 0.58]]) dot(g, w * x, h * y, lw * 0.7);
  // наплічник ліворуч (до бійців) з трьома шипами
  const pad: Vec2[] = [[w * 0.02, h * 0.3], [w * 0.12, h * 0.06], [w * 0.36, h * 0.04], [w * 0.4, h * 0.3]];
  hatchIn(g, pad, { gap: lw * 1.1, angle: -0.7, width: lw * 0.42, alpha: 0.7 });
  penPath(g, pad, ink({ width: lw * 1.0, closed: true }));
  for (let i = 0; i < 3; i++) {
    const x = w * (0.1 + i * 0.1), y = h * (0.07 - i * 0.005);
    penPath(g, [[x - w * 0.03, y + h * 0.02], [x, y - h * 0.08], [x + w * 0.03, y + h * 0.02]], ink({ width: lw * 0.7, overshoot: 0 }));
  }
}

function hornHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.6, rx = w * 0.34, ry = h * 0.3;
  // Роги: товсті біля голови, гострі на кінці, вигнуті назовні й угору, з
  // кільцями — перше, що видно над головою. Не трикутники: трикутник читався
  // як котяче вухо.
  for (const s of [-1, 1]) {
    const horn = hornShape([cx + s * rx * 0.55, cy - ry * 0.7], [cx + s * rx * 1.55, cy - ry * 1.05], [cx + s * rx * 1.05, h * 0.03], rx * 0.42);
    hatchIn(g, horn.poly, { gap: lw * 1.0, angle: 1.0 * s, width: lw * 0.42, alpha: 0.85 });
    penPath(g, horn.poly, ink({ width: lw * 1.0, closed: true, overshoot: lw * 0.2 }));
    for (const t of [0.3, 0.5, 0.68]) {
      const [a, b] = horn.across(t);
      penStroke(g, [a, b], ink({ width: lw * 0.6, overshoot: 0 }));
    }
  }
  body(g, cx, cy, rx, ry, lw, 91, 0.05);
  // надбрівна дуга й паща з іклами
  penStroke(g, [[cx - rx * 0.85, cy - ry * 0.45], [cx - rx * 0.2, cy - ry * 0.1], [cx + rx * 0.2, cy - ry * 0.1], [cx + rx * 0.85, cy - ry * 0.45]], ink({ width: lw * 1.2, pressure: 0.5 }));
  const jaw: Vec2[] = [[cx - rx * 0.75, cy + ry * 0.35], [cx + rx * 0.6, cy + ry * 0.38]];
  penStroke(g, jaw, ink({ width: lw * 0.95 }));
  for (const [x, up] of [[-0.55, 1], [-0.15, 0], [0.3, 1]] as Vec2[]) {
    const x0 = cx + rx * x, y0 = cy + ry * 0.36;
    penPath(g, up
      ? [[x0 - rx * 0.1, y0], [x0, y0 + ry * 0.5], [x0 + rx * 0.1, y0]]
      : [[x0 - rx * 0.08, y0], [x0, y0 - ry * 0.35], [x0 + rx * 0.08, y0]], ink({ width: lw * 0.7, overshoot: 0 }));
  }
}

/**
 * Ріг: квадратична крива від основи через згин до вістря, товщина спадає до
 * нуля. Повертає контур і «поперечку» в точці t — для кілець на розі.
 */
function hornShape(base: Vec2, bend: Vec2, tip: Vec2, width: number) {
  const at = (t: number): Vec2 => {
    const u = 1 - t;
    return [u * u * base[0] + 2 * u * t * bend[0] + t * t * tip[0], u * u * base[1] + 2 * u * t * bend[1] + t * t * tip[1]];
  };
  const normal = (t: number): Vec2 => {
    const a = at(Math.max(0, t - 0.01)), b = at(Math.min(1, t + 0.01));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  };
  const half = (t: number) => (width / 2) * (1 - t) ** 0.8;
  const side = (t: number, k: number): Vec2 => {
    const p = at(t), n = normal(t);
    return [p[0] + n[0] * half(t) * k, p[1] + n[1] * half(t) * k];
  };
  const n = 14;
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i <= n; i++) { left.push(side(i / n, 1)); right.push(side(i / n, -1)); }
  return { poly: [...left, ...right.reverse()], across: (t: number): [Vec2, Vec2] => [side(t, 1), side(t, -1)] };
}

/** Очі-щілини маркером: світяться з-під брів. */
function hornEyes(g: Graphics, w: number, h: number) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.25;
    g.poly([cx - w * 0.18, h * 0.3, cx + w * 0.16, h * (s < 0 ? 0.5 : 0.2), cx + w * 0.12, h * 0.85, cx - w * 0.16, h * 0.85])
      .fill({ color: W, alpha: 1 });
  }
}
function hornPupils(g: Graphics, w: number, h: number) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.25 - w * 0.06;
    g.rect(cx - w * 0.035, h * 0.38, w * 0.07, h * 0.45).fill({ color: W, alpha: 1 });
  }
}

/** Шипаста палиця: руків'я праворуч (у руці), ґуля з шипами ліворуч. */
function hornClub(g: Graphics, w: number, h: number, lw: number) {
  // Руків'я з обмоткою, далі важка ґуля з шипами-трикутниками.
  penStroke(g, [[w * 0.98, h * 0.58], [w * 0.42, h * 0.5]], ink({ width: lw * 1.4, pressure: 0.3 }));
  for (const x of [0.78, 0.86, 0.94]) penStroke(g, [[w * x, h * 0.45], [w * (x - 0.03), h * 0.66]], ink({ width: lw * 0.6, overshoot: 0 }));
  // Ґуля менша за коробку з запасом на шипи: усе, що вилізе за коробку, обріже кадр текстури.
  const cx = w * 0.25, cy = h * 0.5, rx = w * 0.15, ry = h * 0.28;
  for (let i = 0; i < 8; i++) {
    const a = 1.7 + (i / 7) * 2.9;
    const ox = Math.cos(a), oy = Math.sin(a);
    const b0: Vec2 = [cx + Math.cos(a - 0.22) * rx * 0.95, cy + Math.sin(a - 0.22) * ry * 0.95];
    const b1: Vec2 = [cx + Math.cos(a + 0.22) * rx * 0.95, cy + Math.sin(a + 0.22) * ry * 0.95];
    const tip: Vec2 = [cx + ox * rx * 1.45, cy + oy * ry * 1.45];
    hatchIn(g, [b0, tip, b1], { gap: lw * 0.8, angle: a, width: lw * 0.4, alpha: 0.8 });
    penPath(g, [b0, tip, b1], ink({ width: lw * 0.8, overshoot: 0 }));
  }
  body(g, cx, cy, rx, ry, lw, 103, 0.08);
}

function hornFoot(g: Graphics, w: number, h: number, lw: number) {
  body(g, w * 0.5, h * 0.55, w * 0.44, h * 0.38, lw * 0.85, 117, 0.04);
  for (const x of [0.12, 0.3, 0.48]) {
    penStroke(g, [[w * x, h * 0.8], [w * (x - 0.08), h * 0.98]], ink({ width: lw * 0.7, overshoot: 0 }));
  }
}

// --- бос: корона ------------------------------------------------------------------

/** Корона: маркером — суцільна, як і належить коштовності в зошиті. */
function crownFill(g: Graphics, w: number, h: number) {
  g.poly(crownPts(w, h).flat()).fill({ color: W, alpha: 1 });
}
function crownLine(g: Graphics, w: number, h: number, lw: number) {
  penPath(g, crownPts(w, h), ink({ width: lw * 1.0, closed: true, overshoot: lw * 0.3 }));
  for (const x of [0.25, 0.5, 0.75]) penCircle(g, w * x, h * 0.72, Math.min(w, h) * 0.07, ink({ width: lw * 0.6 }));
}
const crownPts = (w: number, h: number): Vec2[] => [
  [w * 0.04, h * 0.95], [w * 0.04, h * 0.35], [w * 0.25, h * 0.6], [w * 0.5, h * 0.05],
  [w * 0.75, h * 0.6], [w * 0.96, h * 0.35], [w * 0.96, h * 0.95],
];

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
  crown_fill: crownFill,
  crown_line: crownLine,
};
