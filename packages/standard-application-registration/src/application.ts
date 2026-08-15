import {
  MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1,
  planAppSchemaEvolutionV1Effect,
  AppSchemaEvolutionPlanningV1Error,
  type AppSchemaEvolutionPlanV1,
  type AppSchemaRenameIntentV1,
} from "@flarex/managed-schema/planning";
import {
  applyApplicationManagedSchemaPlanStepEffect,
  hasApplicationManagedSchemaApplicationForPlanningPort,
  readApplicationManagedSchemaActiveCandidateEffect,
  type ApplicationManagedSchemaApplicationError,
  type ApplicationManagedSchemaApplicationOwnerError,
  type ApplicationManagedSchemaApplicationPort,
  type ApplicationManagedSchemaApplyResult,
} from
  "@flarex/persistence-postgres/internal/application-managed-schema-application";
import {
  loadApplicationManagedSchemaPlanningSnapshot,
  type ApplicationManagedSchemaPlanningPort,
  type LoadApplicationManagedSchemaPlanningSnapshotError,
} from
  "@flarex/persistence-postgres/internal/application-managed-schema-planning";
import type { ApplicationPublication } from
  "@flarex/persistence-postgres/internal/application-publication";
import { Context, Data, Effect, Layer, Result } from "effect";

declare const preparedApplicationManagedSchemaPlanBrand: unique symbol;

/**
 * Process-local preparation authority for the later exact-plan apply owner.
 * The canonical plan remains inspectable data; only this handle can authorize
 * the future M04-B continuation.
 */
export interface PreparedApplicationManagedSchemaPlan {
  readonly [preparedApplicationManagedSchemaPlanBrand]: true;
}

export interface PrepareApplicationManagedSchemaPlanInput {
  readonly candidatePublication: ApplicationPublication;
  readonly renameIntents?: ReadonlyArray<AppSchemaRenameIntentV1>;
}

export interface PreparedApplicationManagedSchemaPlanResult {
  readonly prepared: PreparedApplicationManagedSchemaPlan;
  readonly plan: AppSchemaEvolutionPlanV1;
  readonly planSha256Hex: string;
}

export class ApplicationManagedSchemaPlanCompositionError
  extends Data.TaggedError("ApplicationManagedSchemaPlanCompositionError")<{
    readonly reason: "invalidPreparedPlan" | "differentPlanningPort";
  }> {}

export class ApplicationManagedSchemaApplyError
  extends Data.TaggedError("ApplicationManagedSchemaApplyError")<{
    readonly reason: "invalidComposition" | "stalePlan";
  }> {}

export type PrepareApplicationManagedSchemaPlanError =
  | LoadApplicationManagedSchemaPlanningSnapshotError
  | AppSchemaEvolutionPlanningV1Error;

export interface ApplicationManagedSchemaPlanningApi {
  readonly prepare: (
    input: PrepareApplicationManagedSchemaPlanInput,
  ) => Effect.Effect<
    PreparedApplicationManagedSchemaPlanResult,
    PrepareApplicationManagedSchemaPlanError
  >;
}

export interface ApplyApplicationManagedSchemaPlanInput {
  readonly prepared: PreparedApplicationManagedSchemaPlan;
}

export type ApplyApplicationManagedSchemaPlanResult =
  | Readonly<{
      readonly status: "blocked";
      readonly reason: "planBlocked";
      readonly planSha256Hex: string;
    }>
  | ApplicationManagedSchemaApplyResult;

export type ApplyApplicationManagedSchemaPlanError =
  | ApplicationManagedSchemaPlanCompositionError
  | ApplicationManagedSchemaApplyError
  | ApplicationManagedSchemaApplicationError
  | ApplicationManagedSchemaApplicationOwnerError
  | LoadApplicationManagedSchemaPlanningSnapshotError
  | AppSchemaEvolutionPlanningV1Error;

