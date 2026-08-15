import type { AppSchemaEvolutionPlanV1 } from
  "@flarex/managed-schema/planning";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";

import {
  locateAppIndexDefinitionByIdEffect,
} from "./appIndexDefinitions";
import {
  advanceAppSchemaCandidateValidationEffect,
  hasAppSchemaCandidateValidationComposition,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
  type AppSchemaCandidateValidationPort,
} from "./appSchemaCandidateValidation";
import {
  advanceAppUniqueConstraintSetBackfillV1Effect,
  MAX_APP_UNIQUE_CONSTRAINT_SET_BACKFILL_PAGE_SIZE_V1,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "./appUniqueConstraintSetBuildV1";
import {
  ensureAppUniqueConstraintSetClosureV1Effect,
} from "./appUniqueConstraintSetClosureV1";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "./indexBuildReconciliation";
import { readFencedIndexBuildStateEffect } from "./indexBuildStates";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
  MAX_APP_ORDERED_INDEX_BUILD_PAGE_SIZE_V1,
} from "./intrinsicCreationTimeIndexBuildV1";
import type { ApplicationPublication } from "./applicationPublication";
import {
  hasApplicationManagedSchemaPlanningApplicationComposition,
  type ApplicationManagedSchemaPlanningPort,
} from "./applicationManagedSchemaPlanning";
import {
  type ApplicationActivationReceipt,
  type ApplicationActivationRepository,
} from "./applicationActivation";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const applicationPortBrand: unique symbol = Symbol(
  "FlarexDB/ApplicationManagedSchemaApplicationPort",
);

export interface ApplicationManagedSchemaApplicationPort {
  readonly [applicationPortBrand]: true;
}

export interface ApplicationManagedSchemaApplicationPortDependencies {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly targetDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly activation: ApplicationActivationRepository<unknown, unknown>;
  readonly candidateValidation: AppSchemaCandidateValidationPort;
  readonly planning: ApplicationManagedSchemaPlanningPort;
}

export type ApplicationManagedSchemaApplyPhase =
  | "candidateValidation"
  | "physicalBuild"
  | "uniqueConstraintBuild"
  | "activation";

export type ApplicationManagedSchemaApplyResult =
  | Readonly<{
      readonly status: "in_progress";
      readonly phase: ApplicationManagedSchemaApplyPhase;
      readonly revisionId: string;
      readonly schemaVersionId:
        AppSchemaEvolutionPlanV1["authority"]["candidateSchemaVersionId"];
      readonly planSha256Hex: string;
      readonly detail: string;
    }>
  | Readonly<{
      readonly status: "requires_remediation";
      readonly reason: "candidateValidationFailed";
      readonly revisionId: string;
      readonly schemaVersionId:
        AppSchemaEvolutionPlanV1["authority"]["candidateSchemaVersionId"];
      readonly planSha256Hex: string;
      readonly evidenceSha256Hex: string;
    }>
  | Readonly<{
      readonly status: "activated";
      readonly disposition: "inserted" | "replayed";
      readonly revisionId: string;
      readonly schemaVersionId:
        AppSchemaEvolutionPlanV1["authority"]["candidateSchemaVersionId"];
      readonly planSha256Hex: string;
      readonly activationSequence: bigint;
    }>
  | Readonly<{
      readonly status: "already_active";
      readonly revisionId: string;
      readonly schemaVersionId:
        AppSchemaEvolutionPlanV1["authority"]["candidateSchemaVersionId"];
      readonly activationSequence: bigint;
    }>;

export class ApplicationManagedSchemaApplicationError extends Data.TaggedError(
  "ApplicationManagedSchemaApplicationError",
)<{
  readonly phase: ApplicationManagedSchemaApplyPhase | "composition";
  readonly reason:
    | "invalidComposition"
    | "activeAuthorityChanged"
    | "candidateAuthorityChanged";
}> {}

export class ApplicationManagedSchemaActivationOwnerError
  extends Data.TaggedError("ApplicationManagedSchemaActivationOwnerError")<{
    readonly operation: "readActive" | "activate";
    readonly cause: unknown;
}> {}

