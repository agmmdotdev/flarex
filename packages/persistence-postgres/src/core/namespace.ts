/** TableNamespace translated from Convex value/src/table_mapping.rs at db914cf06.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Result, Schema } from "effect";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";

export const CoreTableNamespaceSchema = Schema.Union([
  Schema.Null,
  Schema.Struct({ kind: Schema.Literal("byComponent"), id: DeveloperDocumentIdSchema }),
]);
export type CoreTableNamespace = typeof CoreTableNamespaceSchema.Type;
export const CORE_GLOBAL_NAMESPACE: CoreTableNamespace = null;
const decodeNamespace = Schema.decodeUnknownResult(CoreTableNamespaceSchema);
export const captureCoreTableNamespace = (value:unknown) => Result.map(decodeNamespace(value),namespace=>namespace===null?null:Object.freeze({kind:"byComponent" as const,id:namespace.id}));

/** A key is representation, never component authorization. */
export function coreNamespaceKey(namespace: CoreTableNamespace): string {
  return namespace === null ? "global" : `component:${namespace.id}`;
}
