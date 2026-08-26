// Вежа режиму lane: рівень, поверхи, захисники.
//
// Це заміна складу деталей (build.ts) для цього режиму, і різниця принципова:
// вежа не збирається з сокетів, вона має ПОВЕРХИ, а в поверхах стоять ті, кого
// намалював гравець. Тому оздоблення, комбо й геометричні стати сюди не
// переїхали — сила вежі це сума тих, хто в ній сидить.
//
// Поверхів РІВНО стільки, скільки рядів у смузі, і поверх стоїть навпроти
// свого ряду. Це не оздоблення, а єдиний спосіб не зіштовхнути дві вертикальні
// осі: combat міряє відстань двовимірно, тому поверх, зсунутий по y відносно
// ряду, витрачає радіус на подолання власної висоти. Вирівняні — витрачають
// його на горизонталь, тобто на те, для чого він і є.
//
// Корпус вежі при цьому ЗАВЖДИ на всі ряди: рівень не додає висоти, він
// ВІДКРИВАЄ кімнату. Незайнята кімната стоїть забита, і це видно.
//
// Три незалежні осі росту:
//   рівень вежі  → скільки кімнат відкрито, скільки життів, власна гармата
//   гілка        → перк, один раз на партію
//   рівень поверху → стати конкретного захисника, головна витрата чорнила
//
// Без Pixi: сюди приходять дані, звідси виходять числа. Тому все це ганяється
// з node — і саме тут ховається те, що легко зламати тихо: ціна, що спадає з
// рівнем, стеля поверхів, і прев'ю картки, яке розійшлося з тим, що справді
// станеться після покупки.

import { qualityMul } from './build.js';
import type { Gun } from './build.js';
import type { Vec2 } from '../types.js';

/** Ключ у keep.json#defenders. Рядком, а не union: типи живуть у даних. */
export type DefKind = string;

export interface DefStats {
  damage: number;
  rate: number;
  range: number;
  splash?: number;
}

export interface DefDef {
  _?: string;
  cost: number;
  pen: string;
  size: Vec2;
  stats: DefStats;
  outline: Vec2[][];
}

export interface BranchDef {
  title: string;
  cost: number;
  perk: { shield?: number; defLevel?: number };
}

export interface KeepData {
  _?: string;
  floors: { start: number };
  grow: { cost: number; step: number; livesPer: number };
  gun: { damage: number; rate: number; range: number; perLevel: number };
  branchAt: number;
  branches: Record<string, BranchDef>;
  levelUp: {
    cost: number; step: number;
    damage: number; rate: number; range: number; max: number;
  };
  defenders: Record<string, DefDef>;
  shell: {
    roomW: number; roofH: number; baseH: number;
    /** штрихи всередині ЗАБИТОЇ кімнати — тієї, яку рівень ще не відкрив */
    locked: Vec2[][];
    room: Vec2[][]; roofFort: Vec2[][]; roofArsenal: Vec2[][];
    roofPlain: Vec2[][]; base: Vec2[][];
  };
}

/** Захисник у поверсі. Стати вже пораховані — combat читає лише gun. */
export interface Defender {
  id: number;
  kind: DefKind;
  floor: number;
  level: number;
  quality: number;
  damage: number;
  rate: number;
  range: number;
  gun: Gun;
}

/** Пара «зараз → після покупки» для картки апгрейду. */
export interface Preview {
  level: [number, number];
  damage: [number, number];
  rate: [number, number];
  range: [number, number];
  cost: number;
}

export interface Keep {
  readonly level: number;
  /** ключ у branches; поки не обрано — null */
  readonly branch: string | null;
  /** Скільки всього кімнат — стільки ж, скільки рядів. */
  readonly floorCount: number;
  /** Кімнати згори вниз: індекс кімнати = індекс ряду, навпроти якого вона. */
  readonly floors: (Defender | null)[];
  /** Власна слабка гармата вежі. */
  readonly gun: Gun;
  /** Заряди щита (перк Форту); 0, якщо гілка інша або їх витратили. */
  readonly shield: number;
  /** Скільки життів дав рівень вежі понад базові. */
  readonly bonusLives: number;
  /** Стеля рівня захисника — гілка може її підняти. */
  readonly maxDefLevel: number;

