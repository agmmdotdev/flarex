import { Schema } from "effect";
import type { Definition, Document } from "./definition.ts";
import { IndexedText } from "./value.ts";

export const Bound = Schema.Struct({ value: Schema.Number.check(Schema.isFinite()), inclusive: Schema.Boolean });
export const NumericRange = Schema.Struct({ index: Schema.String, field: Schema.String, lower: Schema.NullOr(Bound), upper: Schema.NullOr(Bound) });
export type NumericRange = typeof NumericRange.Type;
export interface PointObservation { readonly id: string; readonly revision: number | null; readonly body: Document | null; readonly bytes: number }
export interface PointDependency { readonly kind: "point"; readonly id: string; readonly revision: number | null; readonly tombstone: boolean }
export interface RangeDependency { readonly kind: "range"; readonly range: NumericRange }
export const TextEquality = Schema.Struct({ index: Schema.String, field: Schema.String, keys: Schema.Array(IndexedText).check(Schema.isMaxLength(256)) });
export type TextEquality = typeof TextEquality.Type;
export interface EqualityDependency { readonly kind: "equality"; readonly selection: TextEquality }
export type Dependency = PointDependency | RangeDependency | EqualityDependency;
export interface TableDependencies { readonly definition: Definition; readonly dependencies: readonly Dependency[] }

export function contains(range: NumericRange, value: number) {
  return (range.lower === null || value > range.lower.value || range.lower.inclusive && value === range.lower.value) &&
    (range.upper === null || value < range.upper.value || range.upper.inclusive && value === range.upper.value);
}
export const applicationLimits = Object.freeze({ rows: 256, bytes: 262_144, dependencies: 256, attempts: 3 });
