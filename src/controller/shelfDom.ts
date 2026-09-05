// Полиця трафаретів — DOM поверх канваса.
//
// Перо в грі літер не вміє, а трафарет без підпису не читається: «булава чи
// кактус?». Тому картки полиці — HTML: ескіз контуру як SVG, назва, підказка
// одним рядком, ціна. Стиль — той самий аркуш, що й записка-інструкція.
//
// Полиця нічого не знає про гру: їй дають список карток і колбек на тап.
// Ставиться ліворуч від рамки обведення в екранних px; канвас під нею
// дотику не бачить, бо ціль події — сама картка.

import type { Vec2 } from '../types.js';

export interface ShelfCard {
  id: string;
  title: string;
  hint: string;
  cost: number;
  outline: Vec2[][];
  /** ще не відкрито: видно, але не обрати */
  locked?: boolean;
  /** на якій хвилі відкриється (1 = перша); показується на замкнених */
  unlockWave?: number;
  /** не по кишені: ціна закреслена, не обрати */
  affordable: boolean;
  /** група для розділювача між сусідніми картками різних груп */
  group?: string;
}

export interface ShelfShow {
  cards: ShelfCard[];
  picked: string;
  /** заголовок полиці: яка хвиля зараз і що відкриється наступним */
  header?: string;
  /** @returns чи прийнято вибір; полиця сама підсвітить нову картку */
  onPick(id: string): boolean;
}

export interface Shelf {
  show(o: ShelfShow): void;
  /** Куди поставити, в екранних px. */
  place(x: number, y: number, w: number, h: number): void;
  hide(): void;
  readonly open: boolean;
}

/** SVG-ескіз контуру: ті самі штрихи 0..1, що йдуть у рамку. */
function sketch(outline: Vec2[][]): string {
  const lines = outline
    .map((s) => `<polyline points="${s.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`).join(' ')}"/>`)
    .join('');
  return `<svg viewBox="-6 -6 112 112" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${lines}</svg>`;
}

export function createShelf(): Shelf {
  const root = document.createElement('div');
  root.id = 'shelf';
  root.hidden = true;
  document.body.appendChild(root);

  let current: ShelfShow | null = null;

  function render() {
    root.replaceChildren();
    if (!current) return;
    if (current.header) {
      const h = document.createElement('div');
      h.className = 'shelf-head';
      h.textContent = current.header;
      root.appendChild(h);
    }
    let prevGroup: string | undefined;
    for (const c of current.cards) {
      if (prevGroup !== undefined && c.group !== prevGroup) {
        const hr = document.createElement('div');
        hr.className = 'shelf-gap';
        root.appendChild(hr);
      }
      prevGroup = c.group;

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'card'
        + (c.id === current.picked ? ' picked' : '')
        + (c.locked ? ' locked' : '')
        + (!c.affordable ? ' poor' : '');
      const when = c.locked
        ? (c.unlockWave ? `🔒 відкриється на хвилі ${c.unlockWave}` : '🔒 ще не відкрито')
        : c.hint;
      el.innerHTML = `${sketch(c.outline)}<div class="txt"><div class="title">${c.title}</div>`
        + `<div class="hint${c.locked ? ' when' : ''}">${when}</div></div>`
        + `<div class="cost">${c.cost}</div>`;
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!current) return;
        if (current.onPick(c.id)) { current.picked = c.id; render(); }
      });
      root.appendChild(el);
    }
  }

  return {
    show(o) { current = o; root.hidden = false; render(); },
    place(x, y, w, h) {
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      root.style.width = `${w}px`;
      root.style.maxHeight = `${h}px`;
    },
    hide() { current = null; root.hidden = true; root.replaceChildren(); },
    get open() { return !root.hidden; },
  };
}