  /** Чи відкрита ця кімната. Закрита видно, але поставити в неї нікого. */
  isOpen(floor: number): boolean;
  /** Чи є ще що відкривати. */
  canGrow(): boolean;
  growCost(): number;
  grow(): boolean;

  /** Чи час обирати гілку (рівень дійшов, а гілки ще немає). */
  canBranch(): boolean;
  branchCost(): number;
  pickBranch(id: string): boolean;

  placeCost(kind: DefKind): number;
  /** @returns поставлений захисник або null, якщо поверх зайнятий/немає */
  place(floor: number, kind: DefKind, quality: number): Defender | null;

  /** @returns null, якщо поверх порожній або захисник на стелі */
  preview(floor: number): Preview | null;
  levelCost(floor: number): number;
  levelUp(floor: number): Defender | null;

  /** Витратити заряд щита. @returns чи був заряд */
  spendShield(): boolean;
  /** Налити щит повністю — між хвилями. */
  refillShield(): void;
}

/**
 * Стати захисника на заданому рівні.
 *
 * Єдине джерело і для `place`/`levelUp`, і для `preview`: якщо їх розвести,
 * картка обіцятиме одне, а після покупки стане інше, і помітить це не тест, а
 * гравець.
 *
 * Приріст лінійний, а не множинний: на картці має читатись «шкода 22 → 27», і
 * лінійне число вгадується наперед, а множинне ні.
 *
 * Якість обведення множить шкоду й темп, але НЕ радіус. Радіус — це геометрія
 * поля: від нього залежить, чи дістає поверх до сусіднього ряду, і ставити цю
 * відповідь у залежність від того, як рівно гравець провів рукою, означало б
 * зробити частину вежі мовчки марною.
 */
export function statsAt(d: DefDef, cfg: KeepData['levelUp'], level: number, quality: number) {
  const n = Math.max(0, level - 1);
  const k = qualityMul(quality);
  return {
    damage: d.stats.damage * k * (1 + cfg.damage * n),
    rate: d.stats.rate * k * (1 + cfg.rate * n),
    range: d.stats.range * (1 + cfg.range * n),
    splash: d.stats.splash ?? 0,
  };
}

/** Гармата для combat.ts. Той самий літерал, що збирає squad.ts ренжовому. */
function gunOfStats(s: { damage: number; rate: number; range: number; splash: number }): Gun {
  const ball = s.splash > 0;
  return {
    damage: s.damage,
    rate: s.rate,
    range: s.range,
    splash: s.splash,
    projectile: ball ? 'ball' : 'bolt',
    speed: ball ? 7 : 11,
  };
}

/**
 * @param rows скільки рядів у смузі — стільки ж і кімнат. Приходить із
 *   laneLevel, а не з keep.json: два джерела одного числа розійшлися б, і
 *   поверх опинився б навпроти міжряддя.
 */
