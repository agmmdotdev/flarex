import type { LogicalDocumentChanges } from "./workingSet";
import type { LiveAppRowRevisionV1 } from "../appRows";

/** Detach mutable evidence while retaining the opaque located index capability
 * that the index reader authenticates by object identity. */
export const detachLogicalDocumentRootChanges = (input: LogicalDocumentChanges,
  originalRows: readonly LiveAppRowRevisionV1[]) => {
  // Clone the originals with the graph, retaining their shared canonical values.
  // Located index definitions remain their issuer's opaque capabilities.
  const detached = structuredClone({ graph: { ...input, indexReads: [], pageReads: [] }, originalRows });
  const graph: LogicalDocumentChanges = Object.freeze({ ...detached.graph,
    indexReads: Object.freeze(input.indexReads.map(read => Object.freeze({
      ...structuredClone({ bounds: read.bounds, entries: read.entries }), definition: read.definition,
    }))),
    pageReads: Object.freeze(input.pageReads.map(read => Object.freeze({
      ...structuredClone({ bounds: read.bounds, ...(read.after === undefined ? {} : { after: read.after }), entries: read.entries,
        isDone: read.isDone }), definition: read.definition,
    }))),
  });
  return Object.freeze({ graph, originalRows: Object.freeze(detached.originalRows) });
};

export const detachLogicalDocumentChanges = (input: LogicalDocumentChanges): LogicalDocumentChanges =>
  detachLogicalDocumentRootChanges(input, []).graph;