export type ApplicationManagedSchemaApplicationOwnerError =
  | ApplicationManagedSchemaActivationOwnerError
  | Effect.Error<ReturnType<
      typeof resolveLocatedTrustedScopeAuthorityEffect
    >>
  | Effect.Error<ReturnType<
      typeof installAppSchemaCandidateValidationEffect
    >>
  | Effect.Error<ReturnType<
      typeof advanceAppSchemaCandidateValidationEffect
    >>
  | Effect.Error<ReturnType<
      typeof settleAppSchemaCandidateValidationEffect
    >>
  | Effect.Error<ReturnType<typeof reconcilePublishedIndexBuildsV1Effect>>
  | Effect.Error<ReturnType<typeof loadPublishedPhysicalRequirementSnapshotV1>>
  | Effect.Error<ReturnType<typeof readFencedIndexBuildStateEffect>>
  | Effect.Error<ReturnType<typeof locateAppIndexDefinitionByIdEffect>>
  | Effect.Error<ReturnType<typeof buildAppDeveloperOrderedIndexV1Effect>>
  | Effect.Error<ReturnType<typeof buildIntrinsicCreationTimeIndexV1Effect>>
  | Effect.Error<ReturnType<typeof ensureAppUniqueConstraintSetClosureV1Effect>>
  | Effect.Error<ReturnType<
      typeof reconcileAppUniqueConstraintSetBuildV1Effect
    >>
  | Effect.Error<ReturnType<
      typeof advanceAppUniqueConstraintSetBackfillV1Effect
    >>;

interface PortState {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly targetDb: FlarexMetadataDatabase;
  readonly authority: ApplicationManagedSchemaApplicationPortDependencies["authority"];
  readonly activation: ApplicationManagedSchemaApplicationPortDependencies["activation"];
  readonly candidateValidation: AppSchemaCandidateValidationPort;
  readonly planning: ApplicationManagedSchemaPlanningPort;
}

export interface ApplicationManagedSchemaApplyInput {
  readonly plan: AppSchemaEvolutionPlanV1;
  readonly candidatePublication: ApplicationPublication;
}

const portStates = new WeakMap<ApplicationManagedSchemaApplicationPort, PortState>();

export function createApplicationManagedSchemaApplicationPort(
  dependencies: ApplicationManagedSchemaApplicationPortDependencies,
): ApplicationManagedSchemaApplicationPort {
  const deploymentId = dependencies.deploymentId;
  const controlDb = dependencies.controlDb;
  const targetDb = dependencies.targetDb;
  const authority = dependencies.authority;
  const activation = dependencies.activation;
  const candidateValidation = dependencies.candidateValidation;
  const planning = dependencies.planning;
  const port = Object.freeze({
    [applicationPortBrand]: true as const,
  });
  if (hasApplicationManagedSchemaPlanningApplicationComposition(planning, {
    deploymentId,
    controlDb,
    activation,
    authority,
  }) && hasAppSchemaCandidateValidationComposition(
    candidateValidation,
    controlDb,
    authority,
  )) {
    portStates.set(port, Object.freeze({
      deploymentId,
      controlDb,
      targetDb,
      authority,
      activation,
      candidateValidation,
      planning,
    }));
  }
  return port;
}

export function hasApplicationManagedSchemaApplicationForPlanningPort(
  application: unknown,
  planning: ApplicationManagedSchemaPlanningPort,
): application is ApplicationManagedSchemaApplicationPort {
  if (typeof application !== "object" || application === null) return false;
  return portStates.get(application as ApplicationManagedSchemaApplicationPort)
    ?.planning === planning;
}

export const readApplicationManagedSchemaActiveCandidateEffect = Effect.fn(
  "ApplicationManagedSchemaApplication.readActiveCandidate",
)(function* (
  port: ApplicationManagedSchemaApplicationPort,
  input: ApplicationManagedSchemaApplyInput,
): Effect.fn.Return<
  Extract<
    ApplicationManagedSchemaApplyResult,
    { readonly status: "already_active" }
  > |
    null,
  | ApplicationManagedSchemaApplicationError
  | ApplicationManagedSchemaActivationOwnerError
  | Effect.Error<ReturnType<typeof resolveLocatedTrustedScopeAuthorityEffect>>
> {
  const { state } = yield* requireLocatedState(port);
  const active = yield* state.activation.readActive().pipe(
    Effect.mapError(cause => new ApplicationManagedSchemaActivationOwnerError({
      operation: "readActive",
      cause,
    })),
  );
  if (active.basis.revisionId !== input.candidatePublication.revisionId) {
    return null;
  }
  if (!candidateSchemaMatches(
    input,
    active.basis.schemaVersionId,
    encodeBytesToLowercaseHex(active.basis.schemaManifestSha256),
  )) {
    return yield* applicationFailure(
      "activation",
      "candidateAuthorityChanged",
    );
  }
  return Object.freeze({
    status: "already_active" as const,
    revisionId: input.candidatePublication.revisionId,
    schemaVersionId: input.plan.authority.candidateSchemaVersionId,
    activationSequence: active.basis.activationSequence,
  });
});

