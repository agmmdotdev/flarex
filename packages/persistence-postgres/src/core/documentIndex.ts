/**
 * Full-key derivation shared by translated snapshot and write owners.
 * Pinned source: Convex crates/common/src/document.rs at
 * db914cf06e2b06ee985646611b9e12ed7a770318.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/internal/value-runtime-core";
import { Result } from "effect";
import { CoreTransactionError, type CoreIndexDefinition } from "./api";

function field(document: DocumentObject, path: string): DocumentValue | undefined {
  let value: DocumentValue | undefined = document;
  for (const part of path.split(".")) {
    if (value === undefined || !isCanonicalFlarexRuntimeObjectV1(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

/** Full ordered key, including the developer-ID tie breaker. */
export function documentIndexKey(index: CoreIndexDefinition, document: DocumentObject): Result.Result<Uint8Array, CoreTransactionError> {
  const id = document._id;
  if (typeof id !== "string") return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
  return Result.mapError(encodeIndexKey(index.fields.map(path => field(document, path)), id),
    cause => new CoreTransactionError({ reason: "invalidValue", cause }));
}
