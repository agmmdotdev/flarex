import { Effect } from "effect";
import { linkWorkflowModels } from "@medusajs/link-modules";
import { compileDmlMetadata } from "../schema/compile";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Native DML owns both protocol tables. Neither table references the rich
 * Link row: a physical Link delete must retain receipts and revisions. */
export const captureLinkOperationMetadata = Effect.fn("LinkOperations.captureMetadata")(function* () {
  const compiled = yield* compileDmlMetadata(linkWorkflowModels, cause => commerceError("unsupportedProfile", cause));
  if (compiled.tables.length !== 2 ||
    new Set(compiled.tables.map(table => table.name)).size !== 2 ||
    compiled.tables.some(table => !["link_workflow_operation", "link_pair_revision"].includes(table.name) ||
      table.relationships.length !== 0 || table.foreignKeys.length !== 0 ||
      table.cascades.delete.length !== 0 || table.cascades.detach.length !== 0))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause) });
});
