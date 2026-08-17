// Загін: коробка союзників перед вежею, cols місць на кожен ряд.
//
// Тут немає ні Pixi, ні малювання — лише хто де стоїть, скільки живе і хто
// кого затримує. Саме це найлегше зламати тихо: переплутати ряд у blockerAt,
// поставити ренжового в передову колонку, замінити не найслабшого. Тому воно
// окремим модулем і під селфчеком.
//
// Коробка НЕ росте: cols × rows — тверда межа. Коли ряд повний, новий союзник
// не додається понад норму, а виштовхує найслабшого. Це і є та межа уваги,
// через яку екран ніколи не тоне в силуетах.

import { qualityMul } from './build.js';
import type { Gun } from './build.js';

export type AllyKind = 'melee' | 'ranged';

/** Базові числа типу союзника. Якість обведення множить їх усі. */
export interface AllyStats {
  hp: number;
  damage: number;
  /** ударів (пострілів) за секунду — однаково для мілі й ренжа, бо саме так
   *  це розуміє Gun.rate у combat.ts, і два різні сенси в одному полі рано чи
   *  пізно дали б мовчазний баг */
  rate: number;
  /** секунд життя при ідеальному обведенні */
  life: number;
  /** ренж: радіус у клітинках */
  range?: number;
  /** мілі: на якій відстані зупиняє ворога */
  reach?: number;
}

export interface Ally {
  id: number;
  kind: AllyKind;
  row: number;
  /** 0 — біля вежі (тил), cols-1 — передова */
  col: number;
  x: number;
  hp: number;
  maxHp: number;
  /** 0..1 з обведення */
  quality: number;
  /** лишилось секунд */
  life: number;
  maxLife: number;
  /** мілі: шкода за удар */
  damage: number;
  /** мілі: ударів за секунду (відкат = 1/rate, як у combat.ts) */
  rate: number;
  /** мілі: відкат до наступного удару, секунди */
  cd: number;
  /** мілі: на якій відстані тримає ворога */
  reach: number;
  /** ренж: те, чим його заводять у combat.ts — той самий Gun, що у вежі */
  gun?: Gun;
}

export type AddAllyResult =
  | { ok: true; ally: Ally; replaced: Ally | null }
  | { ok: false; reason: string };

export interface SquadCfg {
  rows: number;
  /** скільки союзників уміщується в один ряд */
  cols: number;
  /** x колонки, найближчої до вежі */
  xLeft: number;
  /** x передової колонки */
  xRight: number;
  melee: AllyStats;
  ranged: AllyStats;
}

export interface Squad {
  readonly allies: Ally[];
  add(kind: AllyKind, row: number, quality: number): AddAllyResult;
  /** Найближчий мілі попереду точки x у цьому ряду, або null. */
  blockerAt(row: number, x: number): Ally | null;
  /** @returns true, якщо загинув (і вже прибраний зі списку) */
  damage(a: Ally, amount: number): boolean;
  /** @returns кого прибрали, бо згасли */
  tick(dt: number): Ally[];
  colX(col: number): number;
}

export function createSquad(cfg: SquadCfg): Squad {
  const allies: Ally[] = [];
  let nextId = 1;

  const colX = (col: number) => (cfg.cols <= 1
    ? cfg.xLeft
    : cfg.xLeft + (cfg.xRight - cfg.xLeft) * (col / (cfg.cols - 1)));

  const inRow = (row: number) => allies.filter((a) => a.row === row);

  function make(kind: AllyKind, row: number, col: number, quality: number): Ally {
    const s = kind === 'melee' ? cfg.melee : cfg.ranged;
    // Одна й та сама якість множить усе: живучість, шкоду й те, скільки він
    // протримається. Недбалий силует слабкий у всьому, а не лише блідий.
    const k = qualityMul(quality);
    const hp = s.hp * k;
    const life = s.life * k;

    const a: Ally = {
      id: nextId++, kind, row, col, x: colX(col),
      hp, maxHp: hp, quality, life, maxLife: life,
      damage: s.damage * k, rate: s.rate, cd: 0,
      reach: s.reach ?? 0.6,
    };

    // Ренжовий воює не тут, а в combat.ts — тим самим викликом, що й вежа.
    // Тому все, що йому треба, — зібраний Gun.
    if (kind === 'ranged') {
      a.gun = {
        damage: s.damage * k,
        rate: s.rate,
        range: (s.range ?? 3) * k,
        splash: 0,
        projectile: 'bolt',
        speed: 11,
      };
    }
    return a;
  }

  function freeCols(row: number): number[] {
    const taken = new Set(inRow(row).map((a) => a.col));
    const out: number[] = [];
    for (let c = 0; c < cfg.cols; c++) if (!taken.has(c)) out.push(c);
    return out;
  }

  function add(kind: AllyKind, row: number, quality: number): AddAllyResult {
    if (row < 0 || row >= cfg.rows) return { ok: false, reason: 'немає такого ряду' };

    const free = freeCols(row);
    let col: number;
    let replaced: Ally | null = null;

    if (free.length) {
      // Мілі йде в передову колонку, ренж — у тил. Так лінія збирається сама,
      // і гравцеві не треба думати про порядок постановки.
      col = kind === 'melee' ? free[free.length - 1] : free[0];
    } else {
      // Ряд повний: місце поступається найслабший за якістю обведення.
      const weakest = inRow(row).reduce((a, b) => (b.quality < a.quality ? b : a));
      replaced = weakest;
      col = weakest.col;
      allies.splice(allies.indexOf(weakest), 1);
    }

    const ally = make(kind, row, col, quality);
    allies.push(ally);
    return { ok: true, ally, replaced };
  }

  function blockerAt(row: number, x: number): Ally | null {
    let best: Ally | null = null;
    for (const a of allies) {
      if (a.row !== row || a.kind !== 'melee') continue;
      if (a.x > x) continue;                 // позаду ворога — вже пропустив
      if (!best || a.x > best.x) best = a;    // найправіший із тих, хто попереду
    }
    return best;
  }

  function damage(a: Ally, amount: number): boolean {
    a.hp -= amount;
    if (a.hp > 0) return false;
    const i = allies.indexOf(a);
    if (i >= 0) allies.splice(i, 1);
    return true;
  }

  function tick(dt: number): Ally[] {
    const gone: Ally[] = [];
    for (let i = allies.length - 1; i >= 0; i--) {
      const a = allies[i];
      if (a.cd > 0) a.cd -= dt;
      a.life -= dt;
      if (a.life > 0) continue;
      allies.splice(i, 1);
      gone.push(a);
    }
    return gone;
  }

  return { allies, add, blockerAt, damage, tick, colX };
}
