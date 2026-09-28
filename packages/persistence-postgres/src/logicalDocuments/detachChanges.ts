import type { LogicalDocumentChanges } from "./workingSet";

/** Detach mutable evidence while retaining the opaque located index capability
 * that the index reader authenticates by object identity. */
export const detachLogicalDocumentChanges = (input: LogicalDocumentChanges): LogicalDocumentChanges => {
  const detached = structuredClone({ ...input, indexReads: [], pageReads: [] });
  return Object.freeze({ ...detached,
    indexReads: Object.freeze(input.indexReads.map(read => Object.freeze({
      ...structuredClone({ bounds: read.bounds, entries: read.entries }), definition: read.definition,
    }))),
    pageReads: Object.freeze(input.pageReads.map(read => Object.freeze({
      ...structuredClone({ bounds: read.bounds, ...(read.after === undefined ? {} : { after: read.after }), entries: read.entries,
        isDone: read.isDone }), definition: read.definition,
    }))),
  });
};
