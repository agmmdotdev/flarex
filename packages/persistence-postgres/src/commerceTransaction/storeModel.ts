import type { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import type { BoundedRequestContext } from "../boundedRequestLifetime";
import type { CommerceTransactionError } from "./model";

export interface CommerceStore {
  readonly find: (context: BoundedRequestContext, query: unknown) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
  readonly count: (context: BoundedRequestContext, query: unknown) => Effect.Effect<number, CommerceTransactionError>;
  readonly write: (context: BoundedRequestContext, mode: "insert" | "upsert" | "update", rows: unknown) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
  readonly delete: (context: BoundedRequestContext, keys: unknown) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
}
