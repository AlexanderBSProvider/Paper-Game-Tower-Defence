// Хаб режиму lane: одна вежа зліва, вороги йдуть справа наліво по рядах.
//
// Ні сітки, ні BFS, ні лабіринту: маршрут — це пряма, тому рух ворога — один
// рядок `e.x -= step`. Усе, що складне в grid.ts/flow.ts, тут просто не існує.
//
// combat.ts береться БЕЗ ЄДИНОЇ ЗМІНИ. Він не знає про сітку — питає лише
// `distOf(e)`, наскільки ворог просунувся. У лабіринті це поле відстаней,
// а тут просто `e.x`: чим менший, тим ближче до вежі. Через це вежа сама
// собою бере найнебезпечнішу ціль, а комбо, рикошет і сплеш працюють задарма.
//
// Координати — клітинки світу, як усюди. Своє ядро (laneLevel.core), бо
// look.core 15x26 задане під портретний лабіринт, а тут світ лежить навпаки.

import { Container, Graphics, Renderer, Texture } from '../lib/pixi.min.mjs';
import { penStroke } from './view/ink.js';
import { buildRig } from './view/rig.js';
import { bakeTrace } from './view/procart.js';
import { createWallet } from './model/economy.js';
import { createCombat } from './combat.js';
import { createKeep } from './model/keep.js';
import { rowY, rowHeight } from './model/lane.js';
import { createSquad } from './model/squad.js';
import type { Allies, Band, LaneLevel } from './model/lane.js';
import type { Ally, AllyKind, Squad } from './model/squad.js';
import type { DefKind, Defender, Keep, KeepData } from './model/keep.js';
import type { Combat } from './combat.js';
import type { Wallet } from './model/economy.js';
import type {
  Balance, Enemy, Fx, Layout, Look, Mod, Parts, Rig, RigDef, RigDefs, Vec2,
} from './types.js';

/** Ворог у режимі: той самий Enemy, плюс ряд. combat.ts приймає Enemy[], і
 *  LaneEnemy[] під нього підходить — саме тому combat не довелося чіпати. */
export interface LaneEnemy extends Enemy {
  row: number;
}

export type Phase = 'break' | 'wave' | 'won' | 'lost';

/** Свій стан, а не GameState із game.ts: там є `sealed` — питання, чи
 *  замкнули лабіринт, якого тут не буває. */
export interface LaneState {
  lives: number;
  maxLives: number;
  wave: number;
  waves: number;
  phase: Phase;
  breakLeft: number;
  spawned: number;
  killed: number;
  leaked: number;
}

export interface LaneGameOpts {
  world: Container;
  /** потрібен, щоб пекти обведене гравцем у текстуру союзника на рантаймі */
  renderer: Renderer;
  look: Look;
  level: LaneLevel;
  allies: Allies;
  balance: Balance;
  rigDefs: RigDefs;
  parts: Parts;
  textures: Map<string, Texture>;
  layout: Layout;
  keepData: KeepData;
}

export type AddAllyOutcome =
  | { ok: true; ally: Ally; spent: number }
  | { ok: false; reason: string };

export type PlaceResult =
  | { ok: true; floor: number; spent: number; defender: Defender }
  | { ok: false; reason: string };

export type LevelResult = PlaceResult;

export type GrowResult =
  | { ok: true; level: number; spent: number }
  | { ok: false; reason: string };

export interface LaneGame {
  state: LaneState;
  wallet: Wallet;
  enemies: LaneEnemy[];
  combat: Combat;
  band: Band;
  /** Вежа: рівень, гілка, поверхи й хто в них сидить. */
  keep: Keep;
  towerX: number;
  towerY: number;
  spawnEnemy(row?: number | null, typeId?: string, hpMul?: number): LaneEnemy;
  damage(e: Enemy, amount: number): boolean;