export const applyApplicationManagedSchemaPlanStepEffect = Effect.fn(
  "ApplicationManagedSchemaApplication.applyStep",
)(function* (
  port: ApplicationManagedSchemaApplicationPort,
  input: ApplicationManagedSchemaApplyInput,
): Effect.fn.Return<
  ApplicationManagedSchemaApplyResult,
  | ApplicationManagedSchemaApplicationError
  | ApplicationManagedSchemaApplicationOwnerError
> {
  const { state, located } = yield* requireLocatedState(port);
  if (input.candidatePublication.scopeId !== input.plan.authority.scopeId ||
    input.plan.authority.candidateSchemaVersionId.length === 0) {
    return yield* applicationFailure(
      "composition",
      "candidateAuthorityChanged",
    );
  }
  if (located.authority.scopeId !== input.plan.authority.scopeId) {
    return yield* applicationFailure(
      "composition",
      "invalidComposition",
    );
  }
  const validationInput = Object.freeze({
    deploymentId: state.deploymentId,
    schemaVersionId: input.plan.authority.candidateSchemaVersionId,
  });
  const installed = yield* installAppSchemaCandidateValidationEffect(
    state.candidateValidation,
    validationInput,
  );
  if (installed.head.frame.kind ===
      "app_schema_candidate_validation_failure_evidence") {
    return remediationResult(input, installed.head.frameSha256Hex);
  }
  if (installed.head.frame.kind !== "app_schema_candidate_validation_receipt") {
    const advanced = yield* advanceAppSchemaCandidateValidationEffect(
      state.candidateValidation,
      validationInput,
    );
    if (advanced.disposition === "failed") {
      return remediationResult(input, advanced.head.frameSha256Hex);
    }
    if (advanced.disposition === "readyToSettle") {
      yield* settleAppSchemaCandidateValidationEffect(
        state.candidateValidation,
        validationInput,
      );
    }
    return progressResult(
      input,
      "candidateValidation",
      advanced.disposition,
    );
  }

  const buildPorts = Object.freeze({
    controlDb: state.controlDb,
    authority: state.authority,
  });
  yield* reconcilePublishedIndexBuildsV1Effect(
    buildPorts,
    validationInput,
  );
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
    state.controlDb,
    validationInput,
  );
  if (requirements === null) {
    return yield* applicationFailure(
      "physicalBuild",
      "candidateAuthorityChanged",
    );
  }
  for (const requirement of requirements.definitions) {
    const build = yield* readFencedIndexBuildStateEffect(state.targetDb, {
      scopeId: located.authority.scopeId,
      indexDefinitionId: requirement.indexDefinitionId,
    });
    if (build.status === "current" &&
      build.buildState.lifecycle === "enabled") continue;
    const definition = yield* locateAppIndexDefinitionByIdEffect(
      state.controlDb,
      located.authority.scopeId,
      requirement.indexDefinitionId,
    );
    if (definition === null) {
      return yield* applicationFailure(
        "physicalBuild",
        "candidateAuthorityChanged",
      );
    }
    const buildInput = Object.freeze({
      deploymentId: state.deploymentId,
      indexDefinitionId: requirement.indexDefinitionId,
      pageSize: MAX_APP_ORDERED_INDEX_BUILD_PAGE_SIZE_V1,
    });
    switch (definition.access.kind) {
      case "developer": {
        const result = yield* buildAppDeveloperOrderedIndexV1Effect(
          buildPorts,
          buildInput,
        );
        return progressResult(input, "physicalBuild", result.lifecycle);
      }
      case "by_creation_time": {
        const result = yield* buildIntrinsicCreationTimeIndexV1Effect(
          buildPorts,
          buildInput,
        );
        return progressResult(input, "physicalBuild", result.lifecycle);
      }
      default:
        return assertNever(definition.access);
    }
  }

  const closure = yield* ensureAppUniqueConstraintSetClosureV1Effect(
    state.controlDb,
    validationInput,
  );
  if (closure.closure.definitionCount > 0) {
    const reconciled = yield* reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts,
      validationInput,
    );
    if (reconciled.status === "absent") {
      return progressResult(input, "uniqueConstraintBuild", "setNotClosed");
    }
    const unique = yield* advanceAppUniqueConstraintSetBackfillV1Effect(
      buildPorts,
      Object.freeze({
        ...validationInput,
        pageSize: MAX_APP_UNIQUE_CONSTRAINT_SET_BACKFILL_PAGE_SIZE_V1,
      }),
    );
    if (unique.lifecycle !== "enabled") {
      return progressResult(input, "uniqueConstraintBuild", unique.lifecycle);
    }
  }

  const active = yield* state.activation.readActive().pipe(
    Effect.mapError(cause => new ApplicationManagedSchemaActivationOwnerError({
      operation: "readActive",
      cause,
    })),
  );
  if (active.basis.schemaVersionId !==
      input.plan.authority.activeSchemaVersionId ||
    encodeBytesToLowercaseHex(active.basis.schemaManifestSha256) !==
      input.plan.authority.activeManifestSha256Hex) {
    return yield* applicationFailure(
      "activation",
      "activeAuthorityChanged",
    );
  }
  const activated = yield* state.activation.activate({
    revisionId: input.candidatePublication.revisionId,
    expectedActiveHead: active.expectedActiveHead,
  }).pipe(
    Effect.mapError(cause => new ApplicationManagedSchemaActivationOwnerError({
      operation: "activate",
      cause,
    })),
  );
  return activationReceiptResult(input, activated);
});

