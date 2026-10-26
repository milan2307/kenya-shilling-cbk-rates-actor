/**
 * Regression for run 7t5zZ0x5hvmeTM7s7 (Apify, 2026-10-26 ~09:10 EAT): input {} must give one row per
 * currency (21), on one consistent date, even while CBK has only part of today's table online,
 * and regardless of the machine's timezone (Apify runs in UTC).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, type CurrencyCode } from "../src/fx/currencies.js";
import { DEFAULT_STORE_OPTIONS, RateStore } from "../src/fx/rate-store.js";
import type { CbkRate } from "../src/fx/cbk-source.js";
import type { Snapshot } from "../src/fx/snapshot.js";
import { parseInput } from "../src/input.js";
import { convertRow, latestRows, rangeRows } from "../src/service/rates.js";

const day = (date: string, base: number): [string, number[]] => [date, CURRENCY_CODES.map((_, i) => base + i)];
const snapshot: Snapshot = {
  format: 1,
  source: "test",
  generated_at: "2026-10-24T00:00:00.000Z",
  first_date: "2026-10-21",
  last_date: "2026-10-23",
  currencies: [...CURRENCY_CODES],
  days: [day("2026-10-21", 100), day("2026-10-22", 100.1), day("2026-10-23", 100.2)],
  withheld: [],
};

const liveRows = (date: string, codes: readonly CurrencyCode[]): CbkRate[] => codes.map((c) => ({ date, currency: c, mean: 100.3 + CURRENCY_CODES.indexOf(c) }));

async function storeWith(tail: CbkRate[], nowIso = "2026-10-26T06:10:00Z") {
  const store = new RateStore(snapshot, async () => tail, { ...DEFAULT_STORE_OPTIONS, now: () => new Date(nowIso) });
  await store.refreshFor("2026-10-26");
  return store;
}

describe("latest with {} while CBK's newest day is partial", () => {
  it("returns all 21 currencies on the last complete day, each flagged as a fallback with the reason", async () => {
    const store = await storeWith(liveRows("2026-10-26", ["USD", "EUR", "GBP"]));
    const rows = [...latestRows(parseInput({}), store)];
    expect(rows).toHaveLength(21);
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set(["2026-10-23"]));
    expect(rows.every((r) => r.isFallback && /3 of 21 currencies/.test(r.fallbackReason ?? ""))).toBe(true);
  });

  it("uses the new day once CBK has published all of it", async () => {
    const store = await storeWith(liveRows("2026-10-26", CURRENCY_CODES));
    const rows = [...latestRows(parseInput({}), store)];
    expect(rows).toHaveLength(21);
    expect(rows.every((r) => r.date === "2026-10-26" && !r.isFallback && r.origin === "cbk_live")).toBe(true);
  });

  it("range never includes the partial day, so nobody is charged for it", async () => {
    const store = await storeWith(liveRows("2026-10-26", ["USD", "EUR", "GBP"]));
    const rows = [...rangeRows(parseInput({ mode: "range", startDate: "2026-10-23" }), store)];
    expect(rows).toHaveLength(21);
    expect(rows.some((r) => r.date === "2026-10-26")).toBe(false);
  });

  it("convert uses the same complete day", async () => {
    const store = await storeWith(liveRows("2026-10-26", ["USD"]));
    const row = convertRow(parseInput({ mode: "convert", amount: 10, fromCurrency: "USD", toCurrency: "KES" }), store);
    expect(row.fromRateDate).toBe("2026-10-23");
  });

  it("'today' is Nairobi's date even on a UTC clock just after EAT midnight", async () => {
    const store = await storeWith([], "2026-10-25T21:30:00Z"); // 00:30 EAT Monday 26 Oct
    expect(store.today()).toBe("2026-10-26");
    expect([...latestRows(parseInput({}), store)]).toHaveLength(21);
  });
});

describe("input schema (Console form)", () => {
  const schema = JSON.parse(readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"));
  it("does not prefill currencies, so the Console's default run returns all 21", () => {
    expect(schema.properties.currencies.prefill).toBeUndefined();
    expect(schema.properties.currencies.default).toBeUndefined();
  });
  it("an empty currencies array from the form means all 21", async () => {
    const store = await storeWith([]);
    expect([...latestRows(parseInput({ currencies: [] }), store)]).toHaveLength(21);
  });
});

describe("a past live day with fewer currencies is final", () => {
  it("is served as published once it is no longer today", async () => {
    const store = await storeWith(liveRows("2026-10-26", ["USD", "EUR", "GBP"]), "2026-10-27T06:00:00Z"); // Tuesday
    const rows = [...latestRows(parseInput({ date: "2026-10-26", currencies: ["USD", "AUD"] }), store)];
    expect(rows.map((r) => [r.currency, r.date])).toEqual([["USD", "2026-10-26"], ["AUD", "2026-10-23"]]);
  });
});
