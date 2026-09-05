// Зброя, рідкість і контри: числа, з яких збирається юніт.
//
// Гравець обводить не силует юніта, а його зброю. Тому саме зброя каже, хто
// це буде: рід (мілі/ренж/підтримка), клас (важка/швидка/збалансована) і базові
// стати. Якість обведення дає РІДКІСТЬ — дискретну, зірками: множник у
// 0.85..1.6 читається («legendary — сильніший на 60%»), а плавний 0.7..1.25 із
// build.ts гравець ніколи не відчував.
//
// Без Pixi: сюди приходять дані weapons.json, звідси виходять числа. Тому все
// це ганяється з node, і саме тут стережеться те, що легко зламати тихо:
// пороги рідкості, що не зростають, і контри, які нічого не контрять.

import type { Vec2 } from '../types.js';

export type WeaponKind = 'melee' | 'ranged' | 'support';
export type WeaponClass = 'balanced' | 'heavy' | 'quick';
export type EnemyClass = 'standard' | 'swift' | 'armored';

/** Стати юніта, який носить цю зброю. */
export interface WeaponStats {
  hp: number;
  damage: number;
  /** ударів (пострілів, зцілень) за секунду; відкат = 1/rate */
  rate: number;
  /** клітинок/с */
  speed: number;
  /** мілі: з якої відстані б'є й на якій спиняє ворога */
  reach?: number;
  /** ренж і підтримка: з якої відстані стріляє/лікує */
  range?: number;
  /** ренж: швидкість снаряда, клітинок/с */
  shot?: number;
  /** підтримка: скільки hp повертає за один імпульс */
  heal?: number;
}

export interface WeaponDef {
  _?: string;
  /** підпис на полиці */
  title: string;
  /** одним рядком, за що ця зброя */
  hint: string;
  kind: WeaponKind;
  cls: WeaponClass;
  cost: number;
  /** у клітинках; коробка квадратна, бо рамка обведення квадратна */
  size: Vec2;
  /** за що тримає рука, у 0..1 коробки — піво́т спрайта */
  grip: Vec2;
  /** базовий кут у градусах; зброя намальована вістрям угору */
  rot?: number;
  stats: WeaponStats;
  /** штрихи в 0..1: одне джерело і для обведення, і для випікання, і для іконки */
  outline: Vec2[][];
}

export interface Rarity {
  id: string;
  stars: number;
  /** якість обведення, від якої починається рівень */
  min: number;
  /** множник hp, шкоди й зцілення */
  mul: number;
  /** колір зірок — ключ look.pens */
  pen: string;
}

/** клас зброї → клас ворога → множник шкоди; чого немає — 1 */
export type Counters = Record<string, Record<string, number>>;

export interface BodyDef {
  /** ключ у parts.json */
  part: string;
  size: Vec2;
  /** точка руки в клітинках від ніг тіла; y вгору від'ємний */
  hand: Vec2;
}

export interface WeaponsData {
  _?: string;
  rarity: Rarity[];
  counters: Counters;
  bodies: Record<WeaponKind, BodyDef>;
  weapons: Record<string, WeaponDef>;
}

/** Ключі зброї без службових `_*`, у порядку файлу — це й порядок карток. */
export const weaponIds = (data: WeaponsData) =>
  Object.keys(data.weapons).filter((k) => !k.startsWith('_'));

/**
 * Рівень за якістю обведення: найвищий, чий поріг не більший за якість.
 * Пороги мають бути відсортовані за зростанням, і перший — нуль; це стереже
 * селфчек, а не код, бо тут бажано лишатись тупим.
 */
export function rarityOf(quality: number, tiers: Rarity[]): Rarity {
  let best = tiers[0];
  for (const t of tiers) if (quality >= t.min) best = t;
  return best;
}

/** Множник шкоди класу зброї проти класу ворога. Чого немає в таблиці — 1. */
export function counterMul(counters: Counters, cls: string, enemyCls: string): number {
  return counters[cls]?.[enemyCls] ?? 1;
}

/**
 * Стати юніта на цій рідкості.
 *
 * Рідкість множить те, що «сила»: живучість, шкоду, зцілення. Темп, засяг і
 * швидкість не чіпає — це геометрія поля: чи дістає спис першим, чи встигає
 * стрілець до підходу бігуна. Ставити це в залежність від того, як рівно
 * провела рука, означало б мовчки міняти правила бою, а не силу юніта.
 */
export function unitStats(def: WeaponDef, tier: Rarity) {
  const s = def.stats;
  return {
    hp: s.hp * tier.mul,
    damage: s.damage * tier.mul,
    heal: (s.heal ?? 0) * tier.mul,
    rate: s.rate,
    speed: s.speed,
    reach: s.reach ?? 0,
    range: s.range ?? 0,
    shot: s.shot ?? 11,
  };
}

/**
 * Яка зброя відкрита на цій хвилі: стартова плюс усе, чий поріг уже пройдено.
 * @param wave номер поточної хвилі з нуля
 */
export function unlockedAt(
  wave: number,
  start: string[],
  unlocks: { wave: number; weapons?: string[]; buildings?: string[] }[],
  key: 'weapons' | 'buildings' = 'weapons',
): Set<string> {
  const out = new Set(start);
  for (const u of unlocks) if (wave >= u.wave) for (const id of u[key] ?? []) out.add(id);
  return out;
}
