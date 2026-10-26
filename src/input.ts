/**
 * Actor input: parsed and validated before any work, so a bad input costs the user nothing.
 * Mirrors .actor/input_schema.json.
 */
import { z } from "zod";
import { CURRENCY_CODES, type CurrencyCode } from "./fx/currencies.js";
import { isRealIsoDate } from "./fx/dates.js";

const isoDate = z.string().refine(isRealIsoDate, "must be a real date as YYYY-MM-DD");
const currency = z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]);

export const MAX_ROWS_LIMIT = 200_000;

export const inputSchema = z
  .object({
    mode: z.enum(["latest", "range", "convert"]).default("latest"),
    currencies: z.array(currency).max(21).optional(),
    date: isoDate.optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    amount: z.number().positive().finite().optional(),
    fromCurrency: z.union([currency, z.literal("KES")]).optional(),
    toCurrency: z.union([currency, z.literal("KES")]).optional(),
    maxRows: z.number().int().min(1).max(MAX_ROWS_LIMIT).default(10_000),
    fetchLatestFromCbk: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "range") {
      if (!v.startDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: "required in range mode" });
      if (v.startDate && v.endDate && v.endDate < v.startDate)
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "must be on or after startDate" });
    }
    if (v.mode === "convert") {
      for (const key of ["amount", "fromCurrency", "toCurrency"] as const)
        if (v[key] === undefined) ctx.addIssue({ code: "custom", path: [key], message: "required in convert mode" });
    }
  });

export type ActorInput = z.infer<typeof inputSchema>;

/** Throws a readable message listing every problem at once. */
export function parseInput(raw: unknown): ActorInput {
  const result = inputSchema.safeParse(raw ?? {});
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
  throw new InputError(`Invalid input. ${problems.join("; ")}`);
}

export class InputError extends Error {}
