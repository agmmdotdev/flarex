import type { CatalogTableId } from "flarex-protocol/catalog";
import type { RelationalTableIdentity } from "flarex-protocol/internal/relational-schema";

interface LegacyReferenceEndpoint { readonly tableId: CatalogTableId; readonly tableName: string }
interface CoreReferenceEndpoint { readonly identity: RelationalTableIdentity; readonly tableName: string }
export type ReferenceFailureEvidence =
  | Readonly<{ storage?: "legacy"; origin: "checkpoint" | "close";
      child: LegacyReferenceEndpoint & Readonly<{ documentId: string }>; sourceColumn: string;
      target: LegacyReferenceEndpoint & Readonly<{ column: string; key: string }> }>
  | Readonly<{ storage: "core"; origin: "checkpoint" | "close";
      descriptor: string;
      child: CoreReferenceEndpoint & Readonly<{ documentId: string }>; sourceColumns: readonly string[];
      target: CoreReferenceEndpoint & Readonly<{ columns: readonly string[]; values: readonly (string | number | boolean | null)[] }> }>;
const failures = new WeakMap<object, ReferenceFailureEvidence>();

/** Read-only failure provenance, not a SQL exception or storage capability. */
export function retainReferenceFailure(failure: unknown, evidence: ReferenceFailureEvidence): void {
  if ((typeof failure !== "object" || failure === null) && typeof failure !== "function" || failures.has(failure)) return;
  if (evidence.storage === "core") {
    failures.set(failure, Object.freeze({ ...evidence,
      sourceColumns: Object.freeze([...evidence.sourceColumns]),
      child: Object.freeze({ ...evidence.child, identity: Object.freeze({ ...evidence.child.identity }) }),
      target: Object.freeze({ ...evidence.target, identity: Object.freeze({ ...evidence.target.identity }),
        columns: Object.freeze([...evidence.target.columns]), values: Object.freeze([...evidence.target.values]) }) }));
  } else failures.set(failure, Object.freeze({ ...evidence,
    child: Object.freeze({ ...evidence.child }), target: Object.freeze({ ...evidence.target }) }));
}

export function inspectReferenceFailure(failure: unknown): ReferenceFailureEvidence | undefined {
  return (typeof failure === "object" && failure !== null) || typeof failure === "function" ? failures.get(failure) : undefined;
}
