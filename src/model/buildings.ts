// Будівлі: село на фундаментах одразу за лінією дому, на шляху ворогів.
//
// Кожна будівля — це hp плюс один ефект. hp тому, що вона стоїть у ряду: ворог,
// який пройшов повз бійців, зупиняється й ламає її, як ламав би союзника.
// Ефекти:
//   well      накопичує краплю чорнила; поки крапля висить, нову не робить.
//             Крапля збирається ТАПОМ — це рішення власника, і саме через це
//             колодязь не «капає в ручку», а тримає краплю над собою.
//   barricade нічого, крім hp: купує час.
//   banner    множник шкоди всім бійцям ряду проти одного класу ворога.
//   forge     наступному намальованому в ряду +tiers рівнів рідкості, потім
//             перезарядка.
//   chapel    лікує поранених союзників ряду в засягу по імпульсу.
//   trap      вороги в межах span від пастки йдуть із швидкістю slow.
//
// Без Pixi: сюди приходять дані buildings.json, звідси виходять числа й
// події. Тому все це ганяється з node, і саме тут стережеться те, що легко
// зламати тихо: колодязь, що робить другу краплю поверх першої; прапор, що
// бафає чужий ряд; кузня, яка не перезаряджається.

import { rarityOf } from './weapons.js';
import type { EnemyClass, Rarity } from './weapons.js';
import type { Ally } from './units.js';
import type { Vec2 } from '../types.js';

export type BuildingEffect =
  | { type: 'well'; every: number; ink: number }
  | { type: 'barricade' }
  | { type: 'banner'; vs: EnemyClass; mul: number }
  | { type: 'forge'; tiers: number; recharge: number }
  | { type: 'chapel'; heal: number; every: number; range: number }
  | { type: 'trap'; slow: number; span: number };

export interface BuildingDef {
  _?: string;
  title: string;
  hint: string;
  cost: number;
  size: Vec2;
  hp: number;
  effect: BuildingEffect;
  outline: Vec2[][];
}

export interface BuildingsData {
  _?: string;
  buildings: Record<string, BuildingDef>;
}

export interface Building {
  id: number;
  kind: string;
  def: BuildingDef;
  row: number;
  col: number;
  /** центр фундаменту */
  x: number;
  /** півширина: ворог б'є, дійшовши до правого краю */
  w: number;
  hp: number;
  maxHp: number;
  rarity: Rarity;
  /** well/chapel: секунд до наступного імпульсу; forge: до перезарядки */
  timer: number;
  /** well: крапля висить і чекає тапу; forge: заряд готовий */
  ready: boolean;
}

export type TownEvent =
  | { type: 'drop'; building: Building }
  | { type: 'heal'; building: Building; targets: Ally[]; amount: number };

export type BuildResult =
  | { ok: true; building: Building }
  | { ok: false; reason: string };

export interface TownCfg {
  data: BuildingsData;
  rarity: Rarity[];
  rows: number;
  cols: number;
  /** x центру фундаменту в стовпчику */
  plotX(col: number): number;
  plotHalf: number;
}

export interface Town {
  readonly buildings: Building[];
  build(kind: string, row: number, col: number, quality: number): BuildResult;
  at(row: number, col: number): Building | null;
  /** @returns true, якщо зруйновано (і вже прибрано) */
  damage(b: Building, amount: number): boolean;
  tick(dt: number, allies: Ally[]): TownEvent[];
  /** Забрати краплю з колодязя. @returns чорнило, або 0, якщо краплі немає */
  collect(b: Building): number;
  /** Множник шкоди бійців ряду проти класу ворога — від прапорів. */
  dmgMul(row: number, enemyCls: string): number;
  /** Множник швидкості ворога в цій точці ряду — від пасток. */
  slowAt(row: number, x: number): number;
  /** Скільки рівнів рідкості додає кузня ряду; заряд витрачається. */
  takeForge(row: number): number;
}

export const buildingIds = (data: BuildingsData) =>
  Object.keys(data.buildings).filter((k) => !k.startsWith('_'));

