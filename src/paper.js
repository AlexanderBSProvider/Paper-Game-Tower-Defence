// Паперовий шар: аркуш у клітинку. Усе намальовано в canvas2d і віддане Pixi
// як текстури — статика, тому перемальовується лише на ресайзі.
//
// Головна ідея: клітинка НЕ ідеальна. Кожна лінія має власний зсув, натиск,
// хвилю і подекуди розрив — саме це відрізняє зошит від CSS-сітки.

import { Container, Sprite, Texture, TilingSprite } from '../lib/pixi.min.mjs';

const rnd = (a, b) => a + Math.random() * (b - a);

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')];
}

// --- аркуш: тон, плями, тінь від згину, загнутий кут -----------------------
function paintSheet(w, h, dpr, look) {
  const p = look.paper;
  const [c, g] = canvas2d(w * dpr, h * dpr);
  const W = c.width, H = c.height;

  g.fillStyle = p.base;
  g.fillRect(0, 0, W, H);

  // Плями й нерівномірність тону: кілька м'яких радіальних пятен на multiply.
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < p.blotches; i++) {
    const x = rnd(0, W), y = rnd(0, H), r = rnd(0.15, 0.5) * Math.max(W, H);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(150,135,105,${p.blotchAlpha})`);
    grd.addColorStop(1, 'rgba(150,135,105,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }

  // Тінь від згину сторінки — вузький градієнт від краю.
  const side = p.spineSide === 'right' ? 'right' : 'left';
  const sw = W * 0.09;
  const sg = side === 'left'
    ? g.createLinearGradient(0, 0, sw, 0)
    : g.createLinearGradient(W, 0, W - sw, 0);
  sg.addColorStop(0, `rgba(60,50,35,${p.spineAlpha})`);
  sg.addColorStop(0.45, `rgba(60,50,35,${p.spineAlpha * 0.25})`);
  sg.addColorStop(1, 'rgba(60,50,35,0)');
  g.fillStyle = sg;
  g.fillRect(side === 'left' ? 0 : W - sw, 0, sw, H);
  g.globalCompositeOperation = 'source-over';

  return c;
}

// Загнутий правий нижній кут — малюємо поверх усього, разом із тінню.
function paintCurl(w, h, dpr, look) {
  const [c, g] = canvas2d(w * dpr, h * dpr);
  if (!look.paper.curl) return c;
  const W = c.width, H = c.height;
  const s = Math.min(W, H) * 0.11;

  // тінь під загином
  g.save();
  if (g.filter !== undefined) g.filter = `blur(${Math.max(1, 3 * dpr)}px)`;
  g.fillStyle = 'rgba(50,42,30,0.30)';
  g.beginPath();
  g.moveTo(W - s * 1.05, H);
  g.lineTo(W, H - s * 1.05);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  g.restore();

  // сам відгорнутий трикутник — світліша зворотна сторона аркуша
  const grd = g.createLinearGradient(W - s, H, W, H - s);
  grd.addColorStop(0, '#e6dfcd');
  grd.addColorStop(1, '#fbf8ef');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(W - s, H);
  g.lineTo(W, H - s);
  g.lineTo(W, H);
  g.closePath();
  g.fill();

  // лінія згину
  g.strokeStyle = 'rgba(120,105,80,0.45)';
  g.lineWidth = Math.max(1, dpr);
  g.beginPath();
  g.moveTo(W - s, H);
  g.lineTo(W, H - s);
  g.stroke();

  return c;
}

// --- клітинка --------------------------------------------------------------
// Друкована сітка майже рівна: власний зсув і натиск на лінію, повільна хвиля
// вздовж неї, місцями бліді ділянки (нерівномірний прокат друку) і дуже рідко
// справжній розрив. Рукотворність дає чорнило, а не папір — тут стримано.
function penLine(g, base, horizontal, len, look, dpr) {
  const cfg = look.grid;
  const wob = cfg.wobble * dpr;
  const phase = rnd(0, Math.PI * 2);
  const freq = rnd(0.003, 0.008) / dpr;
  const drift = rnd(-wob, wob);
  const step = 18 * dpr;
  const alpha = cfg.alpha * rnd(0.86, 1.1);

  g.lineWidth = cfg.width * dpr * rnd(0.85, 1.15);

  const at = (t) => {
    const off = drift + Math.sin(phase + t * freq) * wob;
    return horizontal ? [t, base + off] : [base + off, t];
  };

  for (let t = 0; t < len; t += step) {
    if (Math.random() < cfg.dropout) continue; // «недодрукований» шматок
    const [x0, y0] = at(t);
    const [x1, y1] = at(Math.min(t + step, len));
    g.globalAlpha = alpha * (1 - Math.random() * cfg.fade);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
}

function paintGrid(w, h, dpr, layout, look) {
  const [c, g] = canvas2d(w * dpr, h * dpr);
  const W = c.width, H = c.height;
  const cell = layout.cell * dpr;
  const ox = layout.ox * dpr, oy = layout.oy * dpr;

  g.strokeStyle = look.grid.color;
  g.lineCap = 'round';

  // Вертикальні й горизонтальні лінії вирівняні по світовій сітці, але
  // покривають увесь екран — папір не закінчується там, де закінчується поле.
  const k0 = Math.floor(-ox / cell), k1 = Math.ceil((W - ox) / cell);
  for (let k = k0; k <= k1; k++) penLine(g, ox + k * cell, false, H, look, dpr);

  const m0 = Math.floor(-oy / cell), m1 = Math.ceil((H - oy) / cell);
  for (let m = m0; m <= m1; m++) penLine(g, oy + m * cell, true, W, look, dpr);

  // Червона лінія полів — там житиме HUD.
  if (look.margin.enabled) {
    g.strokeStyle = look.margin.color;
    const mx = ox + look.margin.cols * cell;
    for (const dx of [0, 2.5 * dpr]) {
      g.globalAlpha = look.margin.alpha * rnd(0.8, 1.05);
      g.lineWidth = 1.1 * dpr;
      g.beginPath();
      const phase = rnd(0, 7), freq = rnd(0.003, 0.008) / dpr;
      for (let y = 0; y <= H; y += 24 * dpr) {
        const x = mx + dx + Math.sin(phase + y * freq) * 0.7 * dpr;
        y === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  g.globalAlpha = 1;
  return c;
}

// --- зерно й віньєтка (лежать ПОВЕРХ чорнила) -----------------------------
function grainTexture(dpr) {
  const size = 128;
  const [c, g] = canvas2d(size, size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 255 - (Math.random() * 255 | 0);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 - v * 0.35;
    img.data[i + 3] = v < 40 ? 255 : 0; // рідкі темні крупинки
  }
  g.putImageData(img, 0, 0);
  return Texture.from(c);
}

function paintVignette(w, h, dpr, strength) {
  const [c, g] = canvas2d(w * dpr, h * dpr);
  const W = c.width, H = c.height;
  const grd = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.78);
  grd.addColorStop(0, 'rgba(90,72,45,0)');
  grd.addColorStop(1, `rgba(90,72,45,${strength})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  return c;
}

