import { Effect, Result } from "effect";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../../storage/unique/appUniqueConstraintSetBuildV1";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { captureCommerceJsonData } from "./request";
import { commerceError, commerceLimits } from "./model";
import { decodeCommerceInitialization, type CommerceInitialization } from "./initializationContract";

export interface LogicalCommerceSelectionInput {
  readonly ports: AppUniqueConstraintSetBuildPortsV1;
  readonly unique: AppUniqueConstraintSetEligibilityPortV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly source: unknown;
  readonly initialization: CommerceInitialization;
}

/** Capture configuration synchronously before any host-construction yield. */
export const captureLogicalCommerceSelection = (input: LogicalCommerceSelectionInput) => Result.gen(function* () {
  const ports = Object.freeze({ controlDb: input.ports.controlDb, authority: input.ports.authority });
  const unique = input.unique;
  const schemaVersionId = input.schemaVersionId;
  const initializationInput = { stepId: input.initialization.stepId,
    datasetSha256: input.initialization.datasetSha256, expectedRowCount: input.initialization.expectedRowCount };
  const source = yield* captureCommerceJsonData(input.source, commerceLimits.commandBytes);
  const initialization = yield* decodeCommerceInitialization(initializationInput)
    .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
  return Object.freeze({ ports, unique, schemaVersionId, source: source.value, initialization });
});

export type CapturedLogicalCommerceSelection = Result.Result.Success<ReturnType<typeof captureLogicalCommerceSelection>>;

export const prepareLogicalCommerceContract = Effect.fn("LogicalCommerce.prepareContract")(function* (
  selection: CapturedLogicalCommerceSelection,
) {
  return yield* capturePrivateCanonicalValue({ format: "flarex.logical-commerce-contract", version: 1,
    schemaVersionId: selection.schemaVersionId, source: selection.source, initialization: selection.initialization,
  }, commerceLimits.commandBytes, { invalidInput: () => commerceError("invalidInput"),
    hashFailure: cause => commerceError("resourceFailure", cause) });
});
