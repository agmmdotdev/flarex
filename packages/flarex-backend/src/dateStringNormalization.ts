import { finiteDateMilliseconds } from "@flarex/utils/dates";

/**
 * Normalizes text accepted by the host JavaScript Date parser to an ISO
 * timestamp. The caller owns non-empty-string validation and domain failures.
 */
export function normalizeDateString(value: string): string | undefined {
  const date = new Date(value);
  return finiteDateMilliseconds(date) === undefined
    ? undefined
    : date.toISOString();
}
