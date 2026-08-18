// Форми даних, які читають майже всі модулі: шість файлів data/*.json, розкладка
// та кілька записів, що ходять між модулями.
//
// Тут лежить ТІЛЬКИ те, що спільне для багатьох. Контракти окремого модуля
// (PenOpts, Grid, Build, Game…) живуть у своїх файлах — інакше цей файл стає
// звалищем, а імпорти — заплутаними.
//
// Файл суто типовий: у dist/types.js виїжджає `export {}`, браузер його не тягне.

import type { Container } from '../lib/pixi.min.mjs';

/** Точка або розмір у клітинках. Тапл, а не number[]: інакше спред у виклик
 *  фіксованої арності (f(...pt)) не проходить перевірку. */
export type Vec2 = [number, number];

/** Екранна розкладка. Одиниця світу — клітинка зошита, тому все, що тут у px,
 *  перераховується при кожному ресайзі. */
export interface Layout {
  w: number;
  h: number;
  /** px на клітинку */
  cell: number;
  /** екранні координати клітинки (0,0) ядра */
  ox: number;
  oy: number;
  spriteScale: number;
  /** межі землі в клітинках */
  land: { x0: number; y0: number; x1: number; y1: number };
}

/** Ефект, що сам себе доживає: повертає true, коли його час вийшов. */
export interface Fx {
  t: number;
  step(dt: number): boolean;
}

// --- data/look.json ---------------------------------------------------------

/** Індексна сигнатура тут не для краси: ручку вибирають за іменем із даних
 *  (`look.pens[p.pen]`), а це рядок, відомий лише в рантаймі. */
export interface Pens {
  blue: string;
  red: string;
  green: string;
  marker: string;
  pencil: string;
  [name: string]: string;
}

export interface Look {
  core: { cols: number; rows: number };
  sprite: { refCell: number; maxScale: number; supersample: number };
  paper: {
    base: string;
    blotchAlpha: number;
    blotches: number;
    grainAlpha: number;
    grainFps: number;
    spineSide: string;
    spineAlpha: number;
    curl: boolean;
  };
  grid: {
    cell: number;
    color: string;
    alpha: number;
    width: number;
    wobble: number;
    dropout: number;
    fade: number;
  };
  margin: { enabled: boolean; cols: number; color: string; alpha: number };
  pens: Pens;
  boil: { amplitude: number; fps: number };
  vignette: number;
}

// --- data/level.json --------------------------------------------------------

export interface Wave {
  count: number;
  every: number;
  hp?: number;
  enemy?: string;
}

export interface Level {
  _?: string;
  lives: number;
  entry: Vec2;
  base: Vec2;
  baseSize: Vec2;
  waveBreak?: number;
  waves: Wave[];
  startWalls?: Vec2[];
  /** [id рига, cx, cy] */
  decor: [string, number, number][];
}

// --- data/balance.json ------------------------------------------------------

export interface EnemyDef {
  rig: string;
  hp: number;
  speed: number;
  bounty: number;
}

export interface Balance {
  _?: string;
  _projectiles?: string;
  economy: { startInk: number; refund: number; gauge: number };
  build: Record<string, number>;
  enemies: Record<string, EnemyDef>;
  projectiles: Projectiles;
  towers: Record<string, unknown>;
}

export interface Projectiles {
  boltSpeed?: number;
  ballSpeed?: number;
}

// --- data/parts.json --------------------------------------------------------

export interface PartDef {
  /** `proc:*` малює генератор, інакше це шлях до PNG */
  file: string;
  /** у клітинках */
  size: Vec2;
}

/** Ключ `_` у JSON — коментар; код скрізь відсіює `id.startsWith('_')`, тому
 *  в типі його немає: інакше кожен обхід Object.entries давав би `PartDef | string`. */
export type Parts = Record<string, PartDef>;

// --- data/rigs.json ---------------------------------------------------------

export interface Mod {
  type: string;
  amp?: number;
  freq?: number;
  phase?: number;
  every?: number;
  hold?: number;
  dir?: Vec2;
  on?: string;
}

export interface RigPart {
  part: string;
  /** індекс у масиві parts цього ж рига */
  parent?: number;
  pos: Vec2;
  /** початковий кут у градусах */
  rot?: number;
  /** у частках текстури */
  pivot?: Vec2;
  /** ім'я ручки з look.pens */
  pen?: string;
  /** дзеркалити по x; за замовчуванням false, тому дані, які його не задають,
   *  малюються як малювались */
  flip?: boolean;
  mods?: Mod[];
}

