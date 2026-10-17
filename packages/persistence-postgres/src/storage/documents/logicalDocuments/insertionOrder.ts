import type { LogicalDocumentChanges } from "./workingSet";
import type { LogicalDocumentRootState } from "./rootEvaluator";
import { Result } from "effect";
import type { ScopeId, CommitSeq } from "flarex-protocol/storage-authority";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { boundedRequestRootIdentity, type BoundedRequestLifetime } from "../../../execution/preparation/boundedRequestLifetime";

/** Hidden revision evidence, separate from the canonical Application value. */
export type LogicalInsertionOrder = Readonly<{ kind: "committed"; commitSeq: CommitSeq; attemptOrdinal: number }> |
  Readonly<{ kind: "pending"; attemptOrdinal: number }>;

declare const insertionRootBrand: unique symbol;
export interface LogicalInsertionRoot { readonly [insertionRootBrand]: true }
declare const insertionEvidenceBrand: unique symbol;
export interface LogicalInsertionEvidence { readonly [insertionEvidenceBrand]: true }
interface Allocation { parent?: Allocation; readonly scopeId: ScopeId; next: number; handle?: LogicalInsertionRoot }
const namespaces = new WeakMap<object, Allocation>();
const rootHandles = new WeakMap<LogicalInsertionRoot, Allocation>();
const graphRoots = new WeakMap<LogicalDocumentChanges, LogicalInsertionRoot>();
const insertionEvidence = new WeakMap<LogicalInsertionEvidence, Readonly<{
  allocation: Allocation; ordinal: number; scopeId: ScopeId; tableId: CatalogTableId; documentId: AppDocumentIdV1; digest: Uint8Array;
}>>();
const allocationRoot = (allocation: Allocation): Allocation => {
  let root = allocation;
  while (root.parent !== undefined) root = root.parent;
  return root;
};
const handleFor = (allocation: Allocation): LogicalInsertionRoot => {
  if (allocation.handle !== undefined) return allocation.handle;
  // SAFETY: only this registry issues and authenticates this inert capability.
  const handle = Object.freeze({}) as LogicalInsertionRoot;
  allocation.handle = handle;
  rootHandles.set(handle, allocation);
  return handle;
};

/** The graph-producing owner binds its exact closed value before detachment. */
export function captureLogicalInsertionGraph<Graph extends LogicalDocumentChanges>(graph: Graph, handle: LogicalInsertionRoot): Graph {
  if (!rootHandles.has(handle)) throw new Error("Foreign logical insertion root");
  graphRoots.set(graph, handle);
  return graph;
}

/** Only an already owned graph can lend its root binding to its detached copy. */
export function retainLogicalInsertionGraph(source: LogicalDocumentChanges, detached: LogicalDocumentChanges): void {
  const handle = graphRoots.get(source);
  if (handle !== undefined) graphRoots.set(detached, handle);
}

export const logicalInsertionGraphRoot = (graph: LogicalDocumentChanges): LogicalInsertionRoot | undefined => graphRoots.get(graph);

/** Every closed graph, including no-op and unknown-generation graphs, retains
 * its source scope independently of optional per-insert evidence. */
export function hasLogicalInsertionGraph(scopeId: ScopeId,
  graph: LogicalDocumentChanges): boolean {
  const handle = graphRoots.get(graph);
  const allocation = handle === undefined ? undefined : rootHandles.get(handle);
  return handle !== undefined && allocation !== undefined && graph.insertionRoot === handle &&
    allocationRoot(allocation).scopeId === scopeId;
}

/** Called only by the authenticated logical root evaluator issuer. */
export function registerLogicalInsertionRoot(root: LogicalDocumentRootState, scopeId: ScopeId): LogicalInsertionRoot {
  let allocation = namespaces.get(root);
  if (allocation === undefined) { allocation = { scopeId, next: 0 }; namespaces.set(root, allocation); }
  if (allocation.scopeId !== scopeId) throw new Error("Logical insertion root scope changed");
  return handleFor(allocation);
}

/** Domain projections share the lifetime issuer's token. Borrowed finite-root
 * lifetimes alias their authenticated evaluator before allocating. Already used
 * independent namespaces cannot silently be combined. Lent handles resolve the
 * alias even if an empty namespace was issued before evaluator attachment. */
