/**
 * Apify entry point. Thin: parse input, build rows with the service layer, push and charge.
 * Pricing: one `rate-row` event per dataset row (see README "Pricing").
 */
import { Actor, log } from "apify";
import { InputError, parseInput } from "./input.js";
import { convertRow, latestRows, rangeRows, RateNotAvailableError, type ConversionRow, type RateRow } from "./service/rates.js";
import { createStore } from "./store.js";

export const CHARGE_EVENT = "rate-row";
const BATCH = 500;

await Actor.init();
try {
  const input = parseInput(await Actor.getInput());
  const store = createStore(input.fetchLatestFromCbk);
  const target = input.mode === "range" ? (input.endDate ?? store.today()) : (input.date ?? store.today());
  const live = await store.refreshFor(target);
  log.info(`CBK snapshot ${store.firstDate}..${store.snapshotLastDate}; live check: ${live}`);

  const rows: Iterable<RateRow | ConversionRow> =
    input.mode === "convert" ? [convertRow(input, store)] : input.mode === "range" ? rangeRows(input, store) : latestRows(input, store);

  const pushed = await pushCharged(rows, input.maxRows);
  await Actor.setStatusMessage(`${pushed.count} row(s) saved${pushed.stoppedBy ? `; stopped by ${pushed.stoppedBy}` : ""}`);
  await Actor.exit();
} catch (err) {
  if (err instanceof InputError || err instanceof RateNotAvailableError) {
    await Actor.fail(err.message); // nothing was pushed, so nothing was charged
  } else {
    throw err;
  }
}

/** Pushes rows in batches, charging one event per row, and stops at maxRows or the user's spending limit. */
async function pushCharged(rows: Iterable<object>, maxRows: number) {
  const payPerEvent = Actor.getChargingManager().getPricingInfo().isPayPerEvent;
  let count = 0;
  let batch: object[] = [];
  const flush = async (): Promise<boolean> => {
    if (batch.length === 0) return false;
    const result = await Actor.pushData(batch, CHARGE_EVENT);
    // Under pay-per-event the platform saves only rows the user's limit allows; otherwise every row is saved.
    count += payPerEvent ? Math.min(batch.length, result.chargedCount) : batch.length;
    batch = [];
    return result.eventChargeLimitReached;
  };
  for (const row of rows) {
    if (count + batch.length >= maxRows) {
      await flush();
      return { count, stoppedBy: "maxRows" as const };
    }
    batch.push(row);
    if (batch.length >= BATCH && (await flush())) return { count, stoppedBy: "spending limit" as const };
  }
  const limited = await flush();
  return { count, stoppedBy: limited ? ("spending limit" as const) : undefined };
}