export interface ApplicationManagedSchemaApplicationApi {
  readonly apply: (
    input: ApplyApplicationManagedSchemaPlanInput,
  ) => Effect.Effect<
    ApplyApplicationManagedSchemaPlanResult,
    ApplyApplicationManagedSchemaPlanError
  >;
}

export class ApplicationManagedSchemaPlanning extends Context.Service<
  ApplicationManagedSchemaPlanning,
  ApplicationManagedSchemaPlanningApi
>()("flarex/standard-application-registration/ApplicationManagedSchemaPlanning") {}

export class ApplicationManagedSchemaApplication extends Context.Service<
  ApplicationManagedSchemaApplication,
  ApplicationManagedSchemaApplicationApi
>()("flarex/standard-application-registration/ApplicationManagedSchemaApplication") {}

interface PreparedPlanState {
  readonly port: ApplicationManagedSchemaPlanningPort;
  readonly plan: AppSchemaEvolutionPlanV1;
  readonly candidatePublication: ApplicationPublication;
}

export interface PreparedApplicationManagedSchemaPlanAuthority {
  readonly plan: AppSchemaEvolutionPlanV1;
  readonly candidatePublication: ApplicationPublication;
}

const preparedPlanStates = new WeakMap<
  PreparedApplicationManagedSchemaPlan,
  PreparedPlanState
>();

export const prepareApplicationManagedSchemaPlan = Effect.fn(
  "ApplicationManagedSchemaPlanning.prepare",
)(function* (
  input: PrepareApplicationManagedSchemaPlanInput,
): Effect.fn.Return<
  PreparedApplicationManagedSchemaPlanResult,
  PrepareApplicationManagedSchemaPlanError,
  ApplicationManagedSchemaPlanning
> {
  const service = yield* ApplicationManagedSchemaPlanning;
  return yield* service.prepare(input);
});

export const applyApplicationManagedSchemaPlan = Effect.fn(
  "ApplicationManagedSchemaApplication.apply",
)(function* (
  input: ApplyApplicationManagedSchemaPlanInput,
): Effect.fn.Return<
  ApplyApplicationManagedSchemaPlanResult,
  ApplyApplicationManagedSchemaPlanError,
  ApplicationManagedSchemaApplication
> {
  const service = yield* ApplicationManagedSchemaApplication;
  return yield* service.apply(input);
});

export function makeApplicationManagedSchemaPlanningLayer(
  port: ApplicationManagedSchemaPlanningPort,
): Layer.Layer<ApplicationManagedSchemaPlanning> {
  return Layer.succeed(
    ApplicationManagedSchemaPlanning,
    ApplicationManagedSchemaPlanning.of({
      prepare: makePrepare(port),
    }),
  );
}

export function makeApplicationManagedSchemaApplicationLayer(
  planning: ApplicationManagedSchemaPlanningPort,
  application: ApplicationManagedSchemaApplicationPort,
): Layer.Layer<ApplicationManagedSchemaApplication> {
  return Layer.succeed(
    ApplicationManagedSchemaApplication,
    ApplicationManagedSchemaApplication.of({
      apply: makeApply(planning, application),
    }),
  );
}

export function claimPreparedApplicationManagedSchemaPlanResult(
  prepared: unknown,
  port: ApplicationManagedSchemaPlanningPort,
): Result.Result<
  PreparedApplicationManagedSchemaPlanAuthority,
  ApplicationManagedSchemaPlanCompositionError
> {
  if (typeof prepared !== "object" || prepared === null) {
    return Result.fail(new ApplicationManagedSchemaPlanCompositionError({
      reason: "invalidPreparedPlan",
    }));
  }
  const state = preparedPlanStates.get(
    prepared as PreparedApplicationManagedSchemaPlan,
  );
  if (state === undefined) {
    return Result.fail(new ApplicationManagedSchemaPlanCompositionError({
      reason: "invalidPreparedPlan",
    }));
  }
  return state.port === port
    ? Result.succeed(Object.freeze({
        plan: state.plan,
        candidatePublication: state.candidatePublication,
      }))
    : Result.fail(new ApplicationManagedSchemaPlanCompositionError({
        reason: "differentPlanningPort",
      }));
}

