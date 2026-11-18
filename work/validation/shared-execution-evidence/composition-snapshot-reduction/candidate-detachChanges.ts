import type { LogicalDocumentChanges } from "./workingSet";
import type { LiveAppRowRevisionV1 } from "../appRows";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { detachLogicalCanonicalDocument, detachLogicalRelationalActivityJson } from "./relationalRows";

/** Detach mutable evidence while retaining the opaque located index capability
 * that the index reader authenticates by object identity. */
export const detachLogicalDocumentRootChanges = (input: LogicalDocumentChanges,
  originalRows: readonly LiveAppRowRevisionV1[], activity: "detached" | "immutable" = "detached") => {
  // Canonical evidence is copied by its issuing owner, with fresh byte buffers.
  // Retain sharing between changes, attempts and originals without duplicating
  // the expensive canonical tree clone or granting proof to foreign structures.
  const documents = new Map<CanonicalFlarexValueV1, CanonicalFlarexValueV1>();
  const detachDocument = (document: CanonicalFlarexValueV1) => {
    let detached = documents.get(document);
    if (detached === undefined) { detached = detachLogicalCanonicalDocument(document); documents.set(document, detached); }
    return detached;
  };
  const { changes, attempts, indexReads: _indexes, pageReads: _pages, ...rest } = input;
  // Only the private closing handoff retains immutable activity. Its existing
  // value owner authenticates issued trees and detaches every foreign value.
  // Public inspections keep their original mutable, detached JSON projections.
  const observedRows = activity === "immutable" ? Object.freeze(input.observedRows.map(row =>
    Object.freeze({ ...row, value: detachLogicalRelationalActivityJson(row.value) }))) : undefined;
  // One clone retains the exact dependency-object correlation between final
  // changes and observations. Canonical values alone use their dedicated owner.
  const detached = structuredClone({ graph: { ...rest,
    observedRows: observedRows === undefined ? rest.observedRows : [],
    changes: changes.map(change => change.kind === "deleted" ? change : { ...change, document: null }),
    attempts: attempts.map(attempt => ({ ...attempt, before: null, after: null })),
  }, originalRows: originalRows.map(row => ({ ...row, document: null })) });
  const graph: LogicalDocumentChanges = Object.freeze({ ...detached.graph,
    observedRows: observedRows ?? detached.graph.observedRows,
    changes: Object.freeze(detached.graph.changes.map((change, index) => {
      if (change.kind === "deleted") return Object.freeze(change);
      const original = changes[index];
      if (original?.kind !== "live") throw new Error("Detached logical change lost its original ordinal");
      return Object.freeze({ ...change, document: detachDocument(original.document) });
    })),
    attempts: Object.freeze(detached.graph.attempts.map((attempt, index) => {
      const original = attempts[index];
      if (original === undefined) throw new Error("Detached logical attempt lost its original ordinal");
      return Object.freeze({ ...attempt, before: original.before === null ? null : detachDocument(original.before),
        after: original.after === null ? null : detachDocument(original.after) });
    })),
    indexReads: Object.freeze(input.indexReads.map(read => Object.freeze({
      ...structuredClone({ bounds: read.bounds, entries: read.entries }), definition: read.definition,
    }))),
    pageReads: Object.freeze(input.pageReads.map(read => Object.freeze({
      ...structuredClone({ bounds: read.bounds, ...(read.after === undefined ? {} : { after: read.after }), entries: read.entries,
        isDone: read.isDone }), definition: read.definition,
    }))),
  });
  return Object.freeze({ graph, originalRows: Object.freeze(detached.originalRows.map((row, index) => {
    const original = originalRows[index];
    if (original === undefined) throw new Error("Detached logical original lost its ordinal");
    return Object.freeze({ ...row, document: detachDocument(original.document) });
  })) });
};

export const detachLogicalDocumentChanges = (input: LogicalDocumentChanges): LogicalDocumentChanges =>
  detachLogicalDocumentRootChanges(input, []).graph;
