/**
 * Use cases behind the three modes. Pure over the RateStore: no Apify, no HTTP.
 * Each function yields dataset rows; main.ts decides how many to push and charge.
 */
import { currencyInfo, CURRENCY_CODES, kesPerUnit, quoteText, type CurrencyCode } from "../fx/currencies.js";
import { addDays, weekdayName } from "../fx/dates.js";
import type { RateStore, StoredRate } from "../fx/rate-store.js";
import type { ActorInput } from "../input.js";

/** A rate older than this (relative to the requested date) is not served. Same rule as the live x402 FX tool. */
export const MAX_FALLBACK_DAYS = 10;
export const BUY_SELL_LAST_DATE = "2024-01-04";
export const SOURCE_URL = "https://www.centralbank.go.ke/rates/forex-exchange-rates/";

export interface RateRow {
  type: "rate";
  date: string;
  currency: CurrencyCode;
  currencyName: string;
  quote: string;
  mean: number;
  buy: number | null;
  sell: number | null;
  kesPerUnit: number;
  unitsPerKes: number;
  requestedDate: string | null;
  isFallback: boolean;
  fallbackReason: string | null;
  origin: "snapshot" | "cbk_live";
  source: string;
}

export interface ConversionRow {
  type: "conversion";
  date: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  result: number;
  fromKesPerUnit: number;
  toKesPerUnit: number;
  fromRateDate: string | null;
  toRateDate: string | null;
  isFallback: boolean;
  method: string;
  source: string;
}

export class RateNotAvailableError extends Error {}

export function checkDate(date: string, store: RateStore): void {
  const today = store.today();
  if (date > today) throw new RateNotAvailableError(`${date} is in the future (today in Nairobi is ${today})`);
  if (date < store.firstDate) throw new RateNotAvailableError(`coverage starts ${store.firstDate}`);
}

/** A day CBK has only partly published so far (it posts its table in pieces some mornings). */
export interface IncompleteDay {
  date: string;
  published: number;
  expected: number;
}

/**
 * The date to serve for a request on `date`: the newest published day, unless that day is today
 * (Nairobi), was fetched live, and covers fewer currencies than the published day before it.
 * Past days are final, so a currency CBK stops publishing can never freeze the whole series.
 */
export function completeAsOf(date: string, store: RateStore): { asOf: string; incomplete?: IncompleteDay } {
  const newest = store.newestPublishedOnOrBefore(date);
  if (!newest || newest <= store.snapshotLastDate || newest !== store.today()) return { asOf: date };
  const previous = store.newestPublishedOnOrBefore(addDays(newest, -1));
  if (!previous) return { asOf: date };
  const published = store.coverageOn(newest);
  const expected = store.coverageOn(previous);
  return published < expected ? { asOf: previous, incomplete: { date: newest, published, expected } } : { asOf: date };
}

const incompleteReason = (d: IncompleteDay) =>
  `CBK has published only ${d.published} of ${d.expected} currencies for ${d.date} so far; last complete day returned`;

const codesOf = (input: ActorInput): CurrencyCode[] => input.currencies?.length ? input.currencies : CURRENCY_CODES;

/** Mode "latest": one row per currency for `date` (default today), falling back to the last published day. */
export function* latestRows(input: ActorInput, store: RateStore): Generator<RateRow> {
  const date = input.date ?? store.today();
  checkDate(date, store);
  const { asOf, incomplete } = completeAsOf(date, store);
  for (const code of codesOf(input)) yield rateOn(code, date, store, asOf, incomplete);
}

/** Mode "range": every published business day per currency in [startDate, endDate]. No weekend filling. */
export function* rangeRows(input: ActorInput, store: RateStore): Generator<RateRow> {
  const from = input.startDate!;
  const to = input.endDate ?? store.today();
  checkDate(from, store);
  checkDate(to, store);
  // Rows of a day CBK is still filling in are left out (and so never charged); they appear once complete.
  const { incomplete } = completeAsOf(to, store);
  for (const code of codesOf(input)) {
    for (const r of store.range(code, from, to)) if (r.date !== incomplete?.date) yield toRow(code, r, null, null);
  }
}

/** Mode "convert": one row, amount converted through KES with CBK mean rates. */
export function convertRow(input: ActorInput, store: RateStore): ConversionRow {
  const date = input.date ?? store.today();
  checkDate(date, store);
  const { asOf, incomplete } = completeAsOf(date, store);
  const leg = (c: CurrencyCode | "KES") => {
    if (c === "KES") return { kpu: 1, rateDate: null, fallback: false };
    const r = rateOn(c, date, store, asOf, incomplete);
    return { kpu: r.kesPerUnit, rateDate: r.date, fallback: r.isFallback };
  };
  const from = leg(input.fromCurrency!);
  const to = leg(input.toCurrency!);
  return {
    type: "conversion",
    date,
    amount: input.amount!,
    fromCurrency: input.fromCurrency!,
    toCurrency: input.toCurrency!,
    result: round((input.amount! * from.kpu) / to.kpu),
    fromKesPerUnit: from.kpu,
    toKesPerUnit: to.kpu,
    fromRateDate: from.rateDate,
    toRateDate: to.rateDate,
    isFallback: from.fallback || to.fallback,
    method: "amount x (KES per 1 from) / (KES per 1 to), CBK mean rates; cross rates go through KES",
    source: SOURCE_URL,
  };
}

/** Rate for `code` as requested on `date`, served from `asOf` (the last complete day). */
function rateOn(code: CurrencyCode, date: string, store: RateStore, asOf: string, incomplete?: IncompleteDay): RateRow {
  const hit = store.lookup(code, asOf, MAX_FALLBACK_DAYS);
  if (!hit.found) {
    if (hit.reason === "before_coverage") throw new RateNotAvailableError(`no CBK rate for ${code} on or before ${date}`);
    throw new RateNotAvailableError(`newest ${code} rate is ${hit.newestDate}; CBK could not be reached for newer data`);
  }
  if (hit.rate.date === date) return toRow(code, hit.rate, date, null);
  const reason = incomplete ? incompleteReason(incomplete) : fallbackReason(date, hit.withheldOnRequestedDate, store);
  return toRow(code, hit.rate, date, reason);
}

function toRow(code: CurrencyCode, r: StoredRate, requestedDate: string | null, fallbackReason: string | null): RateRow {
  const kpu = kesPerUnit(code, r.mean);
  return {
    type: "rate",
    date: r.date,
    currency: code,
    currencyName: currencyInfo(code).name,
    quote: quoteText(code),
    mean: r.mean,
    buy: r.buy ?? null,
    sell: r.sell ?? null,
    kesPerUnit: round(kpu),
    unitsPerKes: round(1 / kpu),
    requestedDate,
    isFallback: fallbackReason !== null,
    fallbackReason,
    origin: r.origin,
    source: SOURCE_URL,
  };
}

function fallbackReason(date: string, withheld: boolean, store: RateStore): string {
  if (withheld) return "CBK's value for this date failed a plausibility check and is withheld; last good published rate returned";
  const day = weekdayName(date);
  if (day === "Saturday" || day === "Sunday") return `${day}: CBK does not publish on weekends; last published rate returned`;
  if (date === store.today()) return "today's CBK rate is not published yet; last published rate returned";
  return "no CBK rate published for this date (public holiday or no publication); last published rate returned";
}

const round = (n: number) => Number(n.toPrecision(10));
