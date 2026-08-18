// Boot і розкладка.
//
// Одиниця світу = одна клітинка зошита. Уся механіка (траса, радіуси, швидкості)
// живе в клітинках, тому геймплей однаковий на будь-якому екрані.
//
// Ядро core.cols × core.rows видно завжди: клітинка = min(W/cols, H/rows).
// Земля просто продовжується за ядро й заповнює екран — летербоксу немає, у
// ландскейпі по боках виходять широкі газони, на яких теж можна будувати.
// Малюнок персонажа при дрібній клітинці масштабується окремо від хітбокса,
// щоб морди читалися й на вузькому екрані.

import { Application, Container, Graphics } from '../lib/pixi.min.mjs';
import { createPaper } from './view/paper.js';
import { createBoil, inkContainer } from './view/ink.js';
import { bakeParts, bakeCatalogue } from './view/procart.js';
import { createGame } from './game.js';
import { createTools } from './controller/tools.js';
import { createHud } from './controller/hud.js';
import { createSdk } from './sdk.js';
import { createTracePad } from './controller/tracepad.js';
import { createWorkshop } from './controller/workshop.js';
import { createLaneGame } from './laneGame.js';
import { createTowerPanel } from './controller/towerPanel.js';
import { createLaneHud } from './controller/laneHud.js';
import { createSquadPanel } from './controller/squadPanel.js';
import type { Allies, LaneLevel } from './model/lane.js';
import type {
  Balance, Layout, Level, Look, Parts, RigDefs, TowerParts, TowerTiers,
} from './types.js';

// Два режими в одній збірці. `?mode=lane` — коридор з однією вежею, усе інше —
// звичайний лабіринт. Гілки не перетинаються: жоден файл лабіринту про режим
// не знає, і навпаки.
const mode = new URLSearchParams(location.search).get('mode');
const lane = mode === 'lane';

// Каст — єдине місце, де дані входять у програму. Без нього Promise.all віддає
// any[], і всі шість наборів розтікаються нетипізованими по всіх модулях.
const [look, parts, rigDefs, level, balance, towerParts] = await Promise.all([
  fetch('./data/look.json').then((r) => r.json()),
  fetch('./data/parts.json').then((r) => r.json()),
  fetch('./data/rigs.json').then((r) => r.json()),
  fetch('./data/level.json').then((r) => r.json()),
  fetch('./data/balance.json').then((r) => r.json()),
  fetch('./data/towerparts.json').then((r) => r.json()),
]) as [Look, Parts, RigDefs, Level, Balance, TowerParts];

// Дані режиму тягнемо лише коли він увімкнений: лабіринту вони не потрібні,
// і платити за них зайвими запитами він не мусить.
const [laneLevel, laneAllies, laneTiers] = lane
  ? await Promise.all([
      fetch('./data/laneLevel.json').then((r) => r.json()),
      fetch('./data/allies.json').then((r) => r.json()),
      fetch('./data/towerTiers.json').then((r) => r.json()),
    ]) as [LaneLevel, Allies, TowerTiers]
  : [null, null, null];

/**
 * Каталог із рівнями вежі — окрема копія, не мутація спільного.
 *
 * Рівень вежі це деталь-основа, тому рівні мусять лежати в каталозі поруч із
 * деталями. Але каталог лабіринту не має побачити ні одного нового ключа:
 * дописати в towerParts.parts означало б, що майстерня лабіринту раптом знає
 * про Форт. Тому lane працює зі своєю копією об'єкта.
 */
const laneParts: TowerParts | null = lane
  ? {
      ...towerParts,
      parts: { ...towerParts.parts, ...laneTiers!.tiers },
      templates: { ...towerParts.templates, lane: laneTiers!.template },
    }
  : null;

const sdk = createSdk();
await sdk.init();

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  background: '#1b1917',
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
document.getElementById('app')!.appendChild(app.canvas);

const layout: Layout = {
  w: 0, h: 0,
  cell: look.sprite.refCell, // px на клітинку
  ox: 0, oy: 0,              // екранні координати клітинки (0,0) ядра
  spriteScale: 1,
  land: { x0: 0, y0: 0, x1: 0, y1: 0 }, // межі землі в клітинках
};

const paper = createPaper(app, look);

// Boil тремтить лише чорнилом: якщо накрити ним папір — попливе клітинка.
const boil = createBoil(look);

const world = inkContainer([boil.filter]); // чорнило, одиниця = клітинка
const hud = inkContainer();                // нотатки на полях, екранні пікселі
const padSheet = new Container();           // підкладка рамки: звичайний бленд
const pad = inkContainer();                 // чорнило рамки обведення

app.stage.addChild(paper.base, world, paper.overlay, hud, padSheet, pad, boil.sprite);

const textures = bakeParts(app.renderer, parts, look);
// Маски рівнів печуться тим самим кодом, що деталі — інакше домальований
// поверх силует виглядав би іншою рукою.
const partTex = bakeCatalogue(app.renderer, (laneParts ?? towerParts).parts, look);

const debug = new URLSearchParams(location.search).has('debug');

// Скільки клітинок видно завжди. У режимі коридору світ лежить навпаки до
// портретного лабіринту, тому ядро своє.
const core = lane ? laneLevel!.core : look.core;

// Що переставити при ресайзі. Режим наповнює цей список сам, і relayout()
// не мусить знати, який із них зараз працює.
const resizers: ((L: Layout) => void)[] = [];
const systems: ((dtMs: number) => void)[] = []; // отримують 0 на паузі
/** Фаза для SDK: 'wave' означає, що гравець реально в бою. */
let phaseOf: () => string;

// Пауза, коли вкладку сховали (вимога Poki та CrazyGames), зупиняє ЛОГІКУ, а не
// рендер: якщо гасити тікер, у канвасі лишається мертвий кадр.
const state = { paused: false };

