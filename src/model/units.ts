// Бій у рядах: хто куди йде, хто кого тримає, хто кого б'є, хто кого лікує.
//
// Замінює squad.ts, і різниця принципова: союзник не стоїть у колонці, він
// ІДЕ. Виходить зі слота, доходить до лінії фронту й тримає її; ворог підійшов —
// б'є. Ворог іде назустріч, спиняється перед першим, хто стоїть на дорозі —
// союзником або будівлею, — і б'є. Ніхто нікого не обходить: ряд — це черга.
// Священик іде за бійцями, стає позаду них і лікує тих, хто в засягу.
//
// Тут немає ні Pixi, ні снарядів як картинки. Модель міняє x і hp та віддає
// ПОДІЇ: «вдарив», «вистрілив», «зцілив», «влучили», «розбив», «протік». Хаб
// уже вирішує, як це показати. Через це все ганяється з node, і саме тут
// стережеться те, що легко зламати тихо: союзник, що пройшов крізь ворога;
// ворог, що б'є союзника з іншого ряду; контри, що не доїхали до шкоди.

import { counterMul, rarityOf, unitStats } from './weapons.js';
import type { EnemyClass, Rarity, WeaponClass, WeaponKind, WeaponsData } from './weapons.js';

export interface Ally {
  id: number;
  row: number;
  kind: WeaponKind;
  /** ключ у weapons.json */
  weapon: string;
  cls: WeaponClass;
  rarity: Rarity;
  x: number;
  hp: number;
  maxHp: number;
  damage: number;
  /** підтримка: hp за один імпульс. Решта: 0 */
  heal: number;
  /** ударів за секунду; відкат = 1/rate */
  rate: number;
  speed: number;
  /** мілі: засяг удару. Решта: 0 */
  reach: number;
  /** ренж: засяг пострілу; підтримка: засяг зцілення. Мілі: 0 */
  range: number;
  /** ренж: швидкість снаряда */
  shot: number;
  /** відкат до наступного удару, секунди */
  cd: number;
  /** чи йшов цього кадру — риг із цього бере ходу */
  moving: boolean;
}

/** Ворог, як його бачить модель. LaneEnemy у хабі задовольняє це й несе риг. */
export interface Foe {
  row: number;
  x: number;
  hp: number;
  cls: EnemyClass;
  damage: number;
  rate: number;
  reach: number;
  speed: number;
  cd: number;
  moving: boolean;
  /** власний бонус проти роду союзника */
  vs?: Partial<Record<WeaponKind, number>>;
}

/** Те, що стоїть у ряду й не рухається: будівля. Ворог б'є її, дійшовши до правого краю. */
export interface Obstacle {
  row: number;
  /** центр */
  x: number;
  /** півширина */
  w: number;
  hp: number;
}

/** Що ворог бачить навколо себе, крім союзників. */
export interface World {
  obstacles?: Obstacle[];
  /** множник швидкості в точці ряду (пастки) */
  slowAt?: (row: number, x: number) => number;
}

export type AllyEvent =
  | { type: 'strike'; ally: Ally; foe: Foe; amount: number; bonus: boolean; penalty: boolean; killed: boolean }
  | { type: 'shoot'; ally: Ally; foe: Foe }
  | { type: 'heal'; ally: Ally; targets: Ally[]; amount: number };

export type FoeEvent =
  | { type: 'hit'; foe: Foe; ally: Ally; amount: number; killed: boolean }
  | { type: 'smash'; foe: Foe; obstacle: Obstacle; amount: number; destroyed: boolean }
  | { type: 'leak'; foe: Foe };

export type SummonResult =
  | { ok: true; ally: Ally }
  | { ok: false; reason: string };

export interface ArmyCfg {
  weapons: WeaponsData;
  rows: number;
  /** де з'являється союзник */
  slotX: number;
  /** лінія фронту: далі без цілі не йде */
  holdX: number;
  /** на скільки позаду фронту тримається священик без бійців */
  supportBack?: number;
  /** лінія дому: ворог дійшов — протік */
  homeX: number;
  /** додатковий множник шкоди (прапори ряду); чого немає — 1 */
  extraMul?: (a: Ally, f: Foe) => number;
}

