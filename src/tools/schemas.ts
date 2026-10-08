/** Zod building blocks shared by the tool input schemas, plus small response helpers. */

import { z } from 'zod';

/** Nova Poshta identifies cities, settlements, streets and branches by GUIDs called "Ref". */
const REF_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ref = (what: string) => z.string().regex(REF_PATTERN, 'Must be a Ref: a GUID such as 8d5a980d-391c-11dd-90d9-001a92567626.').describe(what);

export const cityRef = (whose: string) =>
  ref(
    `City of the ${whose}: the \`DeliveryCity\` value of a settlement from search_settlements, or the \`CityRef\` of a branch from search_warehouses. Not the settlement \`Ref\`.`,
  );

export const query = (what: string) => z.string().trim().min(1).max(100).describe(what);

export const limit = (byDefault: number, max: number) =>
  z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`How many records to return. Default ${byDefault}; values above ${max} are clamped.`);

export const page = z.number().int().min(1).optional().describe('Page number, starting from 1. Default 1.');

export interface Page {
  readonly limit: number;
  readonly page: number;
}

export function resolvePage(args: { limit?: number | undefined; page?: number | undefined }, byDefault: number, max: number): Page {
  return { limit: Math.min(args.limit ?? byDefault, max), page: args.page ?? 1 };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const date = (what: string) =>
  z
    .string()
    .regex(DATE_PATTERN, 'Must be a date as YYYY-MM-DD, e.g. 2026-10-12.')
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    }, 'Not a valid calendar date.')
    .describe(`${what} Format YYYY-MM-DD, e.g. 2026-10-12.`);

/** The API takes dates as `dd.mm.yyyy`. */
export function toApiDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function objects(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** The pagination block of the tools that page through a directory. */
export function pagination(requested: Page, returned: number, total: number | undefined) {
  const seen = (requested.page - 1) * requested.limit + returned;
  // Without a total a full page means there may be more.
  const hasNext = total === undefined ? returned >= requested.limit : seen < total;
  return {
    page: requested.page,
    limit: requested.limit,
    returned,
    ...(total === undefined ? {} : { total }),
    next_page: hasNext && returned > 0 ? requested.page + 1 : null,
  };
}
