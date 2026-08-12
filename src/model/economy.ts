// Чорнило: воно ж валюта, воно ж індикатор у ручці.
//
// Окремим модулем, бо це єдина арифметика в грі, яку можна зламати тихо
// (списати двічі, повернути більше, ніж коштувало, піти в мінус), і єдина,
// яку видно з node — selfcheck ганяє саме її.

export interface WalletOpts {
  start: number;
  costs: Record<string, number>;
  refund?: number;
}

export interface Wallet {
  readonly ink: number;
  cost(kind: string): number;
  can(kind: string): boolean;
  spend(kind: string): boolean;
  refund(kind: string): number;
  pay(n: number): boolean;
  earn(n: number): number;
}

export function createWallet({ start, costs, refund = 0.5 }: WalletOpts): Wallet {
  let ink = Math.max(0, Math.round(start));

  const cost = (kind: string) => costs[kind] ?? 0;

  return {
    get ink() { return ink; },
    cost,
    can: (kind: string) => ink >= cost(kind),

    /** Списати. Повертає false і НЕ чіпає баланс, якщо не вистачає. */
    spend(kind) {
      const c = cost(kind);
      if (ink < c) return false;
      ink -= c;
      return true;
    },

    /** Ластик віддає половину — округляємо вниз, щоб стирання не було доходом. */
    refund(kind) {
      const back = Math.floor(cost(kind) * refund);
      ink += back;
      return back;
    },

    /** Списати довільну суму: ціна деталі живе в каталозі, а не в таблиці цін.
     *  Так само не чіпає баланс, якщо не вистачає. */
    pay(n) {
      const c = Math.max(0, Math.round(n));
      if (ink < c) return false;
      ink -= c;
      return true;
    },

    earn(n) {
      const got = Math.max(0, Math.round(n));
      ink += got;
      return got;
    },
  };
}
