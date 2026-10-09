import { Effect } from "effect";
import {
  loadAppUniqueConstraintSetEligibilityV1Effect,
  hasAppUniqueConstraintSetEligibilityCompositionV1,
  loadAppUniqueConstraintSetEligibilityForReadinessV1Effect,
  prepareAppUniqueConstraintSet,
  acceptPreparedAppUniqueConstraintSet,
  validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import type {
  AppUniqueConstraintSetEligibilityInputV1,
  AppUniqueConstraintSetEligibilityResultV1,
  AppUniqueConstraintSetPreparation,
  AppUniqueConstraintSetEligibilityEvidenceV1,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import { PointCommitUniqueConstraintEligibilityUnavailableV1Error } from "./errors";
import type {
  LoadPointCommitUniqueConstraintEligibilityV1Error,
  ValidatePointCommitUniqueConstraintEligibilityV1Error,
} from "./errors";
import { findPointCommitUniqueConstraintEligibility } from "./capabilities";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type {
  TrustedScopeAuthorityResolutionPorts,
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { ScopeClockRecord } from "../../scope/scopeClock";

export const loadPointCommitUniqueConstraintEligibilityV1Effect = Effect.fn(
  "PointCommitTransaction.loadUniqueConstraintEligibility",
)(function* (
  value: unknown,
  input: AppUniqueConstraintSetEligibilityInputV1,
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  LoadPointCommitUniqueConstraintEligibilityV1Error
> {
  const eligibility =
    typeof value === "object" && value !== null
      ? findPointCommitUniqueConstraintEligibility(value)
      : undefined;
  if (eligibility === undefined) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
        reason: "notSameFactory",
      }),
    );
  }
  return yield* loadAppUniqueConstraintSetEligibilityV1Effect(
    eligibility,
    input,
  );
});

export const loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect =
  Effect.fn(
    "PointCommitTransaction.loadUniqueConstraintEligibilityForReadiness",
  )(function* (
    value: unknown,
    input: AppUniqueConstraintSetEligibilityInputV1,
    controlDb: FlarexMetadataDatabase,
    authority: TrustedScopeAuthorityResolutionPorts,
  ): Effect.fn.Return<
    AppUniqueConstraintSetEligibilityResultV1,
    LoadPointCommitUniqueConstraintEligibilityV1Error
  > {
    const eligibility =
      typeof value === "object" && value !== null
        ? findPointCommitUniqueConstraintEligibility(value)
        : undefined;
    if (
      eligibility === undefined ||
      !hasAppUniqueConstraintSetEligibilityCompositionV1(
        eligibility,
        controlDb,
        authority,
      )
    ) {
      return yield* Effect.fail(
        new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
          reason:
            eligibility === undefined
              ? "notSameFactory"
              : "compositionMismatch",
        }),
      );
    }
    return yield* loadAppUniqueConstraintSetEligibilityForReadinessV1Effect(
      eligibility,
      input,
    );
  });

export const preparePointCommitUniqueConstraintSet = Effect.fn(
  "PointCommitTransaction.prepareUniqueConstraintSet"
)(function* (
  value: unknown,
  input: AppUniqueConstraintSetEligibilityInputV1,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts
) {
  const eligibility =
    typeof value === "object" && value !== null
      ? findPointCommitUniqueConstraintEligibility(value)
      : undefined;
  if (
    eligibility === undefined ||
    !hasAppUniqueConstraintSetEligibilityCompositionV1(
      eligibility,
      controlDb,
      authority
    )
  ) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
        reason:
          eligibility === undefined ? "notSameFactory" : "compositionMismatch"
      })
    );
  }
  return yield* prepareAppUniqueConstraintSet(eligibility, input);
},);

export const acceptPreparedPointCommitUniqueConstraintSet = Effect.fn(
  "PointCommitTransaction.acceptPreparedUniqueConstraintSet"
)(function* (
  value: unknown,
  preparation: AppUniqueConstraintSetPreparation,
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord
) {
  const eligibility =
    typeof value === "object" && value !== null
      ? findPointCommitUniqueConstraintEligibility(value)
      : undefined;
  if (eligibility === undefined)
    return yield* Effect.fail(
      new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
        reason: "notSameFactory"
      })
    );
  return yield* acceptPreparedAppUniqueConstraintSet(
    eligibility,
    preparation,
    tx,
    authority,
    clock
  );
},);

export const validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect =
  Effect.fn(
    "PointCommitTransaction.validateUniqueConstraintEligibilityInTransaction",
  )(function* (
    value: unknown,
    tx: AppRowTransaction,
    evidence: AppUniqueConstraintSetEligibilityEvidenceV1,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
  ): Effect.fn.Return<
    AppUniqueConstraintSetEligibilityResultV1,
    ValidatePointCommitUniqueConstraintEligibilityV1Error
  > {
    const eligibility =
      typeof value === "object" && value !== null
        ? findPointCommitUniqueConstraintEligibility(value)
        : undefined;
    if (eligibility === undefined) {
      return yield* Effect.fail(
        new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
          reason: "notSameFactory",
        }),
      );
    }
    return yield* validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect(
      tx,
      eligibility,
      evidence,
      authority,
      clock,
    );
  });
