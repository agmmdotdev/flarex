/** A bounded multi-page logical command still publishes one commit. The
 * publisher stages ordered facts in the owning transaction page by page;
 * this budget bounds the remaining duplicate-detection identities, coverage
 * callbacks and document work independently of the 128-row page limit. */
export const logicalMaterializationBatchBudget = Object.freeze({ rows: 2048, pages: 64, documentBytes: 4_194_304 });
