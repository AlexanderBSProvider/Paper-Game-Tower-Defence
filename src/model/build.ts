// Склад башти: які деталі поставлені й куди.
//
// Це і є апгрейд-дерево гри, тільки комбінаторне: башта не має рівнів, вона
// має склад. Дві башти з тих самих деталей, зібрані по-різному, — різні башти,
// бо частина статів рахується з геометрії конструкції, а не з суми чисел.
//
// Без Pixi: сюди приходять дані каталогу, звідси виходять числа й опис рига.
// Тому все це ганяється з node.
//
// Система координат — клітинки, вісь y вниз (як у світі). Початок башти —
// низ заготовки, тому «вище» означає менший y, а всі виміри висоти беруться
// відносно низу.

import type {
  Combo, Mod, PartStats, Projectiles, RigDef, TowerPart, Vec2,
} from '../types.js';

/** Деталь, поставлена в башту. Координати абсолютні, від низу заготовки. */
export interface BuildNode {
  id: number;
  partId: string;
  part: TowerPart;
  parent: number | null;
  socket: string | null;
  quality: number;
  x: number;
  y: number;
}

/** Вільне місце кріплення з абсолютними координатами. */
export interface Socket {
  node: number;
  name: string;
  x: number;
  y: number;
}

/** Виміри силуету — те, через що позиція деталі має значення. */
export interface Metrics {
  height: number;
  width: number;
  topMass: number;
  spikes: number;
  round: number;
  symmetry: number;
}

/** Стати складу. Успадковує PartStats, бо комбо дописують сюди свої поля
 *  (ricochet / fear / twoWay) через Object.assign. */
export interface Stats extends PartStats {
  cost: number;
  damage: number;
  splash: number;
  rate: number;
  range: number;
  crit: number;
  parts: number;
  metrics: Metrics;
  combos: string[];
}

/** Гармата, як її бачить combat. */
export interface Gun {
  damage: number;
  rate: number;
  range: number;
  splash: number;
  projectile: 'ball' | 'bolt';
  speed: number;
  ricochet?: number;
  fear?: number;
  twoWay?: number;
}

export type AddResult =
  | { ok: true; id: number }
  | { ok: false; reason: string };

export interface BuildCfg {
  base?: { rate?: number; range?: number };
  combos?: Combo[];
  hitbox?: Vec2;
}