/**
 * base    — папір + клітинка (під чорнилом)
 * overlay — загин, зерно, віньєтка (над чорнилом)
 */
export function createPaper(app, look) {
  const base = new Container();
  const overlay = new Container();

  const sheet = new Sprite();
  const grid = new Sprite();
  base.addChild(sheet, grid);

  const curl = new Sprite();
  const grain = new TilingSprite({ texture: grainTexture(1), width: 1, height: 1 });
  grain.blendMode = 'multiply';
  grain.alpha = look.paper.grainAlpha;
  const vignette = new Sprite();
  vignette.blendMode = 'multiply';
  overlay.addChild(curl, grain, vignette);

  const swap = (sprite, canvas, w, h) => {
    const old = sprite.texture;
    sprite.texture = Texture.from(canvas);
    sprite.setSize(w, h);
    if (old && old !== Texture.EMPTY) old.destroy(true);
  };

  let grainT = 0;

  return {
    base,
    overlay,
    resize(layout) {
      const { w, h } = layout;
      const dpr = app.renderer.resolution;
      swap(sheet, paintSheet(w, h, dpr, look), w, h);
      swap(grid, paintGrid(w, h, dpr, layout, look), w, h);
      swap(curl, paintCurl(w, h, dpr, look), w, h);
      swap(vignette, paintVignette(w, h, dpr, look.vignette), w, h);
      grain.setSize(w, h);
    },
    // Зерно «дихає»: перекидаємо тайл на 12 fps, а не щокадру — папір має
    // жити дискретно, як у мальованому мультику.
    tick(dtMs) {
      grainT += dtMs;
      const period = 1000 / look.paper.grainFps;
      if (grainT >= period) {
        grainT %= period;
        grain.tilePosition.set(Math.random() * 128, Math.random() * 128);
      }
    },
  };
}