function makePrepare(
  port: ApplicationManagedSchemaPlanningPort,
): ApplicationManagedSchemaPlanningApi["prepare"] {
  return Effect.fn("ApplicationManagedSchemaPlanning.prepareLive")(
    function* (input: PrepareApplicationManagedSchemaPlanInput) {
      const candidatePublication = input.candidatePublication;
      const renameIntents = yield* snapshotRenameIntentsEffect(
        input.renameIntents,
      );
      const snapshot = yield* loadApplicationManagedSchemaPlanningSnapshot(
        port,
        candidatePublication,
      );
      const plan = yield* planAppSchemaEvolutionV1Effect({
        ...snapshot,
        ...(renameIntents === undefined
          ? {}
          : { renameIntents }),
      });
      const prepared = Object.freeze({}) as PreparedApplicationManagedSchemaPlan;
      preparedPlanStates.set(prepared, Object.freeze({
        port,
        plan,
        candidatePublication,
      }));
      return Object.freeze({
        prepared,
        plan,
        planSha256Hex: plan.planSha256Hex,
      });
    },
  );
}

function makeApply(
  planning: ApplicationManagedSchemaPlanningPort,
  application: ApplicationManagedSchemaApplicationPort,
): ApplicationManagedSchemaApplicationApi["apply"] {
  return Effect.fn("ApplicationManagedSchemaApplication.applyLive")(
    function* (input: ApplyApplicationManagedSchemaPlanInput) {
      if (!hasApplicationManagedSchemaApplicationForPlanningPort(
        application,
        planning,
      )) {
        return yield* Effect.fail(new ApplicationManagedSchemaApplyError({
          reason: "invalidComposition",
        }));
      }
      const authority = yield* Effect.fromResult(
        claimPreparedApplicationManagedSchemaPlanResult(
          input.prepared,
          planning,
        ),
      );
      if (authority.plan.disposition === "blocked") {
        return Object.freeze({
          status: "blocked" as const,
          reason: "planBlocked" as const,
          planSha256Hex: authority.plan.planSha256Hex,
        });
      }
      const applyInput = Object.freeze({
        plan: authority.plan,
        candidatePublication: authority.candidatePublication,
      });
      const activeCandidate = yield*
        readApplicationManagedSchemaActiveCandidateEffect(
          application,
          applyInput,
        );
      if (activeCandidate !== null) return activeCandidate;
      const snapshot = yield* loadApplicationManagedSchemaPlanningSnapshot(
        planning,
        authority.candidatePublication,
      );
      const recomputed = yield* planAppSchemaEvolutionV1Effect({
        ...snapshot,
        renameIntents: authority.plan.resolvedRenames,
      });
      if (recomputed.planSha256Hex !== authority.plan.planSha256Hex) {
        return yield* Effect.fail(new ApplicationManagedSchemaApplyError({
          reason: "stalePlan",
        }));
      }
      return yield* applyApplicationManagedSchemaPlanStepEffect(
        application,
        applyInput,
      );
    },
  );
}

function snapshotRenameIntentsEffect(
  input: ReadonlyArray<AppSchemaRenameIntentV1> | undefined,
): Effect.Effect<
  ReadonlyArray<AppSchemaRenameIntentV1> | undefined,
  AppSchemaEvolutionPlanningV1Error
> {
  return Effect.suspend(() => {
    if (input === undefined) return Effect.succeed(undefined);
    // The pure planner owns detailed validation. This cheap ceiling prevents
    // an unbounded caller-owned copy before the first asynchronous plan read.
    if (input.length > MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1) {
      return Effect.fail(new AppSchemaEvolutionPlanningV1Error({
        issue: {
          reason: "limitExceeded",
          dimension: "renameIntents",
          observed: input.length,
          maximum: MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1,
        },
      }));
    }
    return Effect.succeed(
      Object.freeze(input.map(intent => Object.freeze({ ...intent }))),
    );
  });
}
