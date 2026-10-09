import { copyFiniteDate } from "@flarex/utils/dates";

/** Package-owned normalization for timestamps returned by supported drivers. */
export function databaseTimestampFromUnknown(value: unknown): Date | null {
  const copied = copyFiniteDate(value);
  if (copied !== undefined) return copied;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
