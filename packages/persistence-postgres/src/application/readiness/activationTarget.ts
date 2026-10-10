import {
  type LocatedReadCommittedAttemptTargetV1,
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import type { ScopePhysicalLocator } from "../../scope/scopeMetadataTypes";
import {
  Result,
  Effect,
} from "effect";
import { scopePhysicalLocatorsEqual } from "../../scope/scopePhysicalLocator";
import { getActivationServingInstallationReferencesResult } from "../../installation/installationLifecycle";
import type {
  ApplicationActivationTargetProfile,
  ApplicationActivationTargetPreparation,
  ApplicationReadinessResult,
  PreparedApplicationReadinessActivation,
} from "./contracts";
import {
  type ApplicationReadinessError,
  readinessFailureValue,
  readinessFailure,
} from "./errors";
import {
  readApplicationReadinessIssuerState,
  readIssuedApplicationReadinessState,
  registerApplicationReadinessActivation,
} from "./identity";

/** Domain construction only: the readiness issuer still authenticates its own
 * result, and the real selected runner freshly admits the activation login. */
export function selectApplicationActivationTargetResult(profile: ApplicationActivationTargetProfile,
  servingTarget: LocatedReadCommittedAttemptTargetV1, locator: ScopePhysicalLocator):
  Result.Result<ApplicationActivationTargetPreparation, ApplicationReadinessError> {
  return Result.gen(function* () {
    if (!scopePhysicalLocatorsEqual(servingTarget.physicalLocator, locator))
      return yield* Result.fail(readinessFailureValue("invalidComposition"));
    if (profile.kind === "fullProof") return Object.freeze({ target: servingTarget });
    const references = yield* getActivationServingInstallationReferencesResult(profile.installation).pipe(
      Result.mapError(cause => readinessFailureValue("invalidComposition", false, cause)));
    if (!hasLocatedReadCommittedTargetDatabaseV1(servingTarget, references.serving.database) ||
      !hasLocatedReadCommittedTargetDatabaseV1(profile.target, references.activation.database) ||
      !scopePhysicalLocatorsEqual(profile.target.physicalLocator, locator))
      return yield* Result.fail(readinessFailureValue("invalidComposition"));
    return Object.freeze({ target: profile.target, installed: references.activation });
  });
}

/** Reuses the original ready result and issuer. No serving preparation or
 * readiness graph is transferred to another database object. */
export const prepareApplicationReadinessActivation = Effect.fn("ApplicationReadiness.prepareActivation")(
  function* (repository: unknown, issued: ApplicationReadinessResult,
    profile: ApplicationActivationTargetProfile, servingTarget: LocatedReadCommittedAttemptTargetV1) {
    const owner = typeof repository === "object" && repository !== null ? readApplicationReadinessIssuerState(repository) : undefined;
    const ready = issued.status === "ready" ? readIssuedApplicationReadinessState(issued) : undefined;
    if (owner === undefined || ready?.kind !== "prepared" || ready.issuer !== owner.issuer || issued.status !== "ready")
      return yield* readinessFailure("invalidComposition");
    const target = yield* Effect.fromResult(selectApplicationActivationTargetResult(profile, servingTarget,
      ready.prepared.bundle.authority.physicalLocator));
    // SAFETY: the issuer registry alone authenticates this inert target view.
    const preparation = Object.freeze({}) as PreparedApplicationReadinessActivation;
    registerApplicationReadinessActivation(preparation, Object.freeze({ owner, issued, target }));
    return Object.freeze({ target: target.target, preparation });
  },
);
