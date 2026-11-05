// Дев-режим: усі сторінки й нескінченний режим відкриті, щоб перевіряти будь-що
// без проходження кампанії.
//
// Вмикається `?dev` в адресі й запам'ятовується в браузері — інакше губився б
// при переході з шоуруму чи «Далі ▶». `?dev=0` вимикає. У реліз-білді цього не
// буде (план релізу, етап 1: чистий білд без дебагу).

const KEY = 'paper-td:dev';

export function devMode(): boolean {
  const q = new URLSearchParams(location.search);
  const asked = q.has('dev') ? q.get('dev') !== '0' : null;
  try {
    if (asked === true) localStorage.setItem(KEY, '1');
    if (asked === false) localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return asked === true;
  }
}
