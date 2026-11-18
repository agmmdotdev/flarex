import type { RelationalTableIdentity, RelationalConstraintIdentity, RelationalKeyIdentity,
  RelationalIndexIdentity } from "flarex-protocol/internal/relational-schema";
import type { CatalogUniqueConstraintDefinitionId } from "flarex-protocol/catalog";
import type { JsonObject } from "flarex-protocol/json";
import { inspectCapturedPrivateJsonData } from "./privateJsonData";

interface RelationalFailureCandidate {
  readonly table: RelationalTableIdentity;
  readonly candidate?: JsonObject;
}
export type RelationalUniqueValue = string | number | boolean | null;
export type RelationalUniqueIdentity =
  | Readonly<{ kind: "primary"; identity: RelationalKeyIdentity }>
  | Readonly<{ kind: "unique"; definitionId: CatalogUniqueConstraintDefinitionId }>
  | Readonly<{ kind: "nativeUnique"; declaration:
      Readonly<{ kind: "key"; identity: RelationalKeyIdentity }> | Readonly<{ kind: "index"; identity: RelationalIndexIdentity }> }>;
export type RelationalFailureEvidence = RelationalFailureCandidate & (
  | Readonly<{ origin: "input" | "row"; kind: "missing" | "null"; column: string }>
  | Readonly<{ origin: "row"; kind: "check"; column: string; constraint: RelationalConstraintIdentity }>
  | Readonly<{ origin: "input" | "row"; kind: "unique"; key: RelationalUniqueIdentity;
      columns: readonly string[]; values: readonly RelationalUniqueValue[] }>
);
const failures = new WeakMap<object, RelationalFailureEvidence>();

/** Exact issuer-owned diagnostics; no validator, storage or settlement capability. */
export function retainRelationalFailure(failure: unknown, evidence: RelationalFailureEvidence): void {
  if ((typeof failure !== "object" || failure === null) && typeof failure !== "function" || failures.has(failure)) return;
  const candidate = evidence.candidate;
  const captured = { table: Object.freeze({ ...evidence.table }),
    ...(candidate !== undefined && inspectCapturedPrivateJsonData(candidate)?.value === candidate ? { candidate } : {}) };
  switch (evidence.kind) {
    case "missing": case "null":
      failures.set(failure, Object.freeze({ ...captured, origin: evidence.origin, kind: evidence.kind, column: evidence.column }));
      break;
    case "check":
      failures.set(failure, Object.freeze({ ...captured, origin: evidence.origin, kind: evidence.kind, column: evidence.column,
        constraint: Object.freeze({ ...evidence.constraint }) }));
      break;
    case "unique": {
      const key: RelationalUniqueIdentity = evidence.key.kind === "primary"
        ? Object.freeze({ kind: "primary", identity: Object.freeze({ ...evidence.key.identity }) })
        : evidence.key.kind === "unique" ? Object.freeze({ kind: "unique", definitionId: evidence.key.definitionId })
          : Object.freeze({ kind: "nativeUnique", declaration: evidence.key.declaration.kind === "key"
            ? Object.freeze({ kind: "key", identity: Object.freeze({ ...evidence.key.declaration.identity }) })
            : Object.freeze({ kind: "index", identity: Object.freeze({ ...evidence.key.declaration.identity }) }) });
      failures.set(failure, Object.freeze({ ...captured, origin: evidence.origin, kind: evidence.kind, key,
        columns: Object.freeze([...evidence.columns]), values: Object.freeze([...evidence.values]) }));
      break;
    }
  }
}

export function inspectRelationalFailure(failure: unknown): RelationalFailureEvidence | undefined {
  return (typeof failure === "object" && failure !== null) || typeof failure === "function" ? failures.get(failure) : undefined;
}