export function createTown(cfg: TownCfg): Town {
  const buildings: Building[] = [];
  let nextId = 1;

  const at = (row: number, col: number) =>
    buildings.find((b) => b.row === row && b.col === col) ?? null;

  function build(kind: string, row: number, col: number, quality: number): BuildResult {
    const def = cfg.data.buildings[kind];
    if (!def || kind.startsWith('_')) return { ok: false, reason: 'немає такої будівлі' };
    if (!Number.isInteger(row) || row < 0 || row >= cfg.rows) return { ok: false, reason: 'немає такого ряду' };
    if (!Number.isInteger(col) || col < 0 || col >= cfg.cols) return { ok: false, reason: 'немає такого фундаменту' };
    if (at(row, col)) return { ok: false, reason: 'фундамент зайнятий' };

    const tier = rarityOf(quality, cfg.rarity);
    const hp = def.hp * tier.mul;
    const e = def.effect;
    const b: Building = {
      id: nextId++, kind, def, row, col, x: cfg.plotX(col), w: cfg.plotHalf,
      hp, maxHp: hp, rarity: tier,
      timer: e.type === 'well' ? e.every : e.type === 'chapel' ? e.every : 0,
      // Кузня готова одразу: платиш і одразу маєш що показати.
      ready: e.type === 'forge',
    };
    buildings.push(b);
    return { ok: true, building: b };
  }

  function damage(b: Building, amount: number): boolean {
    b.hp -= amount;
    if (b.hp > 0) return false;
    const i = buildings.indexOf(b);
    if (i >= 0) buildings.splice(i, 1);
    return true;
  }

  function tick(dt: number, allies: Ally[]): TownEvent[] {
    const out: TownEvent[] = [];
    for (const b of buildings) {
      const e = b.def.effect;
      if (e.type === 'well') {
        // Поки крапля висить, колодязь не працює: незібране не накопичується.
        if (b.ready) continue;
        b.timer -= dt;
        if (b.timer > 0) continue;
        b.timer = e.every;
        b.ready = true;
        out.push({ type: 'drop', building: b });
      } else if (e.type === 'chapel') {
        b.timer -= dt;
        if (b.timer > 0) continue;
        b.timer = e.every;
        const hurt = allies.filter((a) => a.row === b.row && a.hp < a.maxHp && Math.abs(a.x - b.x) <= e.range);
        if (!hurt.length) continue;
        const amount = e.heal * b.rarity.mul;
        for (const a of hurt) a.hp = Math.min(a.maxHp, a.hp + amount);
        out.push({ type: 'heal', building: b, targets: hurt, amount });
      } else if (e.type === 'forge') {
        if (b.ready) continue;
        b.timer -= dt;
        if (b.timer <= 0) b.ready = true;
      }
    }
    return out;
  }

  function collect(b: Building): number {
    const e = b.def.effect;
    if (e.type !== 'well' || !b.ready) return 0;
    b.ready = false;
    b.timer = e.every;
    return Math.round(e.ink * b.rarity.mul);
  }

  function dmgMul(row: number, enemyCls: string): number {
    let k = 1;
    for (const b of buildings) {
      const e = b.def.effect;
      if (b.row === row && e.type === 'banner' && e.vs === enemyCls) k *= e.mul;
    }
    return k;
  }

  function slowAt(row: number, x: number): number {
    let k = 1;
    for (const b of buildings) {
      const e = b.def.effect;
      if (b.row === row && e.type === 'trap' && Math.abs(x - b.x) <= e.span) k = Math.min(k, e.slow);
    }
    return k;
  }

  function takeForge(row: number): number {
    let tiers = 0;
    for (const b of buildings) {
      const e = b.def.effect;
      if (b.row !== row || e.type !== 'forge' || !b.ready) continue;
      b.ready = false;
      b.timer = e.recharge;
      tiers += e.tiers;
    }
    return tiers;
  }

  return { buildings, build, at, damage, tick, collect, dmgMul, slowAt, takeForge };
}
