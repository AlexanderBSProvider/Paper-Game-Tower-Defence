// Шим Poki / CrazyGames.
//
// Тег SDK підключає index.html; тут — один інтерфейс на обидві платформи, який
// мовчки нічого не робить, якщо жодного SDK на сторінці немає. Саме це дає
// нульові зовнішні запити при локальному запуску й на GitHub Pages, і саме це
// вимагають обидві платформи: гра не має падати, коли їхній скрипт не завантажився.
//
// Обидві хочуть одного: сказати їм, коли гравець реально грає (gameplayStart) і
// коли ні (gameplayStop) — по цьому вони вирішують, коли можна крутити рекламу.

const noop = () => {};
const quiet = (fn) => (...a) => { try { return fn(...a); } catch (e) { console.warn('[sdk]', e); } };

export function createSdk() {
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
      init: quiet(() => crazy.init()),
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
