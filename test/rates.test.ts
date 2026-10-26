import { describe, expect, it } from "vitest";
import { parseInput, InputError } from "../src/input.js";
import { convertRow, latestRows, rangeRows, RateNotAvailableError } from "../src/service/rates.js";
import { storeAt } from "./helpers.js";

const NOW = "2026-10-16T09:00:00Z"; // Friday 12:00 EAT, after the snapshot's last day

describe("input", () => {
  it("defaults to latest mode for all currencies with a 10k row cap", () => {
    expect(parseInput({})).toMatchObject({ mode: "latest", maxRows: 10_000, fetchLatestFromCbk: true });
  });
  it("lists every problem in one message", () => {
    expect(() => parseInput({ mode: "convert" })).toThrow(/amount.*fromCurrency.*toCurrency/);
    expect(() => parseInput({ mode: "range" })).toThrow(InputError);
    expect(() => parseInput({ date: "2026-02-30" })).toThrow(/real date/);
    expect(() => parseInput({ currencies: ["XYZ"] })).toThrow(InputError);
    expect(() => parseInput({ mode: "range", startDate: "2026-10-12", endDate: "2026-10-01" })).toThrow(/on or after/);
  });
});

describe("latest mode", () => {
  it("returns the published rate with buy/sell where CBK published them", () => {
    const [usd] = [...latestRows(parseInput({ date: "2026-10-08", currencies: ["USD"] }), storeAt(NOW))];
    expect(usd).toMatchObject({ date: "2026-10-08", mean: 129.0, buy: 128.9, sell: 129.1, isFallback: false, kesPerUnit: 129 });
  });
  it("falls back over a weekend and says why", () => {
    const [usd] = [...latestRows(parseInput({ date: "2026-10-11", currencies: ["USD"] }), storeAt(NOW))];
    expect(usd).toMatchObject({ date: "2026-10-09", requestedDate: "2026-10-11", isFallback: true });
    expect(usd!.fallbackReason).toMatch(/Sunday/);
  });
  it("applies CBK's JPY-per-100 convention", () => {
    const [jpy] = [...latestRows(parseInput({ date: "2026-10-15", currencies: ["JPY"] }), storeAt(NOW))];
    expect(jpy).toMatchObject({ quote: "KES per 100 JPY", mean: 85.5, kesPerUnit: 0.855 });
  });
  it("refuses future dates and dates before coverage", () => {
    expect(() => [...latestRows(parseInput({ date: "2026-10-17" }), storeAt(NOW))]).toThrow(RateNotAvailableError);
    expect(() => [...latestRows(parseInput({ date: "2026-10-01" }), storeAt(NOW))]).toThrow(/coverage starts/);
  });
  it("skips currencies with no data instead of inventing them", () => {
    expect(() => [...latestRows(parseInput({ date: "2026-10-15", currencies: ["EUR"] }), storeAt(NOW))]).toThrow(/no CBK rate for EUR/);
  });
});

describe("range mode", () => {
  it("returns only published business days, oldest first", () => {
    const rows = [...rangeRows(parseInput({ mode: "range", startDate: "2026-10-09", endDate: "2026-10-15", currencies: ["USD"] }), storeAt(NOW))];
    expect(rows.map((r) => r.date)).toEqual(["2026-10-09", "2026-10-12", "2026-10-15"]);
    expect(rows.every((r) => !r.isFallback)).toBe(true);
  });
  it("covers every requested currency", () => {
    const rows = [...rangeRows(parseInput({ mode: "range", startDate: "2026-10-08", currencies: ["USD", "JPY"] }), storeAt(NOW))];
    expect(rows).toHaveLength(8);
  });
});

describe("convert mode", () => {
  it("converts through KES with mean rates", () => {
    const row = convertRow(parseInput({ mode: "convert", amount: 100, fromCurrency: "USD", toCurrency: "KES", date: "2026-10-15" }), storeAt(NOW));
    expect(row).toMatchObject({ result: 12981, fromRateDate: "2026-10-15", toRateDate: null, isFallback: false });
  });
  it("handles cross rates", () => {
    const row = convertRow(parseInput({ mode: "convert", amount: 1000, fromCurrency: "JPY", toCurrency: "USD", date: "2026-10-15" }), storeAt(NOW));
    expect(row.result).toBeCloseTo((1000 * 0.855) / 129.81, 6);
  });
});
