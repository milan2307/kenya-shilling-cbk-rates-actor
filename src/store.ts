/** Wiring: bundled CBK snapshot (data/) plus an optional live tail from CBK's current table. */
import { readFileSync } from "node:fs";
import { CBK_TABLES, fetchCbkRates } from "./fx/cbk-source.js";
import { DEFAULT_STORE_OPTIONS, RateStore, type TailSource } from "./fx/rate-store.js";
import type { Snapshot } from "./fx/snapshot.js";

export const cbkTail: TailSource = async (from, to) =>
  (await fetchCbkRates({ tableId: CBK_TABLES.currentMeanOnly, from, to, maxRows: 5000, timeoutMs: 20_000, maxBytes: 5_000_000 })).rates;

/** Works from src/ (tsx) and from dist/src/ (compiled). */
export function loadSnapshot(): Snapshot {
  for (const rel of ["../data/cbk-kes-rates.json", "../../data/cbk-kes-rates.json"]) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Snapshot;
    } catch {
      // try the next location
    }
  }
  throw new Error("CBK snapshot data/cbk-kes-rates.json not found");
}

export function createStore(fetchLatestFromCbk: boolean, snapshot: Snapshot = loadSnapshot()): RateStore {
  return new RateStore(snapshot, fetchLatestFromCbk ? cbkTail : undefined, { ...DEFAULT_STORE_OPTIONS, maxTailDays: 120 });
}