export function createKeep(data: KeepData, rows: number): Keep {
  let level = 1;
  let branch: string | null = null;
  let shield = 0;
  let nextId = 1;

  // Кімнат завжди стільки, скільки рядів: корпус на всі ряди від початку й до
  // кінця партії. Індекс кімнати — це індекс ряду, нульовий згори.
  const floors: (Defender | null)[] = Array.from({ length: rows }, () => null);

  const perk = () => (branch ? data.branches[branch]?.perk ?? {} : {});

  /** Скільки кімнат відкрито. Відкриваються знизу вгору: вежа росте від землі. */
  const openCount = () => Math.min(rows, data.floors.start + (level - 1));

  /**
   * Чи відкрита кімната.
   *
   * Знизу вгору, тому найнижча (індекс rows-1) відкрита завжди: у неї ставлять
   * першого захисника, і саме її ворог зустрічає першою, дійшовши до вежі.
   */
  const isOpen = (floor: number) => floor >= rows - openCount() && floor < rows;

  const round = (n: number) => Math.max(0, Math.round(n));

  function towerGun(): Gun {
    const g = data.gun;
    const k = 1 + g.perLevel * (level - 1);
    return gunOfStats({ damage: g.damage * k, rate: g.rate * k, range: g.range * k, splash: 0 });
  }

  function build(kind: DefKind, floor: number, lvl: number, quality: number, id: number): Defender | null {
    const d = data.defenders[kind];
    if (!d) return null;
    const s = statsAt(d, data.levelUp, lvl, quality);
    return {
      id, kind, floor, level: lvl, quality,
      damage: s.damage, rate: s.rate, range: s.range,
      gun: gunOfStats(s),
    };
  }

  /** Кімната існує, відкрита, і номер її цілий. Три умови, одна перевірка. */
  const usable = (floor: number) =>
    Number.isInteger(floor) && floor >= 0 && floor < rows && isOpen(floor);

  return {
    get level() { return level; },
    get branch() { return branch; },
    get floorCount() { return rows; },
    get floors() { return floors; },
    get gun() { return towerGun(); },
    get shield() { return shield; },
    get bonusLives() { return (level - 1) * data.grow.livesPer; },
    // Стелю рівня підіймає гілка: коли кімнат більше не додати, глибина мусить
    // іти кудись іншим шляхом, інакше рівень вежі впирається в нікуди.
    get maxDefLevel() { return data.levelUp.max + (perk().defLevel ?? 0); },

    isOpen,

    canGrow() { return openCount() < rows; },
    growCost() { return round(data.grow.cost * Math.pow(data.grow.step, level - 1)); },

    grow() {
      if (!this.canGrow()) return false;
      level++;
      return true;
    },

    canBranch() { return branch === null && level >= data.branchAt; },
    branchCost() {
      // Ціна однакова в обох гілок — вибір мусить бути про механіку, а не про те,
      // що на одну зараз вистачає, а на другу ні.
      const first = Object.values(data.branches)[0];
      return round(first?.cost ?? 0);
    },

    pickBranch(id) {
      if (!this.canBranch()) return false;
      if (!data.branches[id]) return false;
      branch = id;
      shield = perk().shield ?? 0;
      return true;
    },

    placeCost(kind) { return round(data.defenders[kind]?.cost ?? 0); },

    place(floor, kind, quality) {
      if (!usable(floor) || floors[floor]) return null;
      const d = build(kind, floor, 1, quality, nextId);
      if (!d) return null;
      nextId++;
      floors[floor] = d;
      return d;
    },

    levelCost(floor) {
      const d = usable(floor) ? floors[floor] : null;
      if (!d) return 0;
      return round(data.levelUp.cost * Math.pow(data.levelUp.step, d.level - 1));
    },

    preview(floor) {
      const d = usable(floor) ? floors[floor] : null;
      if (!d || d.level >= this.maxDefLevel) return null;
      const def = data.defenders[d.kind];
      if (!def) return null;
      const next = statsAt(def, data.levelUp, d.level + 1, d.quality);
      return {
        level: [d.level, d.level + 1],
        damage: [d.damage, next.damage],
        rate: [d.rate, next.rate],
        range: [d.range, next.range],
        cost: this.levelCost(floor),
      };
    },

    levelUp(floor) {
      // Через preview(), а не повз нього: так картка й результат не можуть
      // розійтись навіть теоретично.
      if (!this.preview(floor)) return null;
      const old = floors[floor]!;
      const d = build(old.kind, floor, old.level + 1, old.quality, old.id);
      if (!d) return null;
      floors[floor] = d;
      return d;
    },

    spendShield() {
      if (shield <= 0) return false;
      shield--;
      return true;
    },

    refillShield() { shield = perk().shield ?? 0; },
  };
}
