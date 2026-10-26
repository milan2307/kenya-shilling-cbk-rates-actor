import { RateStore, DEFAULT_STORE_OPTIONS } from "../src/fx/rate-store.js";
import type { Snapshot } from "../src/fx/snapshot.js";
import { CURRENCY_CODES } from "../src/fx/currencies.js";

/** Tiny snapshot: USD and JPY on three business days around a weekend, plus a mean-only day after 2024. */
export function tinySnapshot(): Snapshot {
  const row = (usd: number | [number, number, number], jpy: number) =>
    CURRENCY_CODES.map((c) => (c === "USD" ? usd : c === "JPY" ? jpy : 0));
  return {
    format: 1,
    source: "test",
    generated_at: "2026-10-16T00:00:00.000Z",
    first_date: "2026-10-08",
    last_date: "2026-10-15",
    currencies: [...CURRENCY_CODES],
    days: [
      ["2026-10-08", row([129.0, 128.9, 129.1], 85.0)],
      ["2026-10-09", row(129.2, 85.2)],
      ["2026-10-12", row(129.4, 85.4)],
      ["2026-10-15", row(129.81, 85.5)],
    ],
    withheld: [],
  } as Snapshot;
}

export const storeAt = (nowIso: string, snapshot = tinySnapshot()) =>
  new RateStore(snapshot, undefined, { ...DEFAULT_STORE_OPTIONS, now: () => new Date(nowIso) });
