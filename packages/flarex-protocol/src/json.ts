import { Schema } from "effect";

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

export const Json: Schema.Schema<Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(Json),
    Schema.Record(Schema.String, Json),
  ]),
);
