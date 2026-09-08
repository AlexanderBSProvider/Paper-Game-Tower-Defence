// Дудл-плейсхолдери: те саме, що потім намалює рука, але поки малює код.
//
// Кожна частина — МАСКА: біле чорнило на прозорому. Колір дає перо в rigs.json
// через tint, тому один малюнок годиться будь-якій ручці, і твій майбутній арт
// стане на те саме місце без правок логіки.
//
// Малюємо в пікселях (refCell пікселів на клітинку × supersample), а спрайт
// потім живе в клітинках — тому лінія не роздувається разом зі світом.

import { Graphics, Rectangle, Renderer, Texture } from '../../lib/pixi.min.mjs';
import { penStroke, penPath, penCircle, penRect, hatch } from './ink.js';
import type { PenOpts } from './ink.js';
import type { Look, Parts, TowerPart, Vec2 } from '../types.js';

/** Генератор однієї маски: малює в пікселях у коробку w × h. */
type Doodle = (g: Graphics, w: number, h: number, lw: number) => void;

const W = '#ffffff';
const ink = (o: PenOpts = {}): PenOpts => ({ color: W, ...o });

/** Детермінований генератор — щоб декор не стрибав при кожному запуску. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- вухань --------------------------------------------------------------
function earlingBody(g: Graphics, w: number, h: number, lw: number) {
  penCircle(g, w * 0.5, h * 0.52, Math.min(w, h) * 0.42, ink({ width: lw }));
  // лапки
  penStroke(g, [[w * 0.34, h * 0.86], [w * 0.29, h * 0.98]], ink({ width: lw }));
  penStroke(g, [[w * 0.66, h * 0.86], [w * 0.71, h * 0.98]], ink({ width: lw }));
  // тінь під животом
  hatch(g, w * 0.26, h * 0.62, w * 0.42, h * 0.24, ink({ gap: w * 0.1, width: lw * 0.55, alpha: 0.5 }));
}

function earlingHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.62, r = Math.min(w, h) * 0.33;
  // вуха — те, за що його й звати
  penPath(g, [[cx - r * 0.85, cy - r * 0.55], [cx - r * 1.15, h * 0.06], [cx - r * 0.2, cy - r * 0.9]], ink({ width: lw }));
  penPath(g, [[cx + r * 0.85, cy - r * 0.55], [cx + r * 1.15, h * 0.06], [cx + r * 0.2, cy - r * 0.9]], ink({ width: lw }));
  penCircle(g, cx, cy, r, ink({ width: lw }));
  // зла паща
  penStroke(g, [[cx - r * 0.45, cy + r * 0.5], [cx - r * 0.15, cy + r * 0.3], [cx + r * 0.15, cy + r * 0.5], [cx + r * 0.45, cy + r * 0.3]], ink({ width: lw * 0.8, overshoot: 1 }));
}

function earlingEyes(g: Graphics, w: number, h: number, lw: number) {
  for (const s of [-1, 1]) {
    const cx = w * 0.5 + s * w * 0.22;
    // брова під кутом — уся лють у ній
    penStroke(g, [[cx - w * 0.1, h * 0.18 + (s < 0 ? 0 : h * 0.22)], [cx + w * 0.1, h * 0.18 + (s < 0 ? h * 0.22 : 0)]], ink({ width: lw * 0.9 }));
    penCircle(g, cx, h * 0.66, h * 0.16, ink({ width: lw * 0.8 }));
  }
}

// --- магічна башта --------------------------------------------------------
function magicBase(g: Graphics, w: number, h: number, lw: number) {
  const t = w * 0.16; // звуження догори
  penPath(g, [[w * 0.1 + t, h * 0.08], [w * 0.9 - t, h * 0.08], [w * 0.94, h * 0.95], [w * 0.06, h * 0.95]], ink({ width: lw, closed: true }));
  penCircle(g, w * 0.5, h * 0.36, w * 0.12, ink({ width: lw * 0.8 })); // вікно
  hatch(g, w * 0.62, h * 0.45, w * 0.28, h * 0.45, ink({ gap: w * 0.1, width: lw * 0.55, alpha: 0.55 }));
  penStroke(g, [[w * 0.06, h * 0.95], [w * 0.94, h * 0.95]], ink({ width: lw * 1.1 }));
}

function magicRoof(g: Graphics, w: number, h: number, lw: number) {
  penPath(g, [[w * 0.08, h * 0.92], [w * 0.5, h * 0.07], [w * 0.92, h * 0.92]], ink({ width: lw }));
  // хвилястий низ — стріха, а не трикутник
  penStroke(g, [[w * 0.06, h * 0.9], [w * 0.28, h * 0.97], [w * 0.5, h * 0.89], [w * 0.72, h * 0.97], [w * 0.94, h * 0.9]], ink({ width: lw * 0.9 }));
  hatch(g, w * 0.5, h * 0.35, w * 0.36, h * 0.5, ink({ gap: w * 0.09, width: lw * 0.5, alpha: 0.5, angle: -0.6 }));
}

function magicStaff(g: Graphics, w: number, h: number, lw: number) {
  penStroke(g, [[w * 0.5, h * 0.98], [w * 0.46, h * 0.3]], ink({ width: lw }));
  // зірка на вершині
  const cx = w * 0.46, cy = h * 0.2, r = Math.min(w, h) * 0.16;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    penStroke(g, [[cx - Math.cos(a) * r, cy - Math.sin(a) * r], [cx + Math.cos(a) * r, cy + Math.sin(a) * r]], ink({ width: lw * 0.75 }));
  }
  penCircle(g, cx, cy, r * 0.42, ink({ width: lw * 0.7 }));
}

// --- гармата --------------------------------------------------------------
function cannonBase(g: Graphics, w: number, h: number, lw: number) {
  penRect(g, w * 0.12, h * 0.3, w * 0.76, h * 0.42, ink({ width: lw }));
  hatch(g, w * 0.14, h * 0.32, w * 0.72, h * 0.38, ink({ gap: w * 0.1, width: lw * 0.5, alpha: 0.45 }));
  penCircle(g, w * 0.3, h * 0.76, h * 0.2, ink({ width: lw }));
  penCircle(g, w * 0.7, h * 0.76, h * 0.2, ink({ width: lw }));
  penStroke(g, [[w * 0.3, h * 0.76], [w * 0.7, h * 0.76]], ink({ width: lw * 0.6, alpha: 0.7 }));
}

function cannonBarrel(g: Graphics, w: number, h: number, lw: number) {
  penPath(g, [[w * 0.06, h * 0.28], [w * 0.86, h * 0.2], [w * 0.86, h * 0.8], [w * 0.06, h * 0.72]], ink({ width: lw, closed: true }));
  penCircle(g, w * 0.88, h * 0.5, h * 0.32, ink({ width: lw * 0.9 })); // дуло
  hatch(g, w * 0.1, h * 0.34, w * 0.7, h * 0.34, ink({ gap: w * 0.09, width: lw * 0.5, alpha: 0.45, angle: 0.12 }));
}

// --- база --------------------------------------------------------------
function keepWall(g: Graphics, w: number, h: number, lw: number) {
  penRect(g, w * 0.06, h * 0.32, w * 0.88, h * 0.62, ink({ width: lw }));
  // зубці
  const n = 5, bw = (w * 0.88) / (n * 2 - 1);
  for (let i = 0; i < n; i++) {
    const x = w * 0.06 + i * bw * 2;
    penPath(g, [[x, h * 0.32], [x, h * 0.12], [x + bw, h * 0.12], [x + bw, h * 0.32]], ink({ width: lw * 0.9 }));
  }
  // ворота
  const gx = w * 0.5, gw = w * 0.15;
  penCircle(g, gx, h * 0.62, gw, ink({ width: lw * 0.9 }));
  penStroke(g, [[gx - gw, h * 0.62], [gx - gw, h * 0.94]], ink({ width: lw * 0.9 }));
  penStroke(g, [[gx + gw, h * 0.62], [gx + gw, h * 0.94]], ink({ width: lw * 0.9 }));
  hatch(g, w * 0.08, h * 0.36, w * 0.3, h * 0.55, ink({ gap: w * 0.06, width: lw * 0.45, alpha: 0.4 }));
}

function keepFlag(g: Graphics, w: number, h: number, lw: number) {
  penStroke(g, [[w * 0.14, h * 0.98], [w * 0.14, h * 0.04]], ink({ width: lw }));
  penPath(g, [[w * 0.16, h * 0.08], [w * 0.92, h * 0.24], [w * 0.16, h * 0.44]], ink({ width: lw * 0.9 }));
  hatch(g, w * 0.2, h * 0.12, w * 0.5, h * 0.26, ink({ gap: w * 0.12, width: lw * 0.45, alpha: 0.5 }));
}

// --- декор --------------------------------------------------------------
function decorTree(g: Graphics, w: number, h: number, lw: number) {
  penStroke(g, [[w * 0.44, h * 0.99], [w * 0.47, h * 0.62]], ink({ width: lw }));
  penStroke(g, [[w * 0.58, h * 0.99], [w * 0.55, h * 0.62]], ink({ width: lw }));
  // крона трьома клубками, як у скетчі
  penCircle(g, w * 0.5, h * 0.42, w * 0.3, ink({ width: lw * 0.95 }));
  penCircle(g, w * 0.3, h * 0.5, w * 0.2, ink({ width: lw * 0.9 }));
  penCircle(g, w * 0.72, h * 0.52, w * 0.19, ink({ width: lw * 0.9 }));
  hatch(g, w * 0.34, h * 0.3, w * 0.34, h * 0.28, ink({ gap: w * 0.11, width: lw * 0.45, alpha: 0.4 }));
}

function decorBush(g: Graphics, w: number, h: number, lw: number) {
  penCircle(g, w * 0.34, h * 0.66, w * 0.22, ink({ width: lw * 0.9 }));
  penCircle(g, w * 0.64, h * 0.6, w * 0.26, ink({ width: lw * 0.9 }));
  penStroke(g, [[w * 0.08, h * 0.96], [w * 0.92, h * 0.94]], ink({ width: lw * 0.7, alpha: 0.6 }));
}

// --- союзники: тіла під намальовану зброю ---------------------------------
// Зброю малює гравець, тіло — код. Дві пози, бо рід читається з пози раніше,
// ніж око розбере зброю: мілі виставив щит уперед, ренж витягнув руку.
// Точка руки задана в weapons.json#bodies і мусить збігатися з тим, де тут
// закінчується рука — інакше зброя висітиме в повітрі.
function allyBodyMelee(g: Graphics, w: number, h: number, lw: number) {
  penCircle(g, w * 0.5, h * 0.13, h * 0.1, ink({ width: lw }));
  penStroke(g, [[w * 0.5, h * 0.24], [w * 0.5, h * 0.62]], ink({ width: lw }));
  penStroke(g, [[w * 0.5, h * 0.62], [w * 0.36, h * 0.98]], ink({ width: lw }));
  penStroke(g, [[w * 0.5, h * 0.62], [w * 0.64, h * 0.98]], ink({ width: lw }));
  // рука зі щитом — уперед, до ворога
  penStroke(g, [[w * 0.5, h * 0.34], [w * 0.24, h * 0.46]], ink({ width: lw * 0.9 }));
  penPath(g, [[w * 0.1, h * 0.36], [w * 0.32, h * 0.36], [w * 0.34, h * 0.56], [w * 0.21, h * 0.68], [w * 0.08, h * 0.56]], ink({ width: lw, closed: true }));
  hatch(g, w * 0.12, h * 0.4, w * 0.18, h * 0.22, ink({ gap: h * 0.05, width: lw * 0.45, alpha: 0.45 }));
  // рука зі зброєю: кінець — точка hand у weapons.json
  penStroke(g, [[w * 0.5, h * 0.34], [w * 0.8, h * 0.48]], ink({ width: lw * 0.9 }));
}

function allyBodyRanged(g: Graphics, w: number, h: number, lw: number) {
  penCircle(g, w * 0.42, h * 0.13, h * 0.1, ink({ width: lw }));
  penStroke(g, [[w * 0.42, h * 0.24], [w * 0.42, h * 0.62]], ink({ width: lw }));
  penStroke(g, [[w * 0.42, h * 0.62], [w * 0.28, h * 0.98]], ink({ width: lw }));
  penStroke(g, [[w * 0.42, h * 0.62], [w * 0.56, h * 0.98]], ink({ width: lw }));
  // сагайдак за спиною
  penPath(g, [[w * 0.2, h * 0.3], [w * 0.3, h * 0.26], [w * 0.36, h * 0.5], [w * 0.26, h * 0.54]], ink({ width: lw * 0.8, closed: true }));
  // задня рука тягне тятиву
  penStroke(g, [[w * 0.42, h * 0.36], [w * 0.62, h * 0.44], [w * 0.52, h * 0.5]], ink({ width: lw * 0.9 }));
  // передня рука витягнута: кінець — точка hand у weapons.json
  penStroke(g, [[w * 0.42, h * 0.36], [w * 0.86, h * 0.42]], ink({ width: lw * 0.9 }));
}

function allyBodySupport(g: Graphics, w: number, h: number, lw: number) {
  // каптур — гострий, як у ченця
  penPath(g, [[w * 0.36, h * 0.24], [w * 0.5, h * 0.03], [w * 0.64, h * 0.24]], ink({ width: lw }));
  penCircle(g, w * 0.5, h * 0.17, h * 0.085, ink({ width: lw * 0.9 }));
  // ряса трапецією до землі, без ніг
  penPath(g, [[w * 0.38, h * 0.26], [w * 0.62, h * 0.26], [w * 0.72, h * 0.97], [w * 0.28, h * 0.97]], ink({ width: lw, closed: true }));
  hatch(g, w * 0.3, h * 0.6, w * 0.4, h * 0.34, ink({ gap: h * 0.06, width: lw * 0.45, alpha: 0.4, angle: 1.2 }));
  // пояс
  penStroke(g, [[w * 0.36, h * 0.54], [w * 0.64, h * 0.54]], ink({ width: lw * 0.8, alpha: 0.8 }));
  // рука з посохом: кінець — точка hand у weapons.json
  penStroke(g, [[w * 0.56, h * 0.36], [w * 0.78, h * 0.5]], ink({ width: lw * 0.9 }));
}

// --- бігун --------------------------------------------------------------
// Дрібне тільце на довгих тонких ногах: швидкість читається з силуету.
function runnerBody(g: Graphics, w: number, h: number, lw: number) {
  penCircle(g, w * 0.5, h * 0.42, Math.min(w, h) * 0.3, ink({ width: lw }));
  penStroke(g, [[w * 0.4, h * 0.66], [w * 0.22, h * 0.98]], ink({ width: lw }));
  penStroke(g, [[w * 0.6, h * 0.66], [w * 0.8, h * 0.98]], ink({ width: lw }));
  hatch(g, w * 0.34, h * 0.42, w * 0.32, h * 0.2, ink({ gap: w * 0.12, width: lw * 0.5, alpha: 0.45 }));
}

function runnerHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.7, r = Math.min(w, h) * 0.26;
  // вуха довші за голову — притиснуті назад, як у бігу
  penPath(g, [[cx - r * 0.6, cy - r * 0.7], [cx - r * 1.6, h * 0.04], [cx - r * 0.1, cy - r * 0.95]], ink({ width: lw * 0.9 }));
  penPath(g, [[cx + r * 0.3, cy - r * 0.8], [cx - r * 0.5, h * 0.02], [cx + r * 0.7, cy - r * 0.6]], ink({ width: lw * 0.9 }));
  penCircle(g, cx, cy, r, ink({ width: lw }));
  for (const s of [-1, 1]) penCircle(g, cx + s * r * 0.4, cy - r * 0.1, r * 0.18, ink({ width: lw * 0.7 }));
  penStroke(g, [[cx - r * 0.4, cy + r * 0.5], [cx + r * 0.4, cy + r * 0.5]], ink({ width: lw * 0.8 }));
}

// --- здоровань ------------------------------------------------------------
// Купол панцира, заштрихований наскрізь: броня видна без слів.
function bruteBody(g: Graphics, w: number, h: number, lw: number) {
  penPath(g, [[w * 0.08, h * 0.8], [w * 0.06, h * 0.45], [w * 0.2, h * 0.14], [w * 0.5, h * 0.04], [w * 0.8, h * 0.14], [w * 0.94, h * 0.45], [w * 0.92, h * 0.8]], ink({ width: lw * 1.15, closed: true }));
  // пластини панцира
  penStroke(g, [[w * 0.12, h * 0.42], [w * 0.88, h * 0.42]], ink({ width: lw * 0.8, alpha: 0.8 }));
  penStroke(g, [[w * 0.16, h * 0.62], [w * 0.84, h * 0.62]], ink({ width: lw * 0.8, alpha: 0.8 }));
  hatch(g, w * 0.14, h * 0.16, w * 0.72, h * 0.62, ink({ gap: w * 0.07, width: lw * 0.5, alpha: 0.5, angle: -0.5 }));
  // короткі товсті ноги
  penPath(g, [[w * 0.22, h * 0.8], [w * 0.2, h * 0.98], [w * 0.4, h * 0.98], [w * 0.38, h * 0.8]], ink({ width: lw }));
  penPath(g, [[w * 0.62, h * 0.8], [w * 0.6, h * 0.98], [w * 0.8, h * 0.98], [w * 0.78, h * 0.8]], ink({ width: lw }));
}

function bruteHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.6, r = Math.min(w, h) * 0.34;
  penCircle(g, cx, cy, r, ink({ width: lw }));
  // насуплена брова однією лінією
  penStroke(g, [[cx - r * 0.8, cy - r * 0.35], [cx, cy - r * 0.1], [cx + r * 0.8, cy - r * 0.35]], ink({ width: lw * 1.1 }));
  for (const s of [-1, 1]) penCircle(g, cx + s * r * 0.4, cy + r * 0.1, r * 0.14, ink({ width: lw * 0.7 }));
  // ікла з-під нижньої губи
  penStroke(g, [[cx - r * 0.45, cy + r * 0.55], [cx - r * 0.55, cy + r * 1.05], [cx - r * 0.3, cy + r * 0.6]], ink({ width: lw * 0.8 }));
  penStroke(g, [[cx + r * 0.45, cy + r * 0.55], [cx + r * 0.55, cy + r * 1.05], [cx + r * 0.3, cy + r * 0.6]], ink({ width: lw * 0.8 }));
}

// --- тестові вигляди зі скетчу власника -----------------------------------
// Три силуети на один погляд: сніговик стоїть, павучок висить на лапах,
// рогатий розкрив крила. Форму видно ще до того, як око знайде цифри.

// 1 — звичайний: дві кулі й гілка замість руки.
function snowlingBody(g: Graphics, w: number, h: number, lw: number) {
  penCircle(g, w * 0.5, h * 0.55, Math.min(w, h) * 0.44, ink({ width: lw }));
  // гілка-рука вбік, з трьома пальцями на кінці
  const ax = w * 0.86, ay = h * 0.52;
  penStroke(g, [[w * 0.52, h * 0.38], [ax, ay]], ink({ width: lw * 0.9 }));
  for (const d of [-0.22, 0, 0.22]) {
    penStroke(g, [[ax, ay], [ax + w * 0.13, ay + h * (0.06 + d * 0.6)]], ink({ width: lw * 0.7 }));
  }
  hatch(g, w * 0.24, h * 0.62, w * 0.4, h * 0.26, ink({ gap: w * 0.11, width: lw * 0.5, alpha: 0.45 }));
}

function snowlingHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.52, r = Math.min(w, h) * 0.42;
  penCircle(g, cx, cy, r, ink({ width: lw }));
  // очі заплющені: дві похилі рисочки
  for (const s of [-1, 1]) {
    penStroke(g, [[cx + s * r * 0.55, cy - r * 0.22], [cx + s * r * 0.18, cy - r * 0.05]], ink({ width: lw * 0.85 }));
  }
  penStroke(g, [[cx - r * 0.22, cy + r * 0.42], [cx + r * 0.22, cy + r * 0.42]], ink({ width: lw * 0.9 }));
}

// 2 — швидкий: чотири тонкі лапи, і сам він менший за них.
function crawlerLimbs(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.5;
  // верхні довші за нижні — тіло висить, а не стоїть
  for (const s of [-1, 1]) {
    penPath(g, [[cx + s * w * 0.1, cy - h * 0.05], [cx + s * w * 0.34, h * 0.06], [cx + s * w * 0.49, h * 0.3]], ink({ width: lw * 0.85 }));
    penPath(g, [[cx + s * w * 0.1, cy + h * 0.08], [cx + s * w * 0.3, h * 0.62], [cx + s * w * 0.44, h * 0.98]], ink({ width: lw * 0.85 }));
  }
}

function crawlerHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.5, r = Math.min(w, h) * 0.42;
  penCircle(g, cx, cy, r, ink({ width: lw }));
  // очі-галочки: злість без жодної зайвої лінії
  for (const s of [-1, 1]) {
    penPath(g, [[cx + s * r * 0.62, cy - r * 0.42], [cx + s * r * 0.2, cy - r * 0.12], [cx + s * r * 0.6, cy - r * 0.02]], ink({ width: lw * 0.8 }));
  }
  penStroke(g, [[cx - r * 0.5, cy + r * 0.35], [cx + r * 0.5, cy + r * 0.35]], ink({ width: lw * 0.85 }));
  for (const s of [-1, 1]) {
    penPath(g, [[cx + s * r * 0.34, cy + r * 0.35], [cx + s * r * 0.2, cy + r * 0.78], [cx + s * r * 0.08, cy + r * 0.35]], ink({ width: lw * 0.7 }));
  }
}

// 3 — танк: розмах крил удвічі ширший за голову, тому його видно здалеку.
function bathornWings(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.52;
  for (const s of [-1, 1]) {
    const tip = cx + s * w * 0.48;
    penPath(g, [[cx + s * w * 0.1, cy - h * 0.06], [cx + s * w * 0.3, h * 0.04], [tip, cy + h * 0.24]], ink({ width: lw }));
    // перетинка двома фестонами назад до тіла
    penStroke(g, [
      [tip, cy + h * 0.24], [cx + s * w * 0.34, cy + h * 0.1], [cx + s * w * 0.26, cy + h * 0.26],
      [cx + s * w * 0.16, cy + h * 0.08], [cx + s * w * 0.09, cy + h * 0.2],
    ], ink({ width: lw * 0.85 }));
  }
}

function bathornHead(g: Graphics, w: number, h: number, lw: number) {
  const cx = w * 0.5, cy = h * 0.56, r = Math.min(w, h) * 0.36;
  // роги — перше, що видно над колом
  for (const s of [-1, 1]) {
    penPath(g, [[cx + s * r * 0.62, cy - r * 0.78], [cx + s * r * 0.5, cy - r * 1.5], [cx + s * r * 0.22, cy - r * 0.95]], ink({ width: lw * 0.9 }));
  }
  penCircle(g, cx, cy, r, ink({ width: lw }));
  for (const s of [-1, 1]) {
    penPath(g, [[cx + s * r * 0.68, cy - r * 0.4], [cx + s * r * 0.22, cy - r * 0.08], [cx + s * r * 0.66, cy + r * 0.02]], ink({ width: lw * 0.85 }));
  }
  penStroke(g, [[cx - r * 0.52, cy + r * 0.36], [cx + r * 0.52, cy + r * 0.36]], ink({ width: lw * 0.9 }));
  for (const s of [-1, 1]) {
    penPath(g, [[cx + s * r * 0.4, cy + r * 0.36], [cx + s * r * 0.24, cy + r * 0.86], [cx + s * r * 0.08, cy + r * 0.36]], ink({ width: lw * 0.75 }));
  }
  hatch(g, cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 0.7, ink({ gap: r * 0.32, width: lw * 0.45, alpha: 0.35, angle: -0.5 }));
}

const DOODLES: Record<string, Doodle> = {
  earling_body: earlingBody,
  earling_head: earlingHead,
  earling_eyes: earlingEyes,
  magic_base: magicBase,
  magic_roof: magicRoof,
  magic_staff: magicStaff,
  cannon_base: cannonBase,
  cannon_barrel: cannonBarrel,
  keep_wall: keepWall,
  keep_flag: keepFlag,
  decor_tree: decorTree,
  decor_bush: decorBush,
  ally_body_melee: allyBodyMelee,
  ally_body_ranged: allyBodyRanged,
  ally_body_support: allyBodySupport,
  runner_body: runnerBody,
  runner_head: runnerHead,
  brute_body: bruteBody,
  brute_head: bruteHead,
  snowling_body: snowlingBody,
  snowling_head: snowlingHead,
  crawler_limbs: crawlerLimbs,
  crawler_head: crawlerHead,
  bathorn_wings: bathornWings,
  bathorn_head: bathornHead,
};

/**
 * Деталі башт печуться прямо з контурів: гравець обводить рівно те, що потім
 * стане на поле. Один набір ліній — одне джерело, тому малюнок і контур не
 * можуть розійтись.
 * @returns id деталі → маска
 */
