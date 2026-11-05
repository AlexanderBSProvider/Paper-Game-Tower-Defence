// Кампанія: сторінки зошита одна за одною, зірки, нескінченний режим.
//
// Сторінка — це не новий формат рівня, а латка поверх laneLevel.json: ряди,
// життя, чорнило на старті й хвилі. Геометрія коридору (слоти, дім,
// фундаменти, фронт, спавн) спільна для всіх, тому інваріанти селфчеку на
// laneLevel.json стережуть і кампанію.
//
// Відкриття тепер живуть між сторінками, а не між хвилями: кожна сторінка
// приносить свою зброю чи будівлю, і на ній це доступне з першої секунди. Так
// гравець отримує «нове!» на початку рівня, коли є час роздивитись, а не
// посеред хвилі.
//
// Без Pixi й без DOM: усе тут ганяється селфчеком з node.

import type { LaneLevel, LaneWave } from './lane.js';

export interface PageDef {
  _?: string;
  id: string;
  title: string;
  rows: number;
  lives: number;
  startInk?: number;
  /** що з'являється на цій сторінці й лишається відкритим далі */
  unlock?: { weapons?: string[]; buildings?: string[] };
  waves: LaneWave[];
}

export interface EndlessDef {
  /** після якої сторінки (id) відкривається */
  after: string;
  rows: number;
  lives: number;
  startInk?: number;
}

export interface CampaignData {
  _?: string;
  pages: PageDef[];
  endless: EndlessDef;
}

/** Що вже відкрито на сторінці i: усе, що принесли сторінки 0..i. */
export function unlockedThrough(c: CampaignData, i: number) {
  const weapons: string[] = [], buildings: string[] = [];
  for (const p of c.pages.slice(0, i + 1)) {
    for (const id of p.unlock?.weapons ?? []) if (!weapons.includes(id)) weapons.push(id);
    for (const id of p.unlock?.buildings ?? []) if (!buildings.includes(id)) buildings.push(id);
  }
  return { weapons, buildings };
}

/** Рівень сторінки i: база + латка. Відкриття всередині рівня вимкнені. */
export function pageLevel(base: LaneLevel, c: CampaignData, i: number): LaneLevel {
  const p = c.pages[i];
  const u = unlockedThrough(c, i);
  return {
    ...base,
    rows: p.rows,
    lives: p.lives,
    startInk: p.startInk ?? base.startInk,
    startWeapons: u.weapons,
    startBuildings: u.buildings,
    unlocks: [],
    buildingUnlocks: [],
    waves: p.waves,
    endless: false,
  };
}

/**
 * Хвиля нескінченного режиму за номером (з нуля). Щоп'ята — з босом.
 * Росте все: кількість, частота, живучість, і суміш тягнеться до броні й
 * бігунів, щоб контри лишались важливими й на двадцятій хвилі.
 */
export function endlessWave(i: number): LaneWave {
  const w: LaneWave = {
    count: Math.round(6 + i * 1.6),
    every: Math.max(1.1, 3.2 - i * 0.11),
    row: null,
    hp: Math.round((1 + i * 0.16) * 100) / 100,
    mix: {
      earling: 3,
      runner: i >= 1 ? 1 + Math.min(4, i * 0.4) : 0,
      brute: i >= 3 ? Math.min(4, (i - 2) * 0.5) : 0,
    },
  };
  if ((i + 1) % 5 === 0) {
    w.boss = 'boss';
    w.count = Math.round(w.count * 0.6);
  }
  return w;
}

/** Рівень нескінченного режиму: усе відкрите, хвилі генеруються. */
export function endlessLevel(base: LaneLevel, c: CampaignData): LaneLevel {
  const u = unlockedThrough(c, c.pages.length - 1);
  return {
    ...base,
    rows: c.endless.rows,
    lives: c.endless.lives,
    startInk: c.endless.startInk ?? base.startInk,
    startWeapons: u.weapons,
    startBuildings: u.buildings,
    unlocks: [],
    buildingUnlocks: [],
    // Першої хвилі досить для типів і HUD; далі laneGame питає endlessWave.
    waves: [endlessWave(0)],
    endless: true,
  };
}

/** Хвиля i рівня: зі списку або з генератора нескінченного режиму. */
export function waveOf(level: LaneLevel, i: number): LaneWave {
  return level.endless ? endlessWave(i) : level.waves[i];
}

/** Зірки за пройдену сторінку: 3 — без втрат, 2 — втратив не більше половини. */
export function starsFor(lives: number, maxLives: number): number {
  if (lives <= 0) return 0;
  if (lives >= maxLives) return 3;
  return lives >= Math.ceil(maxLives / 2) ? 2 : 1;
}

// --- прогрес ------------------------------------------------------------------

export interface Progress {
  v: 1;
  /** найкращі зірки за сторінку: id → 1..3 */
  stars: Record<string, number>;
  /** найдальша хвиля нескінченного режиму (з одиниці) */
  endlessBest: number;
}

export const emptyProgress = (): Progress => ({ v: 1, stars: {}, endlessBest: 0 });

/** Розбір збереженого: що завгодно на вході, валідний прогрес на виході. */
export function parseProgress(raw: string | null | undefined): Progress {
  const p = emptyProgress();
  if (!raw) return p;
  try {
    const d = JSON.parse(raw);
    if (d && typeof d === 'object' && d.stars && typeof d.stars === 'object') {
      for (const [id, n] of Object.entries(d.stars)) {
        if (typeof n === 'number' && n >= 1 && n <= 3) p.stars[id] = Math.floor(n);
      }
    }
    if (typeof d?.endlessBest === 'number' && d.endlessBest > 0) p.endlessBest = Math.floor(d.endlessBest);
  } catch {
    // Зіпсоване збереження — не привід падати: граємо з нуля.
  }
  return p;
}

/** Записати результат сторінки. Зірки лише ростуть. @returns чи це новий рекорд */
export function recordPage(p: Progress, id: string, stars: number): boolean {
  if (stars <= 0) return false;
  const was = p.stars[id] ?? 0;
  if (stars <= was) return false;
  p.stars[id] = stars;
  return true;
}

export function recordEndless(p: Progress, wave: number): boolean {
  if (wave <= p.endlessBest) return false;
  p.endlessBest = wave;
  return true;
}

/** Чи відкрита сторінка i: перша завжди, далі — коли пройдено попередню. */
export function pageOpen(c: CampaignData, p: Progress, i: number): boolean {
  if (i <= 0) return true;
  return (p.stars[c.pages[i - 1]?.id] ?? 0) > 0;
}

export function endlessOpen(c: CampaignData, p: Progress): boolean {
  return (p.stars[c.endless.after] ?? 0) > 0;
}

/** З якої сторінки почати: перша непройдена відкрита, інакше остання. */
export function resumePage(c: CampaignData, p: Progress): number {
  for (let i = 0; i < c.pages.length; i++) {
    if (!(p.stars[c.pages[i].id] > 0)) return i;
  }
  return c.pages.length - 1;
}
