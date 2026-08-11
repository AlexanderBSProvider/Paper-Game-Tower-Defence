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
import { createPaper } from './paper.js';
import { createBoil, inkContainer } from './ink.js';
import { bakeParts, bakeCatalogue } from './procart.js';
import { buildRig } from './rig.js';
import { createBuild } from './build.js';
import { createGame } from './game.js';
import { createTools } from './tools.js';
import { createHud } from './hud.js';
import { createSdk } from './sdk.js';
import { createTracePad } from './tracepad.js';

const [look, parts, rigDefs, level, balance, towerParts] = await Promise.all([
  fetch('./data/look.json').then((r) => r.json()),
  fetch('./data/parts.json').then((r) => r.json()),
  fetch('./data/rigs.json').then((r) => r.json()),
  fetch('./data/level.json').then((r) => r.json()),
  fetch('./data/balance.json').then((r) => r.json()),
  fetch('./data/towerparts.json').then((r) => r.json()),
]);

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
document.getElementById('app').appendChild(app.canvas);

const layout = {
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
const partTex = bakeCatalogue(app.renderer, towerParts.parts, look);
const game = createGame({ world, look, level, balance, rigDefs, parts, textures, layout });
// ponytail: рестарт через перезавантаження — стан гри ніде не лишається, а
// збірка вся локальна (~200 мс). Якщо платформа схоче крутити рекламу між
// партіями, тут знадобиться скидання на місці, без втрати сесії SDK.
const hudUi = createHud({ hud, look, balance, game, onRestart: () => location.reload() });
const debug = new URLSearchParams(location.search).has('debug');
const tracePad = createTracePad({
  canvas: app.canvas, layer: pad, sheetLayer: padSheet, look,
  // З ?debug рамка тримає результат довго — інакше його не встигнути роздивитись.
  cfg: debug ? { holdMs: 8000 } : {},
});
const tools = createTools({
  app, canvas: app.canvas, world, layout, game, look, balance,
  hud: hudUi, blocked: () => tracePad.open,
});

const debugRect = new Graphics();
if (debug) world.addChild(debugRect);

function relayout() {
  const w = app.screen.width, h = app.screen.height;
  const { cols, rows } = look.core;

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
  game.rescale(layout.spriteScale);
  hudUi.resize(layout);
  tracePad.resize(layout);

  if (debug) {
    debugRect.clear()
      .rect(0, 0, cols, rows)
      .stroke({ width: 2 / cell, color: 0xff00ff, alpha: 0.45 });
  }
}

// Пауза, коли вкладку сховали (вимога Poki та CrazyGames), зупиняє ЛОГІКУ, а не
// рендер: якщо гасити тікер, у канвасі лишається мертвий кадр.
const state = { paused: false };
document.addEventListener('visibilitychange', () => {
  state.paused = document.hidden;
  if (document.hidden) sdk.gameplayStop();
  else if (game.state.phase === 'wave') sdk.gameplayStart();
});

const systems = []; // (dtMs) => void, отримують 0 на паузі

app.ticker.add(({ deltaMS }) => {
  const dt = state.paused ? 0 : deltaMS;
  paper.tick(deltaMS);
  boil.tick(dt);
  for (const s of systems) s(dt);
});

systems.push((dt) => game.update(dt));
systems.push(() => hudUi.tick());

// Платформам треба знати, коли гравець реально в бою: по цьому вони вирішують,
// коли можна показати рекламу. Стежимо за фазою, окремих викликів не розсипаємо.
let lastPhase = '';
systems.push(() => {
  const p = game.state.phase;
  if (p === lastPhase) return;
  lastPhase = p;
  if (p === 'wave') sdk.gameplayStart();
  else sdk.gameplayStop();
});

sdk.loadingFinished();

relayout();
app.renderer.on('resize', relayout);

// Тимчасові ручки, поки немає майстерні (крок 5).
// T — обвести деталь, Y — поставити зібрану башту на поле.
const newBuild = () => createBuild(towerParts.parts, {
  base: towerParts.base, combos: towerParts.combos, hitbox: towerParts.hitbox,
});

/** @param {Array<[string, number|null, string|null, number?]>} recipe деталь, індекс господаря, сокет, якість */
function demoTower(cx, cy, recipe) {
  const b = newBuild();
  const ids = [];
  for (const [id, host, socket, q] of recipe) {
    const at = host == null ? null : { node: ids[host], name: socket };
    ids.push(b.add(id, at, q ?? 1).id);
  }
  const rig = buildRig(b.rigDef(), partTex, towerParts.parts, look);
  rig.view.position.set(cx, cy);
  rig.setScale(layout.spriteScale);
  world.addChild(rig.view);
  systems.push((dt) => rig.update(dt));
  return { build: b, rig, stats: b.stats() };
}

// T гортає деталі по колу: натиснув — обвів — натиснув наступну.
const partIds = Object.keys(towerParts.parts);
let nextPart = 0;
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 't' && ev.key !== 'T') return;
  if (tracePad.open) return;
  const id = partIds[nextPart++ % partIds.length];
  console.log(`[обведи] ${id}`);
  tracePad.show(towerParts.parts[id].outline)
    .then((r) => console.log(`[${id}]`, r ? `${Math.round(r.quality * 100)}% → ×${(0.7 + 0.55 * r.quality).toFixed(2)}` : 'скасовано'));
});

window.__td = {
  app, look, layout, world, hud, hudUi, paper, state, systems, game, tools, textures, sdk,
  tracePad, towerParts, partTex, newBuild, demoTower,
};
