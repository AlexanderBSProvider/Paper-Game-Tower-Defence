// Boot. Розкладка: світ живе у фіксованих проєктних одиницях (cols×rows клітинок),
// вписується в екран цілком (contain), а папір заливає весь екран — тому в
// ландшафті поле стоїть колонкою посередині, а по боках лишається зошит із полями.

import { Application, Graphics } from '../lib/pixi.min.mjs';
import { createPaper } from './paper.js';
import { createBoil, inkContainer, inkLayer, penStroke, penCircle, penRect, hatch, scribble } from './ink.js';

const look = await (await fetch('./data/look.json')).json();

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  background: '#1b1917',
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
});
document.getElementById('app').appendChild(app.canvas);

const layout = { w: 0, h: 0, scale: 1, cell: look.grid.cell, ox: 0, oy: 0 };
const paper = createPaper(app, look);

// Boil тремтить лише чорнилом: якщо накрити ним папір — попливе клітинка.
const boil = createBoil(look);

const world = inkContainer([boil.filter]); // чорнило в проєктних одиницях
const hud = inkContainer();                // нотатки на полях, екранні одиниці

app.stage.addChild(paper.base, world, paper.overlay, hud, boil.sprite);

const debug = new URLSearchParams(location.search).has('debug');
const debugRect = new Graphics();
if (debug) world.addChild(debugRect);

function relayout() {
  const w = app.screen.width, h = app.screen.height;
  const worldW = look.world.cols * look.grid.cell;
  const worldH = look.world.rows * look.grid.cell;

  layout.w = w;
  layout.h = h;
  layout.scale = Math.min(w / worldW, h / worldH);
  layout.cell = look.grid.cell * layout.scale;
  layout.ox = Math.round((w - worldW * layout.scale) / 2);
  layout.oy = Math.round((h - worldH * layout.scale) / 2);

  world.scale.set(layout.scale);
  world.position.set(layout.ox, layout.oy);
  paper.resize(layout);
  boil.resize(w, h);

  if (debug) {
    debugRect.clear()
      .rect(0, 0, worldW, worldH)
      .stroke({ width: 2 / layout.scale, color: 0xff00ff, alpha: 0.5 });
  }
}

relayout();
app.renderer.on('resize', relayout);

// Пауза, коли вкладку сховали (вимога Poki та CrazyGames), зупиняє ЛОГІКУ, а не
// рендер: якщо гасити тікер, у канвасі лишається мертвий кадр.
const state = { paused: false };
document.addEventListener('visibilitychange', () => { state.paused = document.hidden; });

const systems = []; // (dtMs) => void, отримують 0 на паузі

app.ticker.add(({ deltaMS }) => {
  const dt = state.paused ? 0 : deltaMS;
  paper.tick(deltaMS);
  boil.tick(dt);
  for (const s of systems) s(dt);
});

// ?ink=1 — стенд для примітивів пера (крок 2). Піде геть, коли з'явиться procart.
// ?ink=2 — той самий стенд, збільшений, щоб розглядати лінію зблизька.
const inkParam = new URLSearchParams(location.search).get('ink');
if (inkParam) {
  const g = inkLayer();
  g.scale.set(Number(inkParam) || 1);
  const pen = look.pens.blue;
  penRect(g, 40, 60, 130, 90, { color: pen, width: 2.4 });
  penCircle(g, 265, 105, 52, { color: pen, width: 2.4 });
  hatch(g, 40, 190, 130, 90, { color: pen, gap: 7 });
  penCircle(g, 265, 235, 52, { color: pen, width: 2.4 });
  hatch(g, 213, 183, 104, 104, { color: pen, gap: 6, angle: -0.5 });
  penStroke(g, [[40, 330], [110, 300], [180, 360], [250, 305], [330, 345]], { color: pen, width: 3 });
  penStroke(g, [[40, 400], [330, 400]], { color: look.pens.red, width: 2 });
  penRect(g, 40, 430, 120, 80, { color: pen, width: 2.4 });
  scribble(g, 40, 430, 120, 80, { color: look.pens.red });
  world.addChild(g);
}

window.__td = { app, look, layout, world, hud, paper, state, systems };
