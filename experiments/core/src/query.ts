import { Schema } from "effect";

export const Bound = Schema.Struct({ value: Schema.Number.check(Schema.isFinite()), inclusive: Schema.Boolean });
export const NumericRange = Schema.Struct({ index: Schema.String, field: Schema.String, lower: Schema.NullOr(Bound), upper: Schema.NullOr(Bound) });
export type NumericRange = typeof NumericRange.Type;
export interface PointDependency { readonly kind: "point"; readonly id: string; readonly revision: number | null; readonly tombstone: boolean }
export interface RangeDependency { readonly kind: "range"; readonly range: NumericRange }
export type Dependency = PointDependency | RangeDependency;

export function contains(range: NumericRange, value: number) {
  return (range.lower === null || value > range.lower.value || range.lower.inclusive && value === range.lower.value) &&
    (range.upper === null || value < range.upper.value || range.upper.inclusive && value === range.upper.value);
}
export const applicationLimits = Object.freeze({ rows: 256, bytes: 262_144, dependencies: 256, attempts: 3 });
