// Шим Poki / CrazyGames.
//
// Тег SDK підключає index.html; тут — один інтерфейс на обидві платформи, який
// мовчки нічого не робить, якщо жодного SDK на сторінці немає. Саме це дає
// нульові зовнішні запити при локальному запуску й на GitHub Pages, і саме це
// вимагають обидві платформи: гра не має падати, коли їхній скрипт не завантажився.
//
// Обидві хочуть одного: сказати їм, коли гравець реально грає (gameplayStart) і
// коли ні (gameplayStop) — по цьому вони вирішують, коли можна крутити рекламу.

/** Спільний інтерфейс платформи. Три реалізації: poki, crazygames і порожня. */
export interface Sdk {
  name: 'poki' | 'crazygames' | 'none';
  init(): Promise<unknown> | void;
  loadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Рекламу просимо лише між хвилями — посеред бою її не буває. */
  commercialBreak(): Promise<unknown> | void;
}

const noop = () => {};

/** Ковтає винятки SDK: гра не має падати через чужий скрипт. Тому й повертає
 *  `R | undefined` — при винятку значення немає. */
const quiet = <A extends unknown[], R>(fn: (...a: A) => R) =>
  (...a: A): R | undefined => {
    try { return fn(...a); } catch (e) { console.warn('[sdk]', e); }
  };

export function createSdk(): Sdk {
  const poki = typeof window.PokiSDK !== 'undefined' ? window.PokiSDK : null;
  const crazy = window.CrazyGames?.SDK ?? null;

  if (poki) {
    return {
      name: 'poki',
      init: quiet(() => poki.init()),
      loadingFinished: quiet(() => poki.gameLoadingFinished()),
      gameplayStart: quiet(() => poki.gameplayStart()),
      gameplayStop: quiet(() => poki.gameplayStop()),
      // Рекламу просимо лише між хвилями — посеред бою її не буває.
      commercialBreak: quiet(() => poki.commercialBreak()),
    };
  }

  if (crazy) {
    return {
      name: 'crazygames',
      init: quiet(() => crazy.init?.()),
      loadingFinished: quiet(() => crazy.game.sdkGameLoadingStop?.()),
      gameplayStart: quiet(() => crazy.game.gameplayStart()),
      gameplayStop: quiet(() => crazy.game.gameplayStop()),
      commercialBreak: quiet(() => crazy.ad.requestAd('midgame')),
    };
  }

  return {
    name: 'none',
    init: async () => {},
    loadingFinished: noop,
    gameplayStart: noop,
    gameplayStop: noop,
    commercialBreak: async () => {},
  };
}
