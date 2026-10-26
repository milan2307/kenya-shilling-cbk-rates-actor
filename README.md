# Kenya Shilling Exchange Rates – CBK Official (21 currencies, 2004 to today)

Official Central Bank of Kenya mean, buy and sell rates for KES against 21 currencies, every business day since Nov 2004. Get today's rate, a date range, or a conversion. Clean JSON, ready for agents, spreadsheets and accounting tools.

## What you get

- **Official source.** Rates come from the Central Bank of Kenya's published indicative exchange rates ([centralbank.go.ke/rates/forex-exchange-rates](https://www.centralbank.go.ke/rates/forex-exchange-rates/)). Each row links back to it.
- **Full history.** 111,298 daily rates from 2 November 2004 to the latest business day, plus a live check of CBK for anything newer when you run it.
- **Buy and sell where CBK published them.** CBK published mean, buy and sell up to 4 January 2024. From 5 January 2024 it publishes the mean only, so `buy` and `sell` are `null` from then on.
- **21 currencies:** USD, GBP, EUR, ZAR, UGX, TZS, RWF, BIF, AED, CAD, CHF, JPY, SEK, NOK, DKK, INR, HKD, SGD, SAR, CNY, AUD.
- **No guessing.** Weekends and public holidays are never filled in a range. In `latest` mode a weekend or holiday returns the last published day, with `isFallback: true` and a plain reason. A rate more than 10 days old is never served.
- **Cleaned.** CBK's tables carry a few keying errors, such as a value entered under the wrong currency for one day. 119 such points are withheld rather than passed on, and stretches before November 2004, where the source tables are misaligned, are left out.
- **Quote conventions handled.** CBK quotes JPY per 100, and the East African pairs (UGX, TZS, RWF, BIF) as units per 1 KES. Every row keeps CBK's own number (`mean`) and adds `kesPerUnit` and `unitsPerKes`, so you never have to remember which is which.

## Three modes

| Mode | Input | Rows |
| --- | --- | --- |
| `latest` (default) | optional `date` (default today in Nairobi), optional `currencies` | one per currency (21 if you leave `currencies` empty) |
| `range` | `startDate`, optional `endDate` (default today), optional `currencies` | one per currency per published business day |
| `convert` | `amount`, `fromCurrency`, `toCurrency` (KES or any of the 21), optional `date` | one |

`maxRows` (default 10,000) caps any run.

### Example inputs

Today's rates for three currencies:

```json
{ "mode": "latest", "currencies": ["USD", "EUR", "GBP"] }
```

Every USD rate in 2025:

```json
{ "mode": "range", "currencies": ["USD"], "startDate": "2025-01-01", "endDate": "2025-12-31" }
```

Convert 1,000 USD to KES at today's rate:

```json
{ "mode": "convert", "amount": 1000, "fromCurrency": "USD", "toCurrency": "KES" }
```

### Example output (one `rate` row)

```json
{
  "type": "rate",
  "date": "2026-10-23",
  "currency": "USD",
  "currencyName": "US dollar",
  "quote": "KES per 1 USD",
  "mean": 129.89,
  "buy": null,
  "sell": null,
  "kesPerUnit": 129.89,
  "unitsPerKes": 0.00769882208,
  "requestedDate": "2026-10-26",
  "isFallback": true,
  "fallbackReason": "today's CBK rate is not published yet; last published rate returned",
  "origin": "snapshot",
  "source": "https://www.centralbank.go.ke/rates/forex-exchange-rates/"
}
```

`origin` is `snapshot` for the bundled history and `cbk_live` for days fetched from CBK during your run.

## Pricing

Pay per result: each row in the dataset is one `rate-row` event. Some typical runs:

| Run | Rows |
| --- | --- |
| Today, all 21 currencies | 21 |
| Today, USD only | 1 |
| One conversion | 1 |
| USD for all of 2025 | 248 |
| Full history, all 21 currencies | 111,298 |

Set `maxRows`, or a maximum cost per run in Apify, to cap spending. The run stops cleanly at that limit.

## Use it from agents, spreadsheets and code

- **AI agents and MCP:** call the Actor through Apify's MCP server or API, and give your agent the `convert` mode for one-line answers.
- **Spreadsheets:** export the dataset as CSV or Excel from the run, or schedule a daily `latest` run and pull it into Google Sheets.
- **Accounting:** use `range` for month-end revaluation at CBK mean rates, or `latest` with a `date` for the rate on an invoice date.

## Notes

- This Actor is not affiliated with or endorsed by the Central Bank of Kenya. CBK's rates are indicative reference rates, not dealing rates, and CBK gives no warranty of their accuracy.
- CBK publishes on business days, usually during the Nairobi morning. Until it publishes, "today" returns the previous business day and says so.
- Set `fetchLatestFromCbk` to `false` for a fully offline run that you can reproduce exactly.

## For developers

```bash
npm install
npm test                      # unit tests (input, modes, fallbacks, quote conventions)
npm run build
npx -p apify-cli@1.10.0 apify run --purge         # local run with storage/key_value_stores/default/INPUT.json, no Apify account needed
ACTOR_TEST_PAY_PER_EVENT=true ACTOR_USE_CHARGING_LOG_DATASET=true ACTOR_MAX_TOTAL_CHARGE_USD=5 npx -p apify-cli@1.10.0 apify run --purge
npm run snapshot              # rebuild data/cbk-kes-rates.json from CBK's tables, then review the diff
```

Code map: `src/main.ts` (Apify entry point: push and charge), `src/input.ts` (validation), `src/service/rates.ts` (the three modes), `src/fx/` (CBK source, currencies, cleaning, rate store), `data/` (bundled history).

MIT licence, Copyright (c) 2026 LamuLabs.
