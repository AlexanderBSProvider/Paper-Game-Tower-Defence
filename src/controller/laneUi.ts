// DOM поверх канваса для кампанії: банери, записка кінця сторінки, зошит зі
// сторінками й кнопка меню.
//
// Перо в грі літер не вміє, тому все, де є слова, — HTML у стилі тієї самої
// записки, що й полиця трафаретів. Модуль нічого не знає про гру: йому дають
// тексти й колбеки, він малює й кличе.

export interface Btn {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface EndCard {
  win: boolean;
  title: string;
  /** 0..3; не задано — зірок не показуємо (нескінченний режим) */
  stars?: number;
  lines: string[];
  buttons: Btn[];
}

export interface PageCard {
  n: number;
  title: string;
  stars: number;
  open: boolean;
}

export interface PagesView {
  pages: PageCard[];
  endless: { open: boolean; label: string };
  onPick(i: number): void;
  onEndless(): void;
  /** є — значить рівень на паузі й його можна продовжити */
  onResume?: () => void;
}

export interface LaneUi {
  banner(text: string, sub?: string, ms?: number): void;
  /** Прибрати банер одразу: відкрилась рамка обведення, і він їй заважає. */
  clearBanner(): void;
  showEnd(card: EndCard): void;
  showPages(v: PagesView): void;
  /** Сховати записку й зошит (банер живе своїм таймером). */
  hide(): void;
  readonly open: boolean;
  /** Кнопка меню в куті: видно лише в бою. */
  setMenu(visible: boolean): void;
  /**
   * Підказка-стрілка навчання: бульбашка біля точки екрана. Дотиків не
   * забирає — під нею треба тапати. null — сховати.
   */
  coach(c: { text: string; x: number; y: number; place: 'right' | 'above' | 'below'; maxW?: number } | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Зірки текстом: ★ заповнені й ☆ порожні, кольором рідкості не фарбуємо — це оцінка, не рідкість. */
function starsEl(n: number, of = 3, animate = false) {
  const wrap = el('div', 'stars');
  for (let i = 0; i < of; i++) {
    const s = el('span', i < n ? 'star on' : 'star', i < n ? '★' : '☆');
    if (animate && i < n) s.style.animationDelay = `${0.25 + i * 0.28}s`;
    wrap.append(s);
  }
  return wrap;
}

export function createLaneUi(onMenu: () => void): LaneUi {
  const root = el('div');
  root.id = 'lane-ui';
  const banner = el('div', 'banner');
  const veil = el('div', 'veil');
  veil.hidden = true;
  const coachEl = el('div', 'coach');
  coachEl.hidden = true;
  let coachText = '';
  const menu = el('button', 'menu-btn', '☰');
  menu.setAttribute('aria-label', 'Меню');
  menu.hidden = true;
  root.append(banner, coachEl, veil, menu);
  document.body.append(root);

  // Дотик по записці не має долітати до канваса під нею.
  veil.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.addEventListener('click', () => onMenu());

  let bannerTimer = 0;
  let primary: (() => void) | null = null;
  window.addEventListener('keydown', (e) => {
    if (veil.hidden) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); primary?.(); }
  });

  function buttons(list: Btn[]) {
    const row = el('div', 'btns');
    primary = list.find((b) => b.primary)?.onClick ?? list[0]?.onClick ?? null;
    for (const b of list) {
      const btn = el('button', b.primary ? 'btn primary' : 'btn', b.label);
      btn.addEventListener('click', () => b.onClick());
      row.append(btn);
    }
    return row;
  }

  function showNote(note: HTMLElement) {
    veil.replaceChildren(note);
    veil.hidden = false;
  }

  return {
    banner(text, sub, ms = 1600) {
      banner.replaceChildren(el('div', 'b-main', text));
      if (sub) banner.append(el('div', 'b-sub', sub));
      banner.classList.remove('show');
      // Перезапуск анімації: класу треба зникнути на кадр.
      void banner.offsetWidth;
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => banner.classList.remove('show'), ms);
    },

    clearBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('show');
    },

    showEnd(card) {
      const note = el('div', `note end ${card.win ? 'win' : 'lose'}`);
      note.append(el('h1', '', card.title));
      if (card.stars != null) note.append(starsEl(card.stars, 3, true));
      for (const line of card.lines) note.append(el('p', '', line));
      note.append(buttons(card.buttons));
      showNote(note);
    },

    showPages(v) {
      const note = el('div', 'note pages');
      const head = el('div', 'pages-head');
      head.append(el('h1', '', 'Зошит'));
      note.append(head);
      const grid = el('div', 'grid');
      v.pages.forEach((p, i) => {
        const card = el('button', p.open ? 'page' : 'page locked');
        card.append(el('div', 'num', String(p.n)), el('div', 'ttl', p.open ? p.title : '🔒'));
        card.append(starsEl(p.open ? p.stars : 0));
        if (p.open) card.addEventListener('click', () => v.onPick(i));
        else card.disabled = true;
        grid.append(card);
      });
      const inf = el('button', v.endless.open ? 'page endless' : 'page endless locked');
      inf.append(el('div', 'num', '∞'), el('div', 'ttl', v.endless.label));
      if (v.endless.open) inf.addEventListener('click', () => v.onEndless());
      else inf.disabled = true;
      grid.append(inf);
      note.append(grid);
      if (v.onResume) note.append(buttons([{ label: 'Продовжити ▶', onClick: v.onResume, primary: true }]));
      else primary = null;
      showNote(note);
    },

    hide() {
      veil.hidden = true;
      veil.replaceChildren();
      primary = null;
    },

    get open() { return !veil.hidden; },

    setMenu(visible) { menu.hidden = !visible; },

    coach(c) {
      if (!c) { coachEl.hidden = true; coachText = ''; return; }
      if (c.text !== coachText) { coachEl.textContent = c.text; coachText = c.text; }
      coachEl.className = `coach ${c.place}`;
      coachEl.style.maxWidth = c.maxW ? `${Math.round(c.maxW)}px` : '';
      coachEl.style.left = `${Math.round(c.x)}px`;
      coachEl.style.top = `${Math.round(c.y)}px`;
      coachEl.hidden = false;
    },
  };
}