export function bakeCatalogue(
  renderer: Renderer, catalogue: Record<string, TowerPart>, look: Look,
): Map<string, Texture> {
  const out = new Map<string, Texture>();
  for (const [id, def] of Object.entries(catalogue)) {
    if (id.startsWith('_') || !def.outline) continue;
    out.set(id, bakeTrace(renderer, def.outline, def.size, look));
  }
  return out;
}

/**
 * Випікає штрихи в маску розміром size клітинок.
 *
 * Те саме, що каталог робить із контуром деталі, — і навмисно тим самим кодом:
 * сюди приходять штрихи, які щойно провела рука в рамці обведення. Якби це були
 * дві різні функції, намальоване гравцем поволі розійшлося б виглядом із
 * каталогом, з якого воно й узялось.
 *
 * @param outline штрихи в коробці 0..1 — байдуже, з даних вони чи з-під пальця
 */
export function bakeTrace(
  renderer: Renderer, outline: Vec2[][], size: Vec2, look: Look,
): Texture {
  const px = look.sprite.refCell * look.sprite.supersample;
  const w = size[0] * px, h = size[1] * px;
  const lw = Math.max(1.8, Math.min(w, h) * 0.075);
  const g = new Graphics();

  for (const s of outline) {
    penStroke(g, s.map(([x, y]): Vec2 => [x * w, y * h]), ink({
      width: lw, jitter: lw * 0.45, step: Math.min(w, h) * 0.2,
      // Перехльости малі: усе, що вилізе за коробку, обріже кадр текстури.
      overshoot: lw * 0.7,
    }));
  }

  const tex = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, w, h), antialias: true,
  });
  g.destroy();
  return tex;
}

/**
 * Пече текстури всіх частин один раз на старті.
 * @returns id частини → маска
 */
export function bakeParts(renderer: Renderer, parts: Parts, look: Look): Map<string, Texture> {
  const px = look.sprite.refCell * look.sprite.supersample;
  const out = new Map<string, Texture>();

  for (const [id, def] of Object.entries(parts)) {
    if (id.startsWith('_')) continue;
    const name = def.file.startsWith('proc:') ? def.file.slice(5) : null;
    const draw = name && DOODLES[name];
    if (!draw) {
      console.warn(`[procart] немає генератора для ${id} (${def.file})`);
      continue;
    }
    const w = def.size[0] * px, h = def.size[1] * px;
    const lw = Math.max(1.8, Math.min(w, h) * 0.055);

    const g = new Graphics();
    draw(g, w, h, lw);
    out.set(id, renderer.generateTexture({
      target: g,
      frame: new Rectangle(0, 0, w, h),
      antialias: true,
    }));
    g.destroy();
  }
  return out;
}
