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
import { createBuild, gunOf } from './model/build.js';
import { rowY, rowHeight } from './model/lane.js';
import { createSquad } from './model/squad.js';
import type { Allies, Band, LaneLevel } from './model/lane.js';
import type { Ally, AllyKind, Squad } from './model/squad.js';
import type { Build, Stats } from './model/build.js';
import type { Combat } from './combat.js';
import type { Wallet } from './model/economy.js';
import type {
  Balance, Enemy, Fx, Layout, Look, Parts, Rig, RigDef, RigDefs, TowerParts, Vec2,
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
  towerParts: TowerParts;
  partTex: Map<string, Texture>;
}

export type AddAllyOutcome =
  | { ok: true; ally: Ally; spent: number }
  | { ok: false; reason: string };

export type AddPartResult =
  | { ok: true; id: number; spent: number; stats: Stats }
  | { ok: false; reason: string };

export type LevelUpResult =
  | { ok: true; partId: string; spent: number; refunded: number; stats: Stats }
  | { ok: false; reason: string };

export interface LaneGame {
  state: LaneState;
  wallet: Wallet;
  enemies: LaneEnemy[];
  combat: Combat;
  band: Band;
  /** склад єдиної вежі — те, що доростає панеллю апгрейду */
  tower: Build;
  towerX: number;
  towerY: number;
  spawnEnemy(row?: number | null, typeId?: string, hpMul?: number): LaneEnemy;
  damage(e: Enemy, amount: number): boolean;
  /** Домалювати деталь у сокет вежі. Перша вісь росту: вширшки. */
  addPart(
    partId: string,
    at: { node: number; name: string } | null,
    quality?: number,
  ): AddPartResult;
  /**
   * Дорости рівень вежі. Друга вісь: вглибину. Працює й тоді, коли всі сокети
   * зайняті, — саме цим вежа не впирається в стелю.
   * @param partId деталь-основа з `next` поточного рівня
   */
  levelUp(partId: string, quality?: number): LevelUpResult;
  /** Скільки лишилось зарядів щита (перк гілки Форту); 0, якщо перка немає. */
  readonly shield: number;
  /**
   * Півширина вежі в клітинках світу: зона, що належить вежі, а не полю.
   *
   * Одне джерело для панелі апгрейду й для загону. Раніше в обох стояло по
   * «1.5», і Цитадель шириною три клітинки з такої зони вилазила: тап по її
   * краю ставив би союзника замість того, щоб відкрити панель.
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

/**
 * Іконки комбо — те, чим вони перестають бути невидимими.
 *
 * Комбо були написані в даних і працювали, але на екрані від них не було ні
 * знака: гравець складав пружину зі стволом і не дізнавався, що ввімкнув
 * рикошет. Літер перо не вміє, тому підпис — маленький малюнок, як усе інше
 * на полях. Штрихи в 0..1 коробки.
 */
const COMBO_ICONS: Record<string, Vec2[][]> = {
  // рикошет — відскок від стінки
  ricochet: [[[0.02, 0.2], [0.6, 0.5], [0.02, 0.8]], [[0.75, 0.05], [0.75, 0.95]]],
  // страх — тремтяча лінія
  fear: [[[0.05, 0.7], [0.2, 0.3], [0.35, 0.75], [0.5, 0.28], [0.65, 0.72], [0.8, 0.32], [0.95, 0.68]]],
  // двобічний ствол — у два боки
  twoWay: [[[0.05, 0.5], [0.95, 0.5]], [[0.28, 0.25], [0.03, 0.5], [0.28, 0.75]], [[0.72, 0.25], [0.97, 0.5], [0.72, 0.75]]],
};

/** Вежа в combat під фіксованим id: вона тут одна й назавжди. Союзники
 *  пізніше візьмуть id від 1, тому нуль лишається за нею. */
const TOWER_ID = 0;

/** Другий ствол гілки Арсеналу — окремий запис у combat. Id від'ємний: нуль
 *  за вежею, додатні за союзниками, тому вниз від нуля ніхто не претендує. */
const TOWER_ID2 = -1;

/** Із чого починається вежа. Далі гравець дороблює її сам. */
const TEMPLATE = 'lane';

export function createLaneGame({
  world, renderer, look, level, allies, balance, rigDefs, parts, textures, layout,
  towerParts, partTex,
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

  const placeBuild = (b: Build, x: number, y: number) =>
    mount(buildRig(b.rigDef(), partTex, towerParts.parts, look), x, y);

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
  // Каталог деталей і комбо ті самі, а база своя: у лабіринті башт багато й
  // вони стоять упритул до траси, тут вежа одна й мусить діставати через усю
  // смугу рядів. Правити towerparts.base не можна — це баланс лабіринту.
  const tower = createBuild(towerParts.parts, {
    ...towerParts,
    base: { ...towerParts.base, ...(level.towerBase ?? {}) },
  });
  for (const [partId, host, socket] of towerParts.templates?.[TEMPLATE] ?? []) {
    tower.add(partId, host == null ? null : { node: tower.nodes[host].id, name: socket! }, 1);
  }
  let towerRig = placeBuild(tower, towerX, towerY);

  /** Перк гілки живе в деталі-основі: рівень вежі — це вона й є. */
  const perk = () => tower.nodes[0]?.part.perk ?? {};

  /** Які комбо вже показані — щоб не блимати тим самим на кожній зміні складу. */
  const shownCombos = new Set<string>();

  /**
   * Спалах над вежею: увімкнулось комбо.
   *
   * Маркером, бо це єдиний дозволений у стилі залив, і він тут значить рівно
   * те саме, що в зошиті — «оце важливо».
   */
  function flashCombo(id: string) {
    const icon = COMBO_ICONS[id];
    if (!icon) return;
    const g = new Graphics();
    const u = 1.1;
    const x = towerX - u / 2, y = towerY - (band.y1 - band.y0) / 2 - u;
    for (const s of icon) {
      penStroke(g, s.map(([sx, sy]): Vec2 => [x + sx * u, y + sy * u]), {
        color: look.pens.marker, width: 0.1, alpha: 0.95,
        jitter: 0.03, step: 0.2, overshoot: 0.04, halo: 0.3,
      });
    }
    fxLayer.addChild(g);
    fx.push({
      t: 0,
      step(dt) {
        this.t += dt;
        const p = this.t / 1.6;
        // Спершу стоїть, тане лише в останню третину: інакше не встигнути прочитати.
        g.alpha = p < 0.66 ? 1 : Math.max(0, (1 - p) / 0.34);
        g.position.y = -0.5 * p;
        if (p < 1) return false;
        g.destroy();
        return true;
      },
    });
  }

  /**
   * Нові комбо в складі — кожне блимає раз.
   *
   * Погасле забуваємо: рівень може збити деталь, на якій комбо трималось, і
   * тоді зібране заново мусить блимнути знову.
   */
  function flashNewCombos(stats: Stats) {
    const now = new Set(stats.combos);
    for (const id of shownCombos) if (!now.has(id)) shownCombos.delete(id);
    for (const id of stats.combos) {
      if (shownCombos.has(id)) continue;
      shownCombos.add(id);
      flashCombo(id);
    }
  }

  /** Заряди щита (гілка Форту). Повні на кожній перерві між хвилями. */
  let shield = 0;

  /**
   * Один ствол у бою: завести, перенастроїти або зняти.
   *
   * `combat.retune` при `def === null` тихо нічого не робить — і це не дрібниця
   * саме тут: рівень може збити деталь, на якій трималась уся зброя, і вежа
   * стріляла б далі старою гарматою. Тому «немає гармати» тут означає знятий
   * запис, а не проігнорований виклик.
   *
   * @param cdOffset частка періоду, на яку зсунути перший постріл
   */
  function setGun(id: number, gun: ReturnType<typeof gunOf>, cdOffset = 0) {
    if (!gun) { combat.remove(id); return; }
    if (combat.towers.has(id)) { combat.retune(id, gun, towerRig); return; }
    combat.add(id, gun, towerRig, towerX, towerY);
    const t = combat.towers.get(id);
    if (t && cdOffset) t.cd = cdOffset / gun.rate;
  }

  /**
   * Завести вежу в бій — при старті й після кожної зміни складу чи рівня.
   *
   * Гілка Арсеналу заводить ДВА записи: `combat` уже тримає скільки завгодно
   * стрільців, тому другий ствол — це запис, а не рядок у combat.ts. Шкода
   * кожного менша за повну, а відкат другого зсунутий на півперіод: вежа б'є
   * частіше й дрібніше — розмін проти одного важкого пострілу.
   */
  function retuneTower() {
    const stats = tower.stats();
    const guns = perk().guns ?? 1;
    const gun = gunOf(stats, balance.projectiles);
    const split = gun && guns > 1 ? { ...gun, damage: gun.damage * 0.6 } : gun;
    setGun(TOWER_ID, split);
    setGun(TOWER_ID2, guns > 1 ? split : null, 0.5);
    return stats;
  }
  // Комбо шаблону вважаємо вже показаними: спалах на буті нічого не означає, а
  // на першій же деталі блимнув би тим, що стояло від початку.
  for (const id of retuneTower().combos) shownCombos.add(id);

  /**
   * Домалювати деталь до вежі — це і є апгрейд.
   *
   * Риг перезбирається цілком: склад міняє не картинку, а дерево частин, тож
   * латати наявний вийшло б дорожче й крихкіше. Відкат стрільби при цьому не
   * скидається (див. combat.retune) — інакше апгрейд посеред хвилі дарував би
   * позачерговий постріл.
   */
  function addPart(
    partId: string,
    at: { node: number; name: string } | null,
    quality = 1,
  ): AddPartResult {
    const res = tower.add(partId, at, quality);
    if (!res.ok) return res;

    // Платимо після того, як склад прийняв деталь: інакше відмова «зайнято»
    // з'їдала б чорнило. Не вистачило — знімаємо назад, слідів не лишається.
    const price = towerParts.parts[partId]?.cost ?? 0;
    if (!wallet.pay(price)) {
      tower.remove(res.id);
      return { ok: false, reason: 'мало чорнила' };
    }

    unplace(towerRig);
    towerRig = placeBuild(tower, towerX, towerY);
    const stats = retuneTower();
    flashNewCombos(stats);
    return { ok: true, id: res.id, spent: price, stats };
  }

  /**
   * Дорости рівень вежі — це друга вісь росту, замість переобведення деталі.
   *
   * Ціна перевіряється НАПЕРЕД, а не як в addPart: `promote` знімає деталі,
   * чиїх кріплень новий силует не має, і відкотити це назад уже нічим. Тому
   * спершу гроші, потім склад.
   */
  function levelUp(partId: string, quality = 1): LevelUpResult {
    const root = tower.nodes[0];
    if (!root) return { ok: false, reason: 'вежі немає' };
    const price = towerParts.parts[partId]?.cost ?? 0;
    if (wallet.ink < price) return { ok: false, reason: 'мало чорнила' };

    const res = tower.promote(root.id, partId);
    if (!res.ok) return res;
    wallet.pay(price);
    // Якість обведення нового силуету стає якістю основи: гравець щойно провів
    // її рукою, і саме вона множить stats.range рівня (див. towerTiers._stats).
    // Без цього рядка старанно обведена вежа не відрізнялась би від недбалої.
    root.quality = quality;

    // За збите новим силуетом повертаємо чорнило: деталь зникла не з волі
    // гравця, і брати за це гроші означало б карати за апгрейд. Половина, як у
    // ластика — wallet.refund() тут не годиться, він ходить по таблиці цін
    // інструментів, а ціна деталі живе в каталозі.
    let refunded = 0;
    for (const d of res.dropped) refunded += wallet.earn(Math.floor((d.part.cost ?? 0) * 0.5));

    unplace(towerRig);
    towerRig = placeBuild(tower, towerX, towerY);
    const stats = retuneTower();
    // Теги нового рівня можуть самі ввімкнути комбо — гілка тим і грає в білд.
    flashNewCombos(stats);
    // Щит наливається одразу: інакше гравець заплатив за Форт і до кінця хвилі
    // не бачив, за що.
    shield = perk().shield ?? 0;
    return { ok: true, partId, spent: price, refunded, stats };
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

  /**
   * Риг союзника з обведених штрихів.
   *
   * Гравець бачить у бою рівно те, що провів рукою: `bakeTrace` пече штрихи в
   * маску тим самим кодом, що каталог деталей вежі. Далі це звичайний риг з
   * одної частини — тому дихання, замах і хіт-реакція дістаються задарма, без
   * жодного окремого «спрайт-союзника» в рендері.
   */
  function traceRig(kind: AllyKind, outline: Vec2[][]) {
    const size = allies[kind].size;
    const tex = bakeTrace(renderer, outline, size, look);
    const def: RigDef = {
      hitbox: size,
      anchors: {
        hit: [0, -size[1] * 0.5],
        // Постріл вилітає з фігури, а не з-під ніг: у лучника це висота рук.
        muzzle: [size[0] * 0.45, -size[1] * 0.45],
        ground: [0, size[1] / 2],
      },
      parts: [{
        part: 'trace',
        // Піво́т знизу, а зсув на півросту вгору: фігура сідає центром на лінію
        // ряду, як і ворог, тому сортування за y лишається чесним.
        pos: [0, size[1] / 2], pivot: [0.5, 1], pen: allies[kind].pen,
        mods: [
          { type: 'squash', amp: 0.05, freq: 1.1 },
          { type: 'bob', amp: 0.04, freq: 1.1 },
          { type: 'swing', amp: 9 },
        ],
      }],
    };
    // Один запис у мапі текстур і один розмір — саме те, чого чекає buildRig.
    const rig = buildRig(def, new Map([['trace', tex]]), { trace: { size } }, look);
    return { rig, tex };
  }

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
    towerRig.fire('hit');
    // Щит гілки Форту тримає удар замість життя. Заряд витрачається, ворог
    // зникає, лічильник протікань не рухається — протікання тут не було.
    if (shield > 0) {
      shield--;
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
    shield = perk().shield ?? 0;
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
    for (const r of rigs) r.setScale(s);
  }

  drawLanes();

  return {
    state, wallet, enemies, combat, band, tower, towerX, towerY,
    spawnEnemy, damage, addPart, levelUp, squad, addAlly, update, rescale,
    get shield() { return shield; },
    // Півклітинка запасу — щоб палець не мусив влучати рівно в контур. Але не
    // далі за передню колонку загону: у неї теж мусить бути куди тикнути, а на
    // вузькому екрані spriteScale доходить до 1.8, і зона вежі накрила б її.
    get towerReach() {
      const own = Math.max(1.5, tower.metrics().width * layout.spriteScale / 2 + 0.5);
      return Math.min(own, level.squad.xLeft - towerX - 0.3);
    },
    resize: drawLanes,
  };
}
