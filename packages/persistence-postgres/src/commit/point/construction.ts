/** Trusted construction; operation bodies remain with their settlement owners. */
import {
  type ApplicationRelationCommitPort,
  hasApplicationRelationCommitAuthorityForPointCommit,
} from "../../application/relations/applicationRelationCommit";
import {
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/transactionSessionActivation";
import {
  type AppDeveloperIndexDefinitionPortV1,
} from "../../storage/indexes/appDeveloperIndexCommitV1";
import {
  type AppUniqueConstraintDefinitionPortV1,
  hasAppUniqueConstraintDefinitionAuthorityV1,
} from "../../storage/unique/appUniqueConstraintCommitV1";
import {
  type AppUniqueConstraintSetEligibilityPortV1,
  hasAppUniqueConstraintSetEligibilityPortV1,
  hasAppUniqueConstraintSetEligibilityForDefinitionPortV1,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import {
  type PointCommitTransactionProofOptionsV1,
  type PointMutationAttemptReplacementOptionsV1,
} from "./constructionContracts";
import {
  type PointCommitFinishingTransitionPortV1,
  type PointMutationAttemptReplacementPortV1,
  type RunningRelationConflictAttemptReplacementPortV1,
  type RunningRelationConflictRecoveryPort,
  type PointFiniteAttemptReplacementPort,
  type PointCommitRollbackProofPortV1,
  type PointCommitPublisherPortV1,
  type PointCommitOutcomeResolutionPortV1,
  type PointFiniteCommitPublisherPort,
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
} from "./contracts";
import {
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import {
  PointMutationAttemptReplacementConfigurationV1Error,
} from "./errors";
import {
  capturePointCommitTransactionProofOptionsV1,
} from "./capture";
import {
  type StoredCommitAuthorityEvidenceLoaderPortsV1,
} from "../authority/postgresLoader";
import {
  hasApplicationDocumentOrderedIndexComposition,
} from "../../storage/materialization/indexComposition";
import {
  createFinitePublisherOperations,
} from "./finitePublication";
import {
  registerApplicationRelationMaintenance,
  registerDeveloperIndexMaintenance,
  registerUniqueConstraintMaintenance,
  registerUniqueConstraintEligibility,
  registerFinitePointCommitPublisher,
} from "./capabilities";
import {
  bindPointCommitFinishingTransition,
} from "./finishing";
import {
  bindPointCommitRollbackProof,
} from "./rollbackProof";
import {
  bindPointMutationAttemptReplacement,
} from "./replacement";
import {
  bindRunningRelationConflictReplacementAndRecovery,
} from "./relationRecovery";
import {
  bindPointCommitPublication,
} from "./durablePublication";

function registerPointCommitApplicationRelationMaintenance<T extends PointCommitRollbackProofPortV1>(
  port: T,
  applicationRelations: ApplicationRelationCommitPort | undefined,
  pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1,
): T {
  if (hasApplicationRelationCommitAuthorityForPointCommit(
    applicationRelations,
    pointCommitAuthority,
  )) {
    registerApplicationRelationMaintenance(port);
  }
  return port;
}

function registerPointCommitDeveloperIndexMaintenanceV1<T extends PointCommitRollbackProofPortV1>(
  port: T,
  developerIndexes: AppDeveloperIndexDefinitionPortV1 | undefined,
): T {
  if (developerIndexes !== undefined) {
    registerDeveloperIndexMaintenance(port);
  }
  return port;
}

function registerPointCommitUniqueConstraintMaintenanceV1<T extends PointCommitRollbackProofPortV1>(
  port: T,
  uniqueConstraints: AppUniqueConstraintDefinitionPortV1 | undefined,
): T {
  if (hasAppUniqueConstraintDefinitionAuthorityV1(uniqueConstraints)) {
    registerUniqueConstraintMaintenance(port);
  }
  return port;
}

function registerPointCommitUniqueConstraintEligibilityV1<T extends PointCommitRollbackProofPortV1>(
  port: T,
  uniqueConstraints: AppUniqueConstraintDefinitionPortV1 | undefined,
  eligibility: AppUniqueConstraintSetEligibilityPortV1 | undefined,
): T {
  if (
    hasAppUniqueConstraintDefinitionAuthorityV1(uniqueConstraints) &&
    hasAppUniqueConstraintSetEligibilityPortV1(eligibility) &&
    hasAppUniqueConstraintSetEligibilityForDefinitionPortV1(
      eligibility,
      uniqueConstraints,
    )
  ) registerUniqueConstraintEligibility(port, eligibility);
  return port;
}

export function createPointCommitFinishingTransitionPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitFinishingTransitionPortV1 {
  const enterFinishing = bindPointCommitFinishingTransition(ports, options);

  return Object.freeze({ enterFinishing });
}

export function createPointMutationAttemptReplacementPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointMutationAttemptReplacementOptionsV1,
): PointMutationAttemptReplacementPortV1 &
  RunningRelationConflictAttemptReplacementPortV1 &
  RunningRelationConflictRecoveryPort & PointFiniteAttemptReplacementPort {
  if (!isPositiveSafeInteger(options.leaseDurationMilliseconds)) {
    throw new PointMutationAttemptReplacementConfigurationV1Error(
      "leaseDurationInvalid",
    );
  }
  const executionClaimDurationMilliseconds =
    options.executionClaimDurationMilliseconds ??
      options.leaseDurationMilliseconds;
  if (!isPositiveSafeInteger(executionClaimDurationMilliseconds)) {
    throw new PointMutationAttemptReplacementConfigurationV1Error(
      "executionClaimDurationInvalid",
    );
  }
  const randomExecutionClaimOwner = options.randomExecutionClaimOwner ??
    (() => crypto.randomUUID());
  const proofOptions = capturePointCommitTransactionProofOptionsV1({
    ...(options.observeQuery === undefined ? {} : { observeQuery: options.observeQuery }),
    ...(options.logicalOperationProfiles === undefined ? {} :
      { logicalOperationProfiles: options.logicalOperationProfiles }),
  });

  const attemptReplacement = bindPointMutationAttemptReplacement(
    ports,
    options,
    proofOptions,
    randomExecutionClaimOwner,
    executionClaimDurationMilliseconds,
  );
  const replace = attemptReplacement.replace;

  const relationReplacement = bindRunningRelationConflictReplacementAndRecovery(
    ports,
    options,
    proofOptions,
    randomExecutionClaimOwner,
    executionClaimDurationMilliseconds,
  );
  const replaceRunningRelationConflict = relationReplacement.replaceRunningRelationConflict;

  const recoverRunningRelationConflict = relationReplacement.recoverRunningRelationConflict;

  return Object.freeze({
    replace,
    replaceFinite: attemptReplacement.replaceFinite,
    replaceRecoveredFinite: attemptReplacement.replaceRecoveredFinite,
    replaceRunningRelationConflict,
    recoverRunningRelationConflict,
  });
}

export function createPointCommitRollbackProofPortV1(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitRollbackProofPortV1 {
  const capturedOptions = capturePointCommitTransactionProofOptionsV1(options);
  const hasOrderedIndexes = hasApplicationDocumentOrderedIndexComposition(
    ports.applicationControlDb,
    capturedOptions,
  );
  const prove = bindPointCommitRollbackProof(ports, capturedOptions, hasOrderedIndexes);

  return registerPointCommitApplicationRelationMaintenance(
    registerPointCommitUniqueConstraintEligibilityV1(
      registerPointCommitUniqueConstraintMaintenanceV1(
        registerPointCommitDeveloperIndexMaintenanceV1(
          Object.freeze({ prove }),
          capturedOptions.developerIndexes,
        ),
        capturedOptions.uniqueConstraints,
      ),
      capturedOptions.uniqueConstraints,
      capturedOptions.uniqueConstraintEligibility,
    ),
    capturedOptions.applicationRelations,
    ports,
  );
}

export function createPointCommitPublisherPortV1(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1 & PointFiniteCommitPublisherPort {
  const capturedOptions = capturePointCommitTransactionProofOptionsV1(options);
  const finiteOperations = createFinitePublisherOperations(ports, capturedOptions);
  const hasOrderedIndexes = hasApplicationDocumentOrderedIndexComposition(
    ports.applicationControlDb,
    capturedOptions,
  );
  const rollback = createPointCommitRollbackProofPortV1(ports, capturedOptions);

  const publication = bindPointCommitPublication(ports, capturedOptions, hasOrderedIndexes);
  const publish = publication.publish;

  const resolvePointCommitOutcome = publication[RESOLVE_POINT_COMMIT_OUTCOME_V1];

  const port = registerPointCommitApplicationRelationMaintenance(
    registerPointCommitUniqueConstraintEligibilityV1(
      registerPointCommitUniqueConstraintMaintenanceV1(
        registerPointCommitDeveloperIndexMaintenanceV1(Object.freeze({
          ...rollback,
          publish,
          publishFinite: finiteOperations.publishFinite,
          resolveFinite: finiteOperations.resolveFinite,
          [RESOLVE_POINT_COMMIT_OUTCOME_V1]: resolvePointCommitOutcome,
        }), capturedOptions.developerIndexes),
        capturedOptions.uniqueConstraints,
      ),
      capturedOptions.uniqueConstraints,
      capturedOptions.uniqueConstraintEligibility,
    ),
    capturedOptions.applicationRelations,
    ports,
  );
  registerFinitePointCommitPublisher(port);
  return port;
}

export type {
  PointCommitTransactionProofStepV1,
  PointCommitTransactionProofOptionsV1,
  PointMutationAttemptReplacementProofStepV1,
  PointMutationAttemptReplacementOptionsV1,
} from "./constructionContracts";