export interface Army {
  readonly allies: Ally[];
  /** @param tierBoost на скільки рівнів рідкості підняти (кузня) */
  summon(weaponId: string, row: number, quality: number, tierBoost?: number): SummonResult;
  /** @returns true, якщо загинув (і вже прибраний зі списку) */
  damage(a: Ally, amount: number): boolean;
  /** Шкода союзника по ворогу з урахуванням контрів і прапорів. */
  hitOf(a: Ally, f: Foe): { amount: number; bonus: boolean; penalty: boolean };
  /** Союзники: рух до фронту, удари, постріли, зцілення. Шкоду ворогам застосовує сама. */
  stepAllies(foes: Foe[], dt: number): AllyEvent[];
  /** Вороги: рух до дому, удари по союзниках і будівлях, протікання. Шкоду
   *  будівлям НЕ застосовує — віддає подію, бо будівлі живуть у своїй моделі. */
  stepFoes(foes: Foe[], dt: number, world?: World): FoeEvent[];
}

export function createArmy(cfg: ArmyCfg): Army {
  const allies: Ally[] = [];
  let nextId = 1;
  const { counters, rarity, weapons } = cfg.weapons;
  const supportHold = cfg.holdX - (cfg.supportBack ?? 1.5);

  function summon(weaponId: string, row: number, quality: number, tierBoost = 0): SummonResult {
    const def = weapons[weaponId];
    if (!def || weaponId.startsWith('_')) return { ok: false, reason: 'немає такої зброї' };
    if (!Number.isInteger(row) || row < 0 || row >= cfg.rows) return { ok: false, reason: 'немає такого ряду' };

    // Кузня піднімає рівень, а не якість: legendary лишається стелею.
    const base = rarity.indexOf(rarityOf(quality, rarity));
    const tier = rarity[Math.min(rarity.length - 1, Math.max(0, base + tierBoost))];
    const s = unitStats(def, tier);
    const a: Ally = {
      id: nextId++, row, kind: def.kind, weapon: weaponId, cls: def.cls, rarity: tier,
      x: cfg.slotX, hp: s.hp, maxHp: s.hp,
      damage: s.damage, heal: s.heal, rate: s.rate, speed: s.speed,
      reach: s.reach, range: s.range, shot: s.shot,
      // Перший удар не миттєвий: інакше двоє, що зійшлись, били б одночасно
      // в той самий кадр, і хто перший — вирішував би порядок у масиві.
      cd: 0.5 / s.rate,
      moving: false,
    };
    allies.push(a);
    return { ok: true, ally: a };
  }

  function damage(a: Ally, amount: number): boolean {
    a.hp -= amount;
    if (a.hp > 0) return false;
    const i = allies.indexOf(a);
    if (i >= 0) allies.splice(i, 1);
    return true;
  }

  function hitOf(a: Ally, f: Foe) {
    const k = counterMul(counters, a.cls, f.cls) * (cfg.extraMul?.(a, f) ?? 1);
    return { amount: a.damage * k, bonus: k > 1, penalty: k < 1 };
  }

  /** Найближчий живий ворог свого ряду попереду (праворуч). */
  function foeAhead(a: Ally, foes: Foe[]): Foe | null {
    let best: Foe | null = null;
    for (const f of foes) {
      if (f.row !== a.row || f.hp <= 0 || f.x < a.x) continue;
      if (!best || f.x < best.x) best = f;
    }
    return best;
  }

  /** Найближчий боєць свого ряду попереду священика (праворуч). */
  function fighterAhead(a: Ally): Ally | null {
    let best: Ally | null = null;
    for (const o of allies) {
      if (o === a || o.row !== a.row || o.kind === 'support' || o.x < a.x) continue;
      if (!best || o.x < best.x) best = o;
    }
    return best;
  }

  /** Найближчий союзник свого ряду попереду (ліворуч від ворога). */
  function allyAhead(f: Foe): Ally | null {
    let best: Ally | null = null;
    for (const a of allies) {
      if (a.row !== f.row || a.x > f.x) continue;
      if (!best || a.x > best.x) best = a;
    }
    return best;
  }

  /** Найближча ціла будівля свого ряду попереду ворога; відстань — до її правого краю. */
  function obstacleAhead(f: Foe, obstacles: Obstacle[]): Obstacle | null {
    let best: Obstacle | null = null;
    for (const o of obstacles) {
      if (o.row !== f.row || o.hp <= 0 || o.x + o.w > f.x) continue;
      if (!best || o.x > best.x) best = o;
    }
    return best;
  }

  function walk(a: Ally, to: number, dt: number) {
    if (a.x < to) {
      a.x = Math.min(to, a.x + a.speed * dt);
      a.moving = true;
    } else {
      a.moving = false;
    }
  }

  /**
   * Священик: іде за бійцями свого ряду, стає позаду них у засягу й лікує
   * всіх поранених у засягу. Без бійців тримається позаду фронту — сам на
   * передовій він лише корм.
   */
  function stepSupport(a: Ally, dt: number, out: AllyEvent[]) {
    const mate = fighterAhead(a);
    const hurt = allies.filter((o) => o.row === a.row && o.hp < o.maxHp && Math.abs(o.x - a.x) <= a.range);

    if (mate && mate.x - a.x > a.range) {
      walk(a, mate.x - a.range * 0.6, dt);
    } else if (!mate) {
      walk(a, supportHold, dt);
    } else {
      a.moving = false;
    }

    if (!hurt.length || a.cd > 0) return;
    a.cd = 1 / a.rate;
    for (const o of hurt) o.hp = Math.min(o.maxHp, o.hp + a.heal);
    out.push({ type: 'heal', ally: a, targets: hurt, amount: a.heal });
  }

  function stepAllies(foes: Foe[], dt: number): AllyEvent[] {
    const out: AllyEvent[] = [];
    for (const a of allies) {
      if (a.cd > 0) a.cd -= dt;
      if (a.kind === 'support') { stepSupport(a, dt, out); continue; }

      const target = foeAhead(a, foes);
      const engage = a.kind === 'melee' ? a.reach : a.range;

      if (target && target.x - a.x <= engage) {
        a.moving = false;
        if (a.cd > 0) continue;
        a.cd = 1 / a.rate;
        if (a.kind === 'melee') {
          const h = hitOf(a, target);
          target.hp -= h.amount;
          out.push({ type: 'strike', ally: a, foe: target, amount: h.amount, bonus: h.bonus, penalty: h.penalty, killed: target.hp <= 0 });
        } else {
          // Шкоду завдасть снаряд, коли долетить: хаб кличе hitOf на влучанні.
          out.push({ type: 'shoot', ally: a, foe: target });
        }
        continue;
      }

      // Без цілі в засягу — до фронту. Ворог попереду, але за лінією — стоїмо
      // й чекаємо: лінія фронту на те й лінія, щоб її не переходити.
      walk(a, cfg.holdX, dt);
    }
    return out;
  }

  function stepFoes(foes: Foe[], dt: number, world: World = {}): FoeEvent[] {
    const out: FoeEvent[] = [];
    const obstacles = world.obstacles ?? [];
    for (const f of foes) {
      if (f.hp <= 0) continue;
      if (f.cd > 0) f.cd -= dt;

      // Ціль — той, хто ближче попереду: союзник або будівля. Союзник стоїть
      // точкою, будівля — коробкою, тому в неї міряємо до правого краю.
      const ally = allyAhead(f);
      const obst = obstacleAhead(f, obstacles);
      const allyD = ally ? f.x - ally.x : Infinity;
      const obstD = obst ? f.x - (obst.x + obst.w) : Infinity;

      if (Math.min(allyD, obstD) <= f.reach) {
        f.moving = false;
        if (f.cd > 0) continue;
        f.cd = 1 / f.rate;
        if (ally && allyD <= obstD) {
          const amount = f.damage * (f.vs?.[ally.kind] ?? 1);
          const killed = damage(ally, amount);
          out.push({ type: 'hit', foe: f, ally, amount, killed });
        } else if (obst) {
          out.push({ type: 'smash', foe: f, obstacle: obst, amount: f.damage, destroyed: obst.hp - f.damage <= 0 });
        }
        continue;
      }

      f.x -= f.speed * (world.slowAt?.(f.row, f.x) ?? 1) * dt;
      f.moving = true;
      if (f.x <= cfg.homeX) out.push({ type: 'leak', foe: f });
    }
    return out;
  }

  return { allies, summon, damage, hitOf, stepAllies, stepFoes };
}
