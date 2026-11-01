/** Retained logical consumers use the shared issuer-owned diagnostic registry. */
export { retainRelationalFailure as retainLogicalRelationalFailure,
  inspectRelationalFailure as inspectLogicalRelationalFailure,
  type RelationalFailureEvidence as LogicalRelationalFailureEvidence,
  type RelationalUniqueIdentity as LogicalRelationalUniqueIdentity,
  type RelationalUniqueValue as LogicalRelationalUniqueValue } from "../../../values/relationalFailure";
