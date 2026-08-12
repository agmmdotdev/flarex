import type { ApplicationMutationExecutionAuthorityV1 } from
  "flarex-protocol/internal/application-mutation-authority-v1";
import type { Json, JsonObject } from "flarex-protocol/json";

/**
 * Detach and recursively freeze an already-decoded Application execution
 * authority before persistence retains it across an asynchronous boundary.
 */
export function snapshotApplicationExecutionAuthorityJson(
  value: JsonObject | ApplicationMutationExecutionAuthorityV1,
): JsonObject {
  const snapshot = structuredClone(value) as unknown as JsonObject;
  freezeOwnedJson(snapshot);
  return snapshot;
}

function freezeOwnedJson(value: Json): void {
  if (value === null || typeof value !== "object") return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) freezeOwnedJson(child);
  Object.freeze(value);
}
