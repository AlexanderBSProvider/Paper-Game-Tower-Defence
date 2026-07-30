// Boot. Розкладка: світ живе у фіксованих проєктних одиницях (cols×rows клітинок),
// вписується в екран цілком (contain), а папір заливає весь екран — тому в
// ландшафті поле стоїть колонкою посередині, а по боках лишається зошит із полями.

import { Application, Container, Graphics } from '../lib/pixi.min.mjs';
import { createPaper } from './paper.js';

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
const world = new Container(); // чорнило в проєктних одиницях
const hud = new Container();   // нотатки на полях, екранні одиниці

app.stage.addChild(paper.base, world, paper.overlay, hud);

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
  for (const s of systems) s(dt);
});

window.__td = { app, look, layout, world, hud, paper, state, systems };
