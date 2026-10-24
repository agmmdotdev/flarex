import type { CatalogTableId } from "flarex-protocol/catalog";

/** Read-only provenance for an exact failure issued by the reference owner.
 * This is not a SQL error, a recovery token or a settlement capability. */
export interface LogicalReferenceFailureEvidence {
  readonly origin: "checkpoint" | "close";
  readonly child: Readonly<{ tableId: CatalogTableId; tableName: string; documentId: string }>;
  readonly sourceColumn: string;
  readonly target: Readonly<{ tableId: CatalogTableId; tableName: string; column: string; key: string }>;
}
const failures = new WeakMap<object, LogicalReferenceFailureEvidence>();
/** Storage-owner issuance only. Do not project this registry into error causes. */
export function retainLogicalReferenceFailure(failure: unknown, evidence: LogicalReferenceFailureEvidence): void {
  if ((typeof failure !== "object" || failure === null) && typeof failure !== "function") return;
  // A generic failure factory may reuse an object. Its first issued Cause must
  // retain the original provenance, even if a later context fails differently.
  if (failures.has(failure)) return;
  failures.set(failure, Object.freeze({ ...evidence, child: Object.freeze({ ...evidence.child }), target: Object.freeze({ ...evidence.target }) }));
}
export function inspectLogicalReferenceFailure(failure: unknown): LogicalReferenceFailureEvidence | undefined {
  return (typeof failure === "object" && failure !== null) || typeof failure === "function" ? failures.get(failure) : undefined;
}