export interface Build {
  readonly nodes: BuildNode[];
  add(partId: string, at?: { node: number; name: string } | null, quality?: number): AddResult;
  remove(id: number): BuildNode[];
  freeSockets(): Socket[];
  metrics(): Metrics;
  stats(): Stats;
  rigDef(): RigDef;
  readonly empty: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Множник від того, як гравець обвів саме цю деталь. */
export const qualityMul = (q?: number) => 0.7 + 0.55 * clamp01(q ?? 0);

/**
 * Стати гармати зі складу башти.
 *
 * Тип снаряда не записаний у деталях і не має бути: він — наслідок того, що
 * гравець поставив. Є сплеш — значить, щось важке й навісне, летить ядром;
 * немає — б'є одиночну ціль. Тому одна й та сама «гармата» перетворюється на
 * магію, щойно з неї знімуть усе, що дає сплеш.
 */
export function gunOf(stats: Stats | null, base: Projectiles = {}): Gun | null {
  if (!stats || stats.damage <= 0) return null; // башта підтримки: стоїть, але не б'є
  const ball = (stats.splash ?? 0) > 0;
  return {
    damage: stats.damage,
    rate: stats.rate,
    range: stats.range,
    splash: stats.splash ?? 0,
    projectile: ball ? 'ball' : 'bolt',
    speed: ball ? (base.ballSpeed ?? 7) : (base.boltSpeed ?? 11),
    // Комбо дописують свої поля в stats(), а сюди вони не доходили: гармата
    // збиралась заново з шести полів. Через це рикошет, страх і двобічний
    // ствол ніколи не спрацьовували — combat читав undefined.
    ricochet: stats.ricochet,
    fear: stats.fear,
    twoWay: stats.twoWay,
  };
}

export function createBuild(catalogue: Record<string, TowerPart>, cfg: BuildCfg = {}): Build {
  const base = { rate: 1, range: 2.4, ...(cfg.base ?? {}) };
  const combos = cfg.combos ?? [];

  const nodes: BuildNode[] = [];
  let nextId = 1;

  const byId = (id: number) => nodes.find((n) => n.id === id);
  const taken = (id: number, name: string) => nodes.some((n) => n.parent === id && n.socket === name);

  /** Вільні місця кріплення з абсолютними координатами — для підсвітки в UI. */
  function freeSockets(): Socket[] {
    const out: Socket[] = [];
    for (const n of nodes) {
      for (const [name, off] of Object.entries(n.part.sockets ?? {})) {
        if (taken(n.id, name)) continue;
        out.push({ node: n.id, name, x: n.x + off[0], y: n.y + off[1] });
      }
    }
    return out;
  }

  /**
   * Поставити деталь. Заготовка ставиться без сокета (перша деталь).
   * @param partId ключ каталогу
   * @param at місце кріплення
   * @param quality якість обведення 0..1
   */
  function add(
    partId: string,
    at: { node: number; name: string } | null = null,
    quality = 1,
  ): AddResult {
    const part = catalogue[partId];
    if (!part) return { ok: false, reason: 'немає такої деталі' };

    if (!at) {
      if (nodes.length) return { ok: false, reason: 'заготовка вже є' };
      const n: BuildNode = { id: nextId++, partId, part, parent: null, socket: null, quality, x: 0, y: 0 };
      nodes.push(n);
      return { ok: true, id: n.id };
    }

    const host = byId(at.node);
    if (!host) return { ok: false, reason: 'немає такої деталі в башті' };
    const off = host.part.sockets?.[at.name];
    if (!off) return { ok: false, reason: 'немає такого місця' };
    if (taken(at.node, at.name)) return { ok: false, reason: 'зайнято' };

    const n: BuildNode = {
      id: nextId++, partId, part, parent: host.id, socket: at.name, quality,
      x: host.x + off[0], y: host.y + off[1],
    };
    nodes.push(n);
    return { ok: true, id: n.id };
  }

  /** Зняти деталь разом з усім, що на ній трималось. @returns знято */
  function remove(id: number): BuildNode[] {
    const doomed = new Set<number>();
    const walk = (i: number) => {
      doomed.add(i);
      for (const n of nodes) if (n.parent === i) walk(n.id);
    };
    if (!byId(id)) return [];
    walk(id);
    const out = nodes.filter((n) => doomed.has(n.id));
    for (let i = nodes.length - 1; i >= 0; i--) if (doomed.has(nodes[i].id)) nodes.splice(i, 1);
    return out;
  }

  /** Виміри силуету — те, через що позиція деталі має значення. */
  function metrics(): Metrics {
    if (!nodes.length) return { height: 0, width: 0, topMass: 0, spikes: 0, round: 0, symmetry: 1 };

    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    let area = 0, moment = 0;
    let spikes = 0, round = 0, l = 0, r = 0;

    for (const n of nodes) {
      const [w, h] = n.part.size;
      // Коробка рахується від піво́та деталі: у ствола він біля кріплення, а не
      // внизу по центру, інакше горизонтальна деталь «додавала б висоти».
      const [px, py] = n.part.pivot ?? [0.5, 1];
      const x0 = n.x - w * px, y0 = n.y - h * py;
      top = Math.min(top, y0);
      bottom = Math.max(bottom, y0 + h);
      left = Math.min(left, x0);
      right = Math.max(right, x0 + w);

      const a = w * h;
      area += a;
      moment += a * (y0 + h / 2);

      const tags = n.part.tags ?? [];
      if (tags.includes('sharp')) spikes++;
      if (tags.includes('round')) round++;
      if (n.x < -0.05) l++;
      else if (n.x > 0.05) r++;
    }

    return {
      height: bottom - top,
      width: right - left,
      // Наскільки високо сидить маса над низом башти.
      topMass: bottom - moment / area,
      spikes,
      round,
      // Рівно складено — рівно б'є. Одна колона теж симетрична.
      symmetry: l + r === 0 ? 1 : 1 - Math.abs(l - r) / (l + r),
    };
  }

  /** Комбо: пара тегів, яких немає в жодної деталі окремо. */
  function activeCombos(): Combo[] {
    const tags = new Set(nodes.flatMap((n) => n.part.tags ?? []));
    return combos.filter((c) => c.need.every((t) => tags.has(t)));
  }

  function stats(): Stats {
    const m = metrics();
    const sum = (key: keyof PartStats) => nodes.reduce(
      (a, n) => a + (n.part.stats?.[key] ?? 0) * qualityMul(n.quality), 0,
    );

    const out: Stats = {
      cost: nodes.reduce((a, n) => a + (n.part.cost ?? 0), 0),
      damage: sum('damage') * (1 + 0.15 * m.spikes),
      splash: sum('splash'),
      rate: base.rate * (1 + 0.10 * m.round),
      // Ствол вище — бачить далі. Саме тут позиція перетворюється на статистику.
      range: base.range + 0.6 * m.height + 0.4 * m.topMass + sum('range'),
      crit: 0.05 + 0.20 * m.symmetry,
      parts: nodes.length,
      metrics: m,
      combos: [],
    };

    for (const c of activeCombos()) Object.assign(out, c.gives);
    return { ...out, metrics: m, combos: activeCombos().map((c) => c.id) };
  }

  /**
   * Опис для buildRig: дерево частин у координатах батька.
   * Фаза в кожної деталі своя, тому башта хитається шматками, а не цілком.
   */
  function rigDef(): RigDef {
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    return {
      hitbox: cfg.hitbox ?? [2, 2],
      anchors: { hit: [0, -metrics().height * 0.5], ground: [0, 0] },
      parts: nodes.map((n) => {
        // Зсув дає сокет БАТЬКА, а не власні сокети деталі.
        const off: Vec2 = n.parent == null
          ? [0, 0]
          : (byId(n.parent)!.part.sockets?.[n.socket!] ?? [0, 0]);
        const tags = n.part.tags ?? [];
        const mods: Mod[] = [{ type: 'sway', amp: 2.2 + (n.id % 3), freq: 0.35 + (n.id % 5) * 0.06 }];
        if (tags.includes('barrel')) mods.push({ type: 'aim' }, { type: 'recoil', amp: 0.3, dir: [-1, 0.3] });
        return {
          part: n.partId,
          parent: n.parent == null ? undefined : index.get(n.parent),
          pos: n.parent == null ? ([0, 0] as Vec2) : off,
          pivot: n.part.pivot ?? [0.5, 1],
          pen: n.part.pen ?? 'blue',
          mods,
        };
      }),
    };
  }

  return {
    nodes,
    add, remove, freeSockets, metrics, stats, rigDef,
    get empty() { return nodes.length === 0; },
  };
}