  /** Центр поверху в клітинках світу. Нульовий поверх — нижній. */
  floorY(floor: number): number;
  /** Висота одного поверху в клітинках. */
  floorH(): number;
  /**
   * Намалювати захисника в поверх.
   * @param outline штрихи з рамки; без них береться контур із даних, тому
   *   виклик із консолі теж працює й дає ідеальний силует
   */
  placeDefender(
    floor: number, kind: DefKind, quality?: number, outline?: Vec2[][],
  ): PlaceResult;
  /** Підняти рівень захисника — головна витрата чорнила. */
  levelDefender(floor: number): LevelResult;
  /** Рівень вежі: +поверх, +життя. */
  growKeep(): GrowResult;
  /** Розвилка гілки, один раз на партію. */
  pickBranch(id: string): GrowResult;

  /**
   * Півширина вежі в клітинках світу: зона, що належить вежі, а не полю.
   * Одне джерело для панелі апгрейду й для загону.
   */
  readonly towerReach: number;
  /** Загін перед вежею: мілі тримають рух, ренжові стріляють через combat. */
  squad: Squad;
  /**
   * Намалювати союзника в ряд. Повний ряд виштовхує найслабшого.
   * @param outline штрихи з рамки обведення; без них береться контур із даних
   */
  addAlly(
    kind: AllyKind, row: number, quality?: number, outline?: Vec2[][],
  ): AddAllyOutcome;
  update(dtMs: number): void;
  rescale(s: number): void;
  resize(): void;
}

/** Вежа в combat під фіксованим id: вона тут одна й назавжди. Союзники
 *  пізніше візьмуть id від 1, тому нуль лишається за нею. */
const TOWER_ID = 0;

