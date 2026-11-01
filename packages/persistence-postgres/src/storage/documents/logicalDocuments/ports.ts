import type { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import type { BoundedRequestContext, PresentedTransactionId } from "../../../execution/preparation/boundedRequestLifetime";

/** Confined framework document operations, independent of a storage session. */
export interface LogicalDocuments<Failure> {
  /** Authenticate table-typed IDs without observing document bodies or absence. */
  readonly validateIds: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    documentIds: readonly string[]) => Effect.Effect<void, Failure>;
  readonly get: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<JsonObject | null, Failure>;
  readonly getMany: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    documentIds: readonly string[]) => Effect.Effect<readonly (JsonObject | null)[], Failure>;
  readonly find: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    query: Readonly<{ where: JsonObject; offset: number; limit: number }>) => Effect.Effect<Readonly<{ docs: readonly JsonObject[]; total: number }>, Failure>;
  readonly insert: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string, fields: unknown) => Effect.Effect<JsonObject, Failure>;
  readonly patch: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, Failure>;
  readonly replace: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, Failure>;
  readonly delete: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<void, Failure>;
}