export interface RigDef {
  hitbox: Vec2;
  anchors?: Record<string, Vec2>;
  parts: RigPart[];
}

/** Як і Parts: ключ-коментар `_` у типі не описуємо. */
export type RigDefs = Record<string, RigDef>;

// --- data/towerparts.json ---------------------------------------------------

/** Стати, які деталь додає башті. Комбо дописують сюди свої поля через gives. */
export interface PartStats {
  damage?: number;
  rate?: number;
  range?: number;
  splash?: number;
  ricochet?: number;
  fear?: number;
  twoWay?: number;
}

export interface TowerPart {
  kind: string;
  size: Vec2;
  cost?: number;
  tags?: string[];
  /** у частках коробки, за замовчуванням низ-центр */
  pivot?: Vec2;
  pen?: string;
  /** куди чіпляти наступну деталь, у клітинках від власного початку */
  sockets?: Record<string, Vec2>;
  stats?: PartStats;
  /** штрихи в 0..1 коробки деталі: одне джерело і для обведення, і для випікання */
  outline: Vec2[][];

  // --- рівні вежі (тільки lane mode, data/towerTiers.json) ------------------
  // Деталі лабіринту цих полів не мають, тому для нього нічого не змінюється.

  /** підпис рівня на розвилці */
  title?: string;
  /** у які деталі-основи цей рівень може дорости (див. build.promote) */
  next?: string[];
  /** які роди деталей приймає кожне кріплення; без цього — приймає будь-що */
  socketKinds?: Record<string, string[]>;
  /** кріплення, у яких деталь дзеркалиться по x */
  socketFlip?: string[];
  /** власна механіка гілки; читає laneGame, не модель */
  perk?: { shield?: number; guns?: number };
}

export interface Combo {
  id: string;
  need: string[];
  gives: PartStats;
  _?: string;
}

/** Рецепт заготовки: [деталь, індекс господаря в цьому ж списку, сокет]. */
export type TemplateStep = [string, number | null, string | null];

export interface TowerParts {
  _?: string;
  _templates?: string;
  base: { rate?: number; range?: number };
  hitbox: Vec2;
  templates?: Record<string, TemplateStep[]>;
  combos: Combo[];
  parts: Record<string, TowerPart>;
}

// --- data/towerTiers.json (тільки lane mode) --------------------------------

/** Рівні вежі. Форма деталі та сама — рівень це і є деталь-основа. */
export interface TowerTiers {
  _?: string;
  _fields?: string;
  _art?: string;
  /** з чого починається вежа режиму */
  template: TemplateStep[];
  tiers: Record<string, TowerPart>;
}

// --- риг --------------------------------------------------------------------

/** Зібраний персонаж. Живе в rig.ts, але тип тут: його тримають Enemy, game,
 *  combat і workshop — у будь-якому з них він створив би цикл імпортів. */
export interface Rig {
  view: Container;
  hitbox: Vec2;
  /** Позиція якоря в одиницях світу відносно початку рига (з масштабом). */
  anchor(name: string): Vec2;
  setScale(s: number): void;
  /** Тільки на запис: гра каже стан, риг сам вирішує, як це показати. */
  moving: boolean;
  aim: number | null;
  dead: boolean;
  fire(what: string): void;
  update(dtMs: number): void;
}

// --- ворог ------------------------------------------------------------------

/** Живе і в game.ts (рух, спавн), і в combat.ts (ціль) — тому тут, а не в
 *  одному з них: інакше вийшов би цикл між ними. */
export interface Enemy {
  rig: Rig;
  def: EnemyDef;
  hp: number;
  x: number;
  y: number;
  /** ціль кроку в клітинках, null — треба переобрати */
  tx: number | null;
  ty: number | null;
  /** сповільнення 0..1 від комбо fear */
  slow?: number;
}

// --- глобали браузера -------------------------------------------------------

/** Тільки те, що справді викликаємо. Повні SDK вендорів описувати не треба. */
export interface PokiSdk {
  init(): Promise<unknown>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(): Promise<unknown>;
}

export interface CrazySdk {
  init?(): Promise<unknown>;
  game: {
    sdkGameLoadingStop?(): void;
    gameplayStart(): void;
    gameplayStop(): void;
  };
  ad: { requestAd(type: string): void };
}

declare global {
  interface Window {
    /** налагоджувальний доступ до всього з консолі */
    __td?: unknown;
    PokiSDK?: PokiSdk;
    CrazyGames?: { SDK?: CrazySdk };
  }
}