export function bindLogicalInsertionRoot<Failure>(lifetime: BoundedRequestLifetime<Failure>, scopeId: ScopeId, evaluator?: LogicalDocumentRootState):
  Result.Result<LogicalInsertionRoot, "invalidAuthority"> {
  const identity = boundedRequestRootIdentity(lifetime);
  if (identity === undefined) return Result.fail("invalidAuthority");
  const existing = namespaces.get(identity);
  const rootAllocation = evaluator === undefined ? undefined : namespaces.get(evaluator);
  if (evaluator !== undefined && rootAllocation === undefined) return Result.fail("invalidAuthority");
  const left = existing === undefined ? undefined : allocationRoot(existing);
  const right = rootAllocation === undefined ? undefined : allocationRoot(rootAllocation);
  if (left !== undefined && left.scopeId !== scopeId || right !== undefined && right.scopeId !== scopeId)
    return Result.fail("invalidAuthority");
  if (left !== undefined && right !== undefined && left !== right) {
    if (left.next !== 0 && right.next !== 0) return Result.fail("invalidAuthority");
    if (left.next === 0) left.parent = right;
    else right.parent = left;
  }
  const allocation = left ?? right ?? { scopeId, next: 0 };
  namespaces.set(identity, allocation);
  return Result.succeed(handleFor(allocation));
}

/** Allocation and proof issuance are indivisible. The authenticated write owner
 * has already charged this exact insertion; a caller cannot choose its ordinal. */
export function issueLogicalInsertionAttempt(handle: LogicalInsertionRoot, scopeId: ScopeId, tableId: CatalogTableId,
  documentId: AppDocumentIdV1, after: CanonicalFlarexValueV1): Result.Result<Readonly<{
    ordinal: number; evidence: LogicalInsertionEvidence;
  }>, "invalidAuthority" | "limitExceeded"> {
  const allocation = rootHandles.get(handle);
  if (allocation === undefined) return Result.fail("invalidAuthority");
  const root = allocationRoot(allocation);
  if (root.scopeId !== scopeId) return Result.fail("invalidAuthority");
  if (!Number.isSafeInteger(root.next) || root.next >= Number.MAX_SAFE_INTEGER) return Result.fail("limitExceeded");
  const ordinal = root.next++;
  // SAFETY: only this registry issues and authenticates this inert capability.
  const evidence = Object.freeze({}) as LogicalInsertionEvidence;
  insertionEvidence.set(evidence, Object.freeze({ allocation: root, ordinal, scopeId, tableId, documentId, digest: after.sha256.slice() }));
  return Result.succeed(Object.freeze({ ordinal, evidence }));
}

export function hasLogicalInsertionEvidence(scopeId: ScopeId, handle: LogicalInsertionRoot | undefined,
  attempt: Readonly<{ insertionAttemptOrdinal?: number; insertionEvidence?: LogicalInsertionEvidence;
    tableId: CatalogTableId; documentId: AppDocumentIdV1; operation: string; after: CanonicalFlarexValueV1 | null }>): boolean {
  if (attempt.insertionAttemptOrdinal === undefined) return attempt.insertionEvidence === undefined;
  const namespace = handle === undefined ? undefined : rootHandles.get(handle);
  const captured = attempt.insertionEvidence === undefined ? undefined : insertionEvidence.get(attempt.insertionEvidence);
  return namespace !== undefined && captured !== undefined && allocationRoot(namespace) === allocationRoot(captured.allocation) &&
    allocationRoot(namespace).scopeId === scopeId && captured.scopeId === scopeId && attempt.operation === "insert" && attempt.after !== null &&
    captured.ordinal === attempt.insertionAttemptOrdinal && captured.tableId === attempt.tableId &&
    captured.documentId === attempt.documentId && compareBytesLexicographically(captured.digest, attempt.after.sha256) === 0;
}

export function committedLogicalInsertionOrder(order: Readonly<{ commitSeq: CommitSeq; attemptOrdinal: number }>):
  Extract<LogicalInsertionOrder, { kind: "committed" }>;
export function committedLogicalInsertionOrder(order: Readonly<{ commitSeq: CommitSeq; attemptOrdinal: number }> | undefined):
  Extract<LogicalInsertionOrder, { kind: "committed" }> | undefined;
export function committedLogicalInsertionOrder(order: Readonly<{ commitSeq: CommitSeq; attemptOrdinal: number }> | undefined):
  Extract<LogicalInsertionOrder, { kind: "committed" }> | undefined {
  return order === undefined ? undefined : Object.freeze({ kind: "committed", ...order });
}

export function compareLogicalInsertionOrder(left: LogicalInsertionOrder, right: LogicalInsertionOrder): number {
  if (left.kind !== right.kind) return left.kind === "pending" ? 1 : -1;
  if (left.kind === "committed" && right.kind === "committed" && left.commitSeq !== right.commitSeq)
    return left.commitSeq < right.commitSeq ? -1 : 1;
  return left.attemptOrdinal - right.attemptOrdinal;
}