const tracePad = createTracePad({
  canvas: app.canvas, layer: pad, sheetLayer: padSheet, look,
  // З ?debug рамка тримає результат довго — інакше його не встигнути роздивитись.
  cfg: debug ? { holdMs: 8000 } : {},
});
resizers.push((L) => tracePad.resize(L));

if (lane) {
  const laneGame = createLaneGame({
    world, renderer: app.renderer, look, level: laneLevel!, allies: laneAllies!, balance,
    rigDefs, parts, textures, layout, towerParts: laneParts!, partTex,
  });
  const towerPanel = createTowerPanel({
    canvas: app.canvas, app, hudLayer: hud, worldLayer: world,
    look, layout, game: laneGame, towerParts: laneParts!, tracePad,
  });
  // ponytail: рестарт через перезавантаження — те саме рішення, що в лабіринті.
  const laneHud = createLaneHud({
    hud, look, balance, allies: laneAllies!, game: laneGame, onRestart: () => location.reload(),
  });
  // Створюється ПІСЛЯ towerPanel: обробники pointerdown ідуть у порядку
  // підписки, тож панель вежі встигає підняти busyPointer до того, як загін
  // побачить той самий тап.
  const squadPanel = createSquadPanel({
    canvas: app.canvas, app, layout, game: laneGame, allies: laneAllies!, tracePad, hud: laneHud,
    blocked: () => tracePad.open || towerPanel.open || towerPanel.busyPointer,
  });

  systems.push((dt) => laneGame.update(dt));
  systems.push((dt) => towerPanel.update(dt / 1000));
  systems.push(() => laneHud.tick());
  resizers.push((L) => { laneGame.rescale(L.spriteScale); laneGame.resize(); });
  resizers.push(() => towerPanel.resize());
  resizers.push((L) => laneHud.resize(L));
  phaseOf = () => laneGame.state.phase;

  window.__td = {
    app, look, layout, world, hud, paper, state, systems,
    laneGame, towerPanel, laneHud, squadPanel, sdk, textures, partTex, tracePad, laneLevel,
  };
} else {
  const game = createGame({
    world, hud, look, level, balance, rigDefs, parts, textures, layout,
    towerParts, partTex,
  });
  // ponytail: рестарт через перезавантаження — стан гри ніде не лишається, а
  // збірка вся локальна (~200 мс). Якщо платформа схоче крутити рекламу між
  // партіями, тут знадобиться скидання на місці, без втрати сесії SDK.
  const hudUi = createHud({ hud, look, balance, game, onRestart: () => location.reload() });
  const workshop = createWorkshop({
    canvas: app.canvas, app, hudLayer: hud, worldLayer: world,
    look, layout, game, towerParts, tracePad,
  });

  const tools = createTools({
    app, canvas: app.canvas, world, layout, game, look,
    hud: hudUi,
    // Поки відкрита рамка обведення або майстерня, поле не приймає ввід:
    // інакше тап повз панель домальовував би стіну під нею.
    blocked: () => tracePad.open || workshop.open || workshop.busyPointer,
    onTower: (cx, cy) => workshop.openAt(cx, cy),
  });

  systems.push((dt) => game.update(dt));
  systems.push((dt) => workshop.update(dt / 1000));
  systems.push(() => hudUi.tick());
  resizers.push((L) => game.rescale(L.spriteScale));
  resizers.push((L) => hudUi.resize(L));
  resizers.push(() => workshop.resize());
  phaseOf = () => game.state.phase;

  window.__td = {
    app, look, layout, world, hud, hudUi, paper, state, systems, game, tools,
    textures, sdk, tracePad, workshop, towerParts, partTex,
  };
}

const debugRect = new Graphics();
if (debug) world.addChild(debugRect);

function relayout() {
  const w = app.screen.width, h = app.screen.height;
  const { cols, rows } = core;

  const cell = Math.min(w / cols, h / rows);
  const ox = Math.round((w - cols * cell) / 2);
  const oy = Math.round((h - rows * cell) / 2);

  layout.w = w;
  layout.h = h;
  layout.cell = cell;
  layout.ox = ox;
  layout.oy = oy;
  // Дрібна клітинка — малюнок більший за хітбокс, інакше морди зникають.
  layout.spriteScale = Math.min(look.sprite.maxScale, Math.max(1, look.sprite.refCell / cell));
  layout.land = { x0: -ox / cell, y0: -oy / cell, x1: cols + ox / cell, y1: rows + oy / cell };

  world.scale.set(cell);
  world.position.set(ox, oy);
  paper.resize(layout);
  boil.resize(w, h);
  for (const r of resizers) r(layout);

  if (debug) {
    debugRect.clear()
      .rect(0, 0, cols, rows)
      .stroke({ width: 2 / cell, color: 0xff00ff, alpha: 0.45 });
  }
}

document.addEventListener('visibilitychange', () => {
  state.paused = document.hidden;
  if (document.hidden) sdk.gameplayStop();
  else if (phaseOf() === 'wave') sdk.gameplayStart();
});

app.ticker.add(({ deltaMS }) => {
  const dt = state.paused ? 0 : deltaMS;
  paper.tick(deltaMS);
  boil.tick(dt);
  for (const s of systems) s(dt);
});

// Платформам треба знати, коли гравець реально в бою: по цьому вони вирішують,
// коли можна показати рекламу. Стежимо за фазою, окремих викликів не розсипаємо.
let lastPhase = '';
systems.push(() => {
  const p = phaseOf();
  if (p === lastPhase) return;
  lastPhase = p;
  if (p === 'wave') sdk.gameplayStart();
  else sdk.gameplayStop();
});

sdk.loadingFinished();

relayout();
app.renderer.on('resize', relayout);
