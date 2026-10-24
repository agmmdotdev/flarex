import type { RelationalTableIdentity, RelationalConstraintIdentity, RelationalKeyIdentity } from "flarex-protocol/internal/relational-schema";
import type { CatalogUniqueConstraintDefinitionId } from "flarex-protocol/catalog";
import type { JsonObject } from "flarex-protocol/json";
import { inspectCapturedPrivateJsonData } from "../../../values/privateJsonData";

/** Diagnostic provenance for an actual rejected logical row. The candidate,
 * when present, is the exact captured input at that validation boundary; it is
 * not a completed framework entity, SQL exception or storage capability. */
interface LogicalRelationalFailureCandidate {
  readonly table: RelationalTableIdentity;
  readonly candidate?: JsonObject;
}
export type LogicalRelationalUniqueValue = string | number | boolean | null;
export type LogicalRelationalUniqueIdentity =
  | Readonly<{ kind: "primary"; identity: RelationalKeyIdentity }>
  | Readonly<{ kind: "unique"; definitionId: CatalogUniqueConstraintDefinitionId }>;
export type LogicalRelationalFailureEvidence = LogicalRelationalFailureCandidate & (
  | Readonly<{ origin: "input" | "row"; kind: "missing" | "null"; column: string }>
  | Readonly<{ origin: "row"; kind: "check"; column: string; constraint: RelationalConstraintIdentity }>
  | Readonly<{ origin: "input" | "row"; kind: "unique"; key: LogicalRelationalUniqueIdentity;
      columns: readonly string[]; values: readonly LogicalRelationalUniqueValue[] }>
);
const failures = new WeakMap<object, LogicalRelationalFailureEvidence>();

/** Storage-owner issuance only. Foreign candidates cannot acquire captured
 * ownership through an error, readonly type or frozen outer wrapper. */
export function retainLogicalRelationalFailure(failure: unknown, evidence: LogicalRelationalFailureEvidence): void {
  if ((typeof failure !== "object" || failure === null) && typeof failure !== "function") return;
  if (failures.has(failure)) return;
  const candidate = evidence.candidate;
  const captured = { table: Object.freeze({ ...evidence.table }),
    ...(candidate !== undefined && inspectCapturedPrivateJsonData(candidate)?.value === candidate ? { candidate } : {}),
  };
  switch (evidence.kind) {
    case "missing": case "null":
      failures.set(failure, Object.freeze({ ...captured, origin: evidence.origin, kind: evidence.kind, column: evidence.column }));
      break;
    case "check":
      failures.set(failure, Object.freeze({ ...captured, origin: evidence.origin, kind: evidence.kind, column: evidence.column,
        constraint: Object.freeze({ ...evidence.constraint }) }));
      break;
    case "unique": {
      const key: LogicalRelationalUniqueIdentity = evidence.key.kind === "primary"
        ? Object.freeze({ kind: "primary", identity: Object.freeze({ ...evidence.key.identity }) })
        : Object.freeze({ kind: "unique", definitionId: evidence.key.definitionId });
      failures.set(failure, Object.freeze({ ...captured, origin: evidence.origin, kind: evidence.kind, key,
        columns: Object.freeze([...evidence.columns]), values: Object.freeze([...evidence.values]) }));
      break;
    }
  }
}

/** Exact-error inspection only. Public fields, causes and serialized copies
 * confer no provenance; reused error identities retain their first issuance. */
export function inspectLogicalRelationalFailure(failure: unknown): LogicalRelationalFailureEvidence | undefined {
  return (typeof failure === "object" && failure !== null) || typeof failure === "function" ? failures.get(failure) : undefined;
}