function requireState(
  port: ApplicationManagedSchemaApplicationPort,
): Effect.Effect<PortState, ApplicationManagedSchemaApplicationError> {
  const state = portStates.get(port);
  return state === undefined
    ? applicationFailure("composition", "invalidComposition")
    : Effect.succeed(state);
}

const requireLocatedState = Effect.fn(
  "ApplicationManagedSchemaApplication.requireLocatedState",
)(function* (
  port: ApplicationManagedSchemaApplicationPort,
): Effect.fn.Return<
  Readonly<{
    readonly state: PortState;
    readonly located: Effect.Success<ReturnType<
      typeof resolveLocatedTrustedScopeAuthorityEffect
    >>;
  }>,
  | ApplicationManagedSchemaApplicationError
  | Effect.Error<ReturnType<typeof resolveLocatedTrustedScopeAuthorityEffect>>
> {
  const state = yield* requireState(port);
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    state.deploymentId,
    state.authority,
  );
  if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, state.targetDb)) {
    return yield* applicationFailure(
      "composition",
      "invalidComposition",
    );
  }
  return Object.freeze({ state, located });
});

function progressResult(
  input: ApplicationManagedSchemaApplyInput,
  phase: ApplicationManagedSchemaApplyPhase,
  detail: string,
): Extract<ApplicationManagedSchemaApplyResult, { status: "in_progress" }> {
  return Object.freeze({
    status: "in_progress" as const,
    phase,
    revisionId: input.candidatePublication.revisionId,
    schemaVersionId: input.plan.authority.candidateSchemaVersionId,
    planSha256Hex: input.plan.planSha256Hex,
    detail,
  });
}

function remediationResult(
  input: ApplicationManagedSchemaApplyInput,
  evidenceSha256Hex: string,
): Extract<
  ApplicationManagedSchemaApplyResult,
  { status: "requires_remediation" }
> {
  return Object.freeze({
    status: "requires_remediation" as const,
    reason: "candidateValidationFailed" as const,
    revisionId: input.candidatePublication.revisionId,
    schemaVersionId: input.plan.authority.candidateSchemaVersionId,
    planSha256Hex: input.plan.planSha256Hex,
    evidenceSha256Hex,
  });
}

function activatedResult(
  input: ApplicationManagedSchemaApplyInput,
  disposition: "inserted" | "replayed",
  activationSequence: bigint,
): Extract<ApplicationManagedSchemaApplyResult, { status: "activated" }> {
  return Object.freeze({
    status: "activated" as const,
    disposition,
    revisionId: input.candidatePublication.revisionId,
    schemaVersionId: input.plan.authority.candidateSchemaVersionId,
    planSha256Hex: input.plan.planSha256Hex,
    activationSequence,
  });
}

function activationReceiptResult(
  input: ApplicationManagedSchemaApplyInput,
  receipt: ApplicationActivationReceipt,
) {
  return activatedResult(
    input,
    receipt.disposition,
    receipt.activationSequence,
  );
}

function candidateSchemaMatches(
  input: ApplicationManagedSchemaApplyInput,
  schemaVersionId: string,
  manifestSha256Hex: string,
): boolean {
  return input.plan.authority.candidateSchemaVersionId === schemaVersionId &&
    input.plan.authority.candidateManifestSha256Hex === manifestSha256Hex;
}

function applicationFailure(
  phase: ApplicationManagedSchemaApplyPhase | "composition",
  reason: ApplicationManagedSchemaApplicationError["reason"],
): Effect.Effect<never, ApplicationManagedSchemaApplicationError> {
  return Effect.fail(new ApplicationManagedSchemaApplicationError({
    phase,
    reason,
  }));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected physical index access: ${String(value)}`);
}
