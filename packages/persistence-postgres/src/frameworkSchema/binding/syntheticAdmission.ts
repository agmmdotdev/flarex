import { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type { TrustedScopeAuthority } from "../../scopeAuthorityResolution";
import type { FrameworkSchemaTargetSnapshot } from "../target";
import { lockScopeClockForUpdateInTransactionEffect } from "../../scopeClock";
import { captureBindingValue, isSyntheticBindingReference } from "./canonical";
import { bindingError } from "./errors";
import { lockBindingInstallation } from "./evidence";
import type { InstallationBindingReference } from "./model";
import { isExactPrivateValueRecord } from "../privateStoredValueShape";

export const captureSyntheticBindingReference = Effect.fn(
  "SyntheticBinding.capture",
)((reference: unknown) =>
  captureBindingValue(
    {
      format: "flarex.synthetic-test-selection",
      version: 1,
      reference,
    },
    isSyntheticFrame,
  ).pipe(Effect.map((value) => value.frame.reference)),
);

/** Binding-owned validation on the consumer owner's actual accepting transaction. */
export const admitSyntheticBindingInTransaction = Effect.fn(
  "SyntheticBinding.admit",
)(function* (
  tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority,
  target: FrameworkSchemaTargetSnapshot,
  reference: InstallationBindingReference,
) {
  if (reference.installation.artifact.owner !== "system")
    return yield* Effect.fail(bindingError("invalidAuthority"));
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (
    clock.scopeId !== authority.scopeId ||
    clock.storageGeneration !== authority.storageGeneration ||
    clock.storageGenerationFence !== authority.storageGenerationFence ||
    clock.epoch !== authority.epoch
  )
    return yield* Effect.fail(bindingError("staleScope"));
  return yield* lockBindingInstallation(tx, reference, target);
});

function isSyntheticFrame(input: unknown): input is Readonly<{
  format: "flarex.synthetic-test-selection";
  version: 1;
  reference: InstallationBindingReference;
}> &
  JsonObject {
  return (
    isExactPrivateValueRecord(input, ["format", "version", "reference"]) &&
    input.format === "flarex.synthetic-test-selection" &&
    input.version === 1 &&
    isSyntheticBindingReference(input.reference)
  );
}
