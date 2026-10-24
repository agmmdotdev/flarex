import type { RelationalTableIdentity } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import { inspectCapturedPrivateJsonData } from "../../../values/privateJsonData";

/** Diagnostic provenance for an actual rejected logical row. The candidate,
 * when present, is the exact captured input at that validation boundary; it is
 * not a completed framework entity, SQL exception or storage capability. */
export interface LogicalRelationalFailureEvidence {
  readonly origin: "input" | "row";
  readonly kind: "missing" | "null";
  readonly table: RelationalTableIdentity;
  readonly column: string;
  readonly candidate?: JsonObject;
}
const failures = new WeakMap<object, LogicalRelationalFailureEvidence>();

/** Storage-owner issuance only. Foreign candidates cannot acquire captured
 * ownership through an error, readonly type or frozen outer wrapper. */
export function retainLogicalRelationalFailure(failure: unknown, evidence: LogicalRelationalFailureEvidence): void {
  if ((typeof failure !== "object" || failure === null) && typeof failure !== "function") return;
  if (failures.has(failure)) return;
  const candidate = evidence.candidate;
  failures.set(failure, Object.freeze({ origin: evidence.origin, kind: evidence.kind,
    table: Object.freeze({ ...evidence.table }), column: evidence.column,
    ...(candidate !== undefined && inspectCapturedPrivateJsonData(candidate)?.value === candidate ? { candidate } : {}),
  }));
}

/** Exact-error inspection only. Public fields, causes and serialized copies
 * confer no provenance; reused error identities retain their first issuance. */
export function inspectLogicalRelationalFailure(failure: unknown): LogicalRelationalFailureEvidence | undefined {
  return (typeof failure === "object" && failure !== null) || typeof failure === "function" ? failures.get(failure) : undefined;
}
