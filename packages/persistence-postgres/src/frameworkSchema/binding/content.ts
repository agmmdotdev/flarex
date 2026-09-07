import { readApplicationSelectionOwnershipInTransaction, type ApplicationActiveSelection } from "../../applicationActivation";
import { Effect } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { ApplicationWriteOwnershipHistoryBudget } from "../../applicationWriteOwnership/Policy";
import { sameBindingValue } from "./canonical";
import { bindingError } from "./errors";
import type { DataBindingSetFrame } from "./model";

/** Called only after the binding host has pinned the Application under its scope lock. */
export const verifyPayloadContentBinding = Effect.fn("DataBindingContent.verify")(
  function* (tx: FlarexMetadataTransaction, frame: DataBindingSetFrame, selection: ApplicationActiveSelection) {
    const content = frame.payloadContent;
    if (content === null) return;
    if (
      frame.application.readiness.kind !== "policy" ||
      frame.application.readiness.relationCount > 1 ||
      !sameBindingValue(content.application, frame.application)
    ) {
      return yield* Effect.fail(bindingError("unsupportedProfile"));
    }
    const { ownership } = yield* readApplicationSelectionOwnershipInTransaction(
      selection, tx,
      ScopeIdSchema.make(frame.application.scopeId),
      new ApplicationWriteOwnershipHistoryBudget(),
    ).pipe(Effect.mapError(cause => bindingError(
      cause.reason === "resourceFailure" ? "resourceFailure" : "invalidAuthority",
      cause,
    )));
    if (
      ownership === null ||
      ownership.sha256Hex !== frame.application.readiness.writeOwnershipSha256 ||
      ownership.frame.writePolicySetSha256 !== frame.application.readiness.writePolicySetSha256 ||
      ownership.frame.claims.length === 0 ||
      content.tables.length !== ownership.frame.claims.length
    ) {
      return yield* Effect.fail(bindingError("invalidAuthority"));
    }
    for (const [ordinal, claim] of ownership.frame.claims.entries()) {
      const table = content.tables[ordinal];
      if (
        claim.policy.owner !== "payload" ||
        claim.policy.configSha256 !== content.configSha256 ||
        claim.policy.provenanceSha256 !== content.provenanceSha256 ||
        table?.tableId !== claim.policy.tableId.toString() ||
        table.writePolicySha256 !== claim.policy.writePolicySha256
      ) {
        return yield* Effect.fail(bindingError("invalidAuthority"));
      }
    }
  },
);
