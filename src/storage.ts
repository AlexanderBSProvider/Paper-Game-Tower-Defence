// Збереження прогресу. localStorage у try/catch: в інкогніто й у деяких
// iframe платформ він кидає виняток, а гра від цього падати не має (вимога
// Poki). Не вдалося записати — граємо далі, просто без збереження.

const KEY = 'paper-td:progress:v1';

export function loadRaw(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function saveRaw(value: string): boolean {
  try { localStorage.setItem(KEY, value); return true; } catch { return false; }
}