export function createLaneGame({
  world, renderer, look, level, allies, balance, rigDefs, parts, textures, layout,
  keepData,
}: LaneGameOpts): LaneGame {
  const band: Band = { y0: level.band.y0, y1: level.band.y1, rows: level.rows };
  const towerX = level.towerX;
  // Вежа стоїть на всіх рядах одразу — вона висока, тому її місце по центру
  // смуги, і пропущений ворог у будь-якому ряду доходить саме до неї.
  const towerY = (band.y0 + band.y1) / 2;

  const wallet = createWallet({
    start: balance.economy.startInk,
    costs: balance.build,
    refund: balance.economy.refund,
  });

  const laneG = new Graphics();   // розмітка рядів
  const fxLayer = new Container();
  const units = new Container();  // усі, хто стоїть на землі: сортуються за y
  const shotLayer = new Container();
  world.addChild(laneG, fxLayer, units, shotLayer);

  const rigs: Rig[] = [];
  /**
   * Риги, які НЕ масштабуються spriteScale: корпус вежі й ті, хто в її поверхах.
   *
   * Дрібна клітинка робить фігури більшими за їхній хітбокс, щоб морди читались.
   * Для вежі це неприпустимо: кімнати мусять лягати на смугу рядів рівно, бо
   * поверх стріляє з тієї y, на якій намальований, а combat міряє відстань
   * двовимірно. Роздутий на 1.8 корпус з'їхав би відносно ряду, у який б'є.
   */
  const fixed: Rig[] = [];
  const fx: Fx[] = [];

  function mount(rig: Rig, x: number, y: number) {
    rig.view.position.set(x, y);
    rig.setScale(layout.spriteScale);
    units.addChild(rig.view);
    rigs.push(rig);
    return rig;
  }

  const place = (rigId: string, x: number, y: number) =>
    mount(buildRig(rigDefs[rigId], textures, parts, look), x, y);

  function unplace(rig: Rig) {
    rig.view.destroy({ children: true });
    rigs.splice(rigs.indexOf(rig), 1);
  }

  // --- розмітка рядів --------------------------------------------------------
  /** Ряди накреслені олівцем: без них поле читається як одна каша, а гравцю
   *  треба бачити, у який саме ряд він ставитиме союзника. */
  function drawLanes() {
    laneG.clear();
    const x0 = 0, x1 = level.core.cols;
    const h = rowHeight(band);

    for (let r = 1; r < band.rows; r++) {
      penStroke(laneG, [[x0, band.y0 + h * r], [x1, band.y0 + h * r]], {
        color: look.pens.pencil, width: 0.03, alpha: 0.28, halo: 0,
        jitter: 0.05, step: 1.4, overshoot: 0,
      });
    }
    // Межі смуги трохи твердіші: видно, де закінчується поле бою.
    for (const y of [band.y0, band.y1]) {
      penStroke(laneG, [[x0, y], [x1, y]], {
        color: look.pens.pencil, width: 0.045, alpha: 0.5, halo: 0,
        jitter: 0.05, step: 1.4, overshoot: 0,
      });
    }
  }

  // --- стан ------------------------------------------------------------------
  const enemies: LaneEnemy[] = [];
  const state: LaneState = {
    lives: level.lives, maxLives: level.lives,
    wave: 0, waves: level.waves.length, phase: 'break',
    breakLeft: level.waveBreak ?? 5,
    spawned: 0, killed: 0, leaked: 0,
  };
  let spawnTimer = 0, waveLeft = 0;

  function despawn(e: LaneEnemy) {
    unplace(e.rig);
    enemies.splice(enemies.indexOf(e), 1);
  }

  function damage(e: Enemy, amount: number): boolean {
    e.hp -= amount;
    if (e.hp > 0) { e.rig.fire('hit'); return false; }
    wallet.earn(e.def.bounty);
    state.killed++;
    despawn(e as LaneEnemy);
    return true;
  }

  /** Наскільки ворог просунувся. Уся заміна BFS-поля на пряму — ось цей рядок. */
  const distOf = (e: Enemy) => e.x;

  const combat = createCombat({
    layer: shotLayer, look, enemies, damage, distOf,
  });

  // --- вежа ------------------------------------------------------------------
  //
  // Вежа — не склад деталей, а стос поверхів. Кімнати займають смугу рядів
  // РІВНО, дах стирчить над нею, постамент під нею: стріляють тільки з кімнат,
  // тому вертикаль засягу рахується саме по смузі. Це не косметика — combat
  // міряє радіус двовимірно, і кімната, піднята вище смуги, втратила б дальні
  // ряди мовчки.
  const keep = createKeep(keepData, level.rows);

  /**
   * Кімната = ряд, тому й геометрія в них спільна.
   *
   * Це не збіг, а сама суть: combat міряє відстань двовимірно, тому кімната,
   * зсунута по y відносно свого ряду, витрачала б радіус на подолання власної
   * висоти. Вирівняні — витрачають його на горизонталь.
   */
  const floorH = () => rowHeight(band);
  const floorY = (f: number) => rowY(band, f);

  /** Півширина вежі — зона, що належить їй, а не полю. */
  const towerReach = () => keepData.shell.roomW / 2 + 0.4;

  /**
   * Контур усієї вежі в 0..1 спільної коробки.
   *
   * Кімната малюється однією й тією ж трійкою штрихів, повтореною по числу
   * поверхів; стелі в кімнати немає навмисно — стеля це підлога кімнати над
   * нею, і другий раз намальована лінія дала б подвоєний штрих на кожному
   * стику.
   */
  function shellGeometry() {
    const sh = keepData.shell;
    const W = sh.roomW;
    const top = band.y0 - sh.roofH;
    const H = sh.roofH + (band.y1 - band.y0) + sh.baseH;
    const x0 = towerX - W / 2;
    const fh = floorH();

    const out: Vec2[][] = [];
    const put = (strokes: Vec2[][], ry: number, rh: number) => {
      for (const s of strokes) {
        out.push(s.map(([px, py]): Vec2 => [px, (ry + py * rh - top) / H]));
      }
    };

    const roof = keep.branch === 'fort' ? sh.roofFort
      : keep.branch === 'arsenal' ? sh.roofArsenal
        : sh.roofPlain;

    put(roof, top, sh.roofH);
    for (let i = 0; i < keep.floorCount; i++) {
      put(sh.room, band.y0 + fh * i, fh);
      // Закрита кімната стоїть забита дошками. Так рівень вежі має що показати:
      // вежа не росте вгору — вона розкривається, і видно, скільки ще лишилось.
      if (!keep.isOpen(i)) put(sh.locked, band.y0 + fh * i, fh);
    }
    put(sh.base, band.y1, sh.baseH);

    return { outline: out, size: [W, H] as Vec2, x: x0 + W / 2, y: top + H / 2 };
  }

  /**
   * Риг з обведених штрихів — і для захисника, і для союзника, і для самої вежі.
   *
   * `bakeTrace` пече штрихи в маску тим самим кодом, що каталог деталей, тому
   * намальоване рукою й намальоване грою виходять однією рукою. Далі це
   * звичайний риг з одної частини: дихання, замах і хіт-реакція дістаються
   * задарма, без жодного окремого «рендеру юнітів».
   */
  function unitRig(size: Vec2, pen: string | undefined, outline: Vec2[][], mods: Mod[]) {
    const tex = bakeTrace(renderer, outline, size, look);
    const def: RigDef = {
      hitbox: size,
      anchors: {
        hit: [0, -size[1] * 0.5],
        // Постріл вилітає з фігури, а не з-під ніг: у лучника це висота рук.
        muzzle: [size[0] * 0.45, -size[1] * 0.45],
        ground: [0, size[1] / 2],
      },
      // Піво́т знизу, а зсув на півросту вгору: фігура сідає центром на свою
      // лінію, тому сортування за y лишається чесним.
      parts: [{ part: 'unit', pos: [0, size[1] / 2], pivot: [0.5, 1], pen: pen ?? 'blue', mods }],
    };
    return { rig: buildRig(def, new Map([['unit', tex]]), { unit: { size } }, look), tex };
  }

  // --- корпус ----------------------------------------------------------------
  let shell: { rig: Rig; tex: Texture };

  function buildShell() {
    const g = shellGeometry();
    const art = unitRig(g.size, 'blue', g.outline, [
      // Корпус дихає ледь помітно: він кам'яний, а не живий.
      { type: 'sway', amp: 0.5, freq: 0.19 },
    ]);
    // Корпус НЕ масштабується spriteScale: кімнати мусять лягати на смугу
    // рядів рівно, інакше поверх з'їде відносно ряду, у який стріляє.
    art.rig.view.position.set(g.x, g.y + g.size[1] / 2);
    art.rig.setScale(1);
    units.addChild(art.rig.view);
    fixed.push(art.rig);
    return art;
  }

  function dropShell() {
    if (!shell) return;
    const i = fixed.indexOf(shell.rig);
    if (i >= 0) fixed.splice(i, 1);
    shell.rig.view.destroy({ children: true });
    // Текстура корпусу своя на кожну перебудову — bakeTrace щоразу віддає новий
    // рендер-таргет, і не зняти його означає лишати його в пам'яті на кожен рівень.
    shell.tex.destroy(true);
  }

  shell = buildShell();

  // --- захисники в поверхах --------------------------------------------------
  /** Малюнок захисника за номером поверху: риг і його ВЛАСНА текстура. */
  const floorArt = new Map<number, { rig: Rig; tex: Texture }>();

  /** Захисники в combat беруть від'ємні id: нуль за вежею, додатні за загоном. */
  const defCombatId = (d: Defender) => -1 - d.id;

  function mountDefender(d: Defender, art: { rig: Rig; tex: Texture }) {
    const y = floorY(d.floor);
    art.rig.view.position.set(towerX, y);
    art.rig.setScale(1); // разом із корпусом: поверх мусить лягти на свою лінію
    units.addChild(art.rig.view);
    fixed.push(art.rig);
    combat.add(defCombatId(d), d.gun, art.rig, towerX, y);
  }

  function dropDefenderArt(floor: number) {
    const art = floorArt.get(floor);
    if (!art) return;
    const i = fixed.indexOf(art.rig);
    if (i >= 0) fixed.splice(i, 1);
    art.rig.view.destroy({ children: true });
    art.tex.destroy(true);
    floorArt.delete(floor);
  }

  /** Власна слабка гармата вежі — щоб на старті гра не стояла. */
  function retuneKeepGun(first: boolean) {
    if (first) combat.add(TOWER_ID, keep.gun, shell.rig, towerX, towerY);
    else combat.retune(TOWER_ID, keep.gun, shell.rig);
  }
  retuneKeepGun(true);

  /**
   * Поставити захисника в поверх.
   *
   * Заводиться в combat тим самим викликом, що вежа й ренжовий союзник — тому
   * сплеш і вибір цілі працюють для нього безплатно.
   *
   * @param outline штрихи з рамки обведення; без них береться контур із даних,
   *   тому виклик із консолі теж працює й дає ідеальний силует
   */
  function placeDefender(
    floor: number, kind: DefKind, quality = 1,
    outline?: Vec2[][],
  ): PlaceResult {
    const def = keepData.defenders[kind];
    if (!def) return { ok: false, reason: 'немає такого захисника' };
    const price = keep.placeCost(kind);
    // Питаємо ДО того, як склад прийняв: поверх зайнятий або чорнила бракує —
    // однаково відмова, і краще одна перевірка, ніж відкат.
    if (wallet.ink < price) return { ok: false, reason: 'мало чорнила' };

    const d = keep.place(floor, kind, quality);
    if (!d) return { ok: false, reason: 'поверх зайнятий' };
    wallet.pay(price);

    const art = unitRig(def.size, def.pen, outline ?? def.outline, [
      { type: 'squash', amp: 0.05, freq: 1.1 },
      { type: 'bob', amp: 0.03, freq: 1.1 },
      { type: 'swing', amp: 9 },
    ]);
    floorArt.set(floor, art);
    mountDefender(d, art);
    return { ok: true, floor, spent: price, defender: d };
  }

  /** Підняти рівень захисника. Головна витрата чорнила. */
  function levelDefender(floor: number): LevelResult {
    const p = keep.preview(floor);
    if (!p) return { ok: false, reason: 'нема кого підсилювати' };
    if (wallet.ink < p.cost) return { ok: false, reason: 'мало чорнила' };

    const d = keep.levelUp(floor);
    if (!d) return { ok: false, reason: 'нема кого підсилювати' };
    wallet.pay(p.cost);
    // Малюнок той самий — рука двічі не працює. Міняються тільки числа.
    combat.retune(defCombatId(d), d.gun, floorArt.get(floor)?.rig ?? shell.rig);
    return { ok: true, floor, spent: p.cost, defender: d };
  }

  /**
   * Пересадити всіх захисників після зміни числа поверхів.
   *
   * Поверхи ділять смугу порівну, тому щойно їх стало більше — кожен поверх
   * поїхав, а разом із ним і той, хто в ньому сидить. `combat.retune` позицію
   * НЕ оновлює, тому запис знімається й заводиться заново.
   */
  function reseatDefenders() {
    for (const d of keep.floors) {
      if (!d) continue;
      const art = floorArt.get(d.floor);
      if (!art) continue;
      combat.remove(defCombatId(d));
      const y = floorY(d.floor);
      art.rig.view.position.set(towerX, y);
      combat.add(defCombatId(d), d.gun, art.rig, towerX, y);
    }
  }

  function rebuildShell() {
    dropShell();
    shell = buildShell();
    retuneKeepGun(false);
    reseatDefenders();
  }

  /** Рівень вежі: +поверх, +життя, трохи сильніша власна гармата. */
  function growKeep(): GrowResult {
    if (!keep.canGrow()) return { ok: false, reason: 'вище нікуди' };
    const price = keep.growCost();
    if (wallet.ink < price) return { ok: false, reason: 'мало чорнила' };
    const lives0 = keep.bonusLives;
    if (!keep.grow()) return { ok: false, reason: 'вище нікуди' };
    wallet.pay(price);
    // Життя дає рівень, тому стеля росте разом із поточним: інакше апгрейд
    // лише піднімав би максимум, не рятуючи в цій партії.
    const got = keep.bonusLives - lives0;
    state.maxLives += got;
    state.lives += got;
    rebuildShell();
    return { ok: true, level: keep.level, spent: price };
  }

  /** Розвилка гілки — один раз на партію. */
  function pickBranch(id: string): GrowResult {
    if (!keep.canBranch()) return { ok: false, reason: 'ще не час' };
    const price = keep.branchCost();
    if (wallet.ink < price) return { ok: false, reason: 'мало чорнила' };
    if (!keep.pickBranch(id)) return { ok: false, reason: 'немає такої гілки' };
    wallet.pay(price);
    rebuildShell();
    return { ok: true, level: keep.level, spent: price };
  }

  // --- загін -----------------------------------------------------------------
  const squad = createSquad({
    rows: level.rows, cols: level.squad.cols,
    xLeft: level.squad.xLeft, xRight: level.squad.xRight,
    melee: allies.melee.stats, ranged: allies.ranged.stats,
  });

  /** Малюнок союзника за id: риг і його ВЛАСНА текстура. У combat він заведений
   *  під тим самим id, тому зняти союзника — це один ключ на все. */
  const allyArt = new Map<number, { rig: Rig; tex: Texture }>();

  /** Союзники беруть id від 1: нуль назавжди за вежею. */
  const allyCombatId = (a: Ally) => a.id;

  function dropAlly(a: Ally) {
    const art = allyArt.get(a.id);
    if (art) {
      unplace(art.rig);
      // Текстура в кожного своя — вона ж і є те, що намалював гравець. Спільні
      // маски каталогу так знімати не можна, а цю не зняти означає лишати
      // рендер-таргет у пам'яті на кожного полеглого.
      art.tex.destroy(true);
      allyArt.delete(a.id);
    }
    combat.remove(allyCombatId(a));
  }

  /** Риг союзника — той самий `unitRig`, що збирає захисника вежі й сам корпус.
   *  Одна функція на все намальоване: інакше три копії одного випікання
   *  розійшлися б виглядом. */
  const traceRig = (kind: AllyKind, outline: Vec2[][]) =>
    unitRig(allies[kind].size, allies[kind].pen, outline, [
      { type: 'squash', amp: 0.05, freq: 1.1 },
      { type: 'bob', amp: 0.04, freq: 1.1 },
      { type: 'swing', amp: 9 },
    ]);

  /**
   * Намалювати союзника в ряд.
   *
   * Ренжовий одразу заводиться в combat тим самим викликом, що й вежа — через
   * це рикошет, сплеш і комбо працюють для нього безплатно. Мілі в combat не
   * потрапляє: він б'є впритул, і його цикл нижче, в update().
   */
  function addAlly(
    kind: AllyKind, row: number, quality = 1,
    outline: Vec2[][] = allies[kind].outline,
  ): AddAllyOutcome {
    const price = allies[kind].cost;
    if (wallet.ink < price) return { ok: false, reason: 'мало чорнила' };

    const res = squad.add(kind, row, quality);
    if (!res.ok) return res;
    wallet.pay(price);

    // Виштовхнутий звільняє і риг, і місце в бою — інакше він стріляв би
    // привидом із чужого місця.
    if (res.replaced) dropAlly(res.replaced);

    const a = res.ally;
    const y = rowY(band, a.row);
    const art = traceRig(kind, outline);
    mount(art.rig, a.x, y);
    allyArt.set(a.id, art);
    if (a.gun) combat.add(allyCombatId(a), a.gun, art.rig, a.x, y);
    return { ok: true, ally: a, spent: price };
  }

  // --- вороги ----------------------------------------------------------------
  function spawnEnemy(row: number | null = null, typeId = 'earling', hpMul = 1): LaneEnemy {
    const r = row ?? Math.floor(Math.random() * band.rows);
    const def = balance.enemies[typeId];
    const y = rowY(band, r);
    const rig = place(def.rig, level.spawnX, y);
    const e: LaneEnemy = {
      rig, def, row: r,
      hp: Math.round(def.hp * hpMul),
      x: level.spawnX, y,
      // Крокової цілі немає: ворог іде прямо. Поля лишаються, бо combat.ts
      // приймає Enemy, а міняти його заради двох null — гірше, ніж їх лишити.
      tx: null, ty: null,
    };
    enemies.push(e);
    state.spawned++;
    return e;
  }

  /**
   * Рукопашна: мілі тримає ворога свого ряду й розмінюється з ним ударами.
   *
   * Це єдине, що не можна віддати combat.ts: він знає лише «стріляти по цілі
   * в радіусі» і нічого не знає про те, що хтось перекриває дорогу. Тому цикл
   * тут, а combat лишається недоторканим.
   *
   * @returns true, якщо ворога тримають — тоді він цього кадру не йде.
   */
  function meleeHold(e: LaneEnemy, dt: number): boolean {
    const blocker = squad.blockerAt(e.row, e.x);
    if (!blocker || e.x - blocker.x > blocker.reach) return false;

    blocker.cd -= dt;
    if (blocker.cd <= 0) {
      blocker.cd = 1 / blocker.rate;
      allyArt.get(blocker.id)?.rig.fire('attack');
      damage(e, blocker.damage);
    }

    // Ворог б'є у відповідь: інакше мілі тримав би лінію вічно й безкарно.
    e.rig.fire('attack');
    if (squad.damage(blocker, e.def.speed * dt * 6)) dropAlly(blocker);
    return true;
  }

  function advance(e: LaneEnemy, step: number) {
    e.x -= step;
    if (e.x > towerX) return;
    shell.rig.fire('hit');
    // Щит гілки Форту тримає удар замість життя. Заряд витрачається, ворог
    // зникає, лічильник протікань не рухається — протікання тут не було.
    if (keep.spendShield()) {
      despawn(e);
      return;
    }
    // Дійшов до вежі: життя мінус, ворог зникає. Бази як окремого об'єкта
    // немає — вежа і є те, що захищають.
    state.lives = Math.max(0, state.lives - 1);
    state.leaked++;
    despawn(e);
    if (state.lives === 0) state.phase = 'lost';
  }

  /** Хвилі: наступна починається, коли поле чисте, а не за таймером —
   *  перерва це час домалювати вежу, і вкорочувати її автоматично нечесно. */
  function updateWaves(dt: number) {
    const w = level.waves[state.wave];

    if (state.phase === 'break') {
      state.breakLeft -= dt;
      if (state.breakLeft > 0) return;
      state.phase = 'wave';
      waveLeft = w.count;
      spawnTimer = 0;
      return;
    }

    if (waveLeft > 0) {
      spawnTimer -= dt;
      if (spawnTimer > 0) return;
      spawnEnemy(w.row ?? null, w.enemy ?? 'earling', w.hp ?? 1);
      waveLeft--;
      spawnTimer = w.every;
      return;
    }

    if (enemies.length) return;
    if (state.wave + 1 >= level.waves.length) { state.phase = 'won'; return; }
    state.wave++;
    state.phase = 'break';
    state.breakLeft = level.waveBreak ?? 5;
    // Щит наливається між хвилями, а не в бою: інакше Форт тримав би нескінченно.
    keep.refillShield();
  }

  function update(dtMs: number) {
    const dt = dtMs / 1000;
    const over = state.phase === 'won' || state.phase === 'lost';

    if (!over) {
      updateWaves(dt);
      // Згаслі союзники зникають самі: недбало намальований в'яне швидше, і
      // це та ціна поспіху, на якій тримається бій.
      for (const gone of squad.tick(dt)) dropAlly(gone);

      for (const e of [...enemies]) {
        // Спершу питаємо, чи його тримають: якщо так — крок цього кадру
        // не робиться взагалі, а не робиться й скасовується.
        if (meleeHold(e, dt)) {
          if (!enemies.includes(e)) continue;
          e.rig.moving = false;
        } else {
          advance(e, e.def.speed * (1 - (e.slow ?? 0)) * dt);
          if (!enemies.includes(e)) continue;
          e.rig.moving = true;
        }
        e.rig.view.position.set(e.x, e.y);
      }
    }
    combat.update(dt, !over);

    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].step(dt)) fx.splice(i, 1);
    for (const r of rigs) r.update(dtMs);
    units.children.sort((a, b) => a.y - b.y);
  }

  function rescale(s: number) {
    // Корпус вежі й ті, хто в поверхах, лишаються один-до-одного: їхні
    // координати зав'язані на смугу рядів, а не на читаність фігури.
    for (const r of rigs) r.setScale(s);
  }

  drawLanes();

  return {
    state, wallet, enemies, combat, band, keep, towerX, towerY,
    spawnEnemy, damage, squad, addAlly, update, rescale,
    floorY, floorH,
    placeDefender, levelDefender, growKeep, pickBranch,
    // Зона вежі не залежить від рівня: корпус однакової ширини на всіх
    // поверхах. Але й не далі за передню колонку загону — у неї теж мусить
    // бути куди тикнути.
    get towerReach() {
      return Math.min(towerReach(), level.squad.xLeft - towerX - 0.3);
    },
    resize: drawLanes,
  };
}
