import type {
  CatchUpTurnBudget,
  CatchUpTurnOutcome,
} from "@flarex/query-sync/internal/orchestration";
import type {
  CaughtUpChangeAuthority,
} from "@flarex/query-sync/internal/change";
import { Data, Effect, Result, Schema } from "effect";
import {
  ScopeSyncActiveHeadObservationV1Schema,
  type ScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";

import type { Env } from "../types";
import type { ExecutorHttpEnv } from "../executorHttp";
import {
  captureDeploymentQuerySyncBinding,
  type DeploymentQuerySyncBindingError,
  issueDeploymentQuerySyncFreshInitializationForIsolatedProbe,
} from "./Binding";
import {
  runDeploymentSyncCatchUpTurn,
  type DeploymentSyncCatchUpTurnError,
} from "./CatchUpHost";
import type { DeploymentQuerySyncStorage } from "./StorageContract";

const STRICT_STRUCT_OPTIONS = Object.freeze({
  parseOptions: { onExcessProperty: "error" as const },
});
const STRICT_PARSE_OPTIONS = Object.freeze({
  onExcessProperty: "error" as const,
});

const CatchUpTurnBudgetSchema = Schema.Struct({
  sourceReads: Schema.Number,
  admittedBatches: Schema.Number,
  sourceTransportBytes: Schema.Number,
  modelSemanticWorkUnits: Schema.Number,
  modelSemanticBytes: Schema.Number,
  dependencyKeyExaminations: Schema.Number,
  canonicalDependencyBytes: Schema.Number,
  newWorkWindowMilliseconds: Schema.Number,
}).annotate(STRICT_STRUCT_OPTIONS);

const DeploymentSyncCatchUpProbeRequestSchema = Schema.Struct({
  authorizationToken: Schema.String,
  observation: ScopeSyncActiveHeadObservationV1Schema,
  budget: CatchUpTurnBudgetSchema,
  authorizeFreshInitialization: Schema.Boolean,
}).annotate(STRICT_STRUCT_OPTIONS);

interface DecodedDeploymentSyncCatchUpProbeRequest {
  readonly authorizationToken: string;
  readonly observation: ScopeSyncActiveHeadObservationV1;
  readonly budget: CatchUpTurnBudget;
  readonly authorizeFreshInitialization: boolean;
}

const decodeUnknownProbeRequest = Schema.decodeUnknownEffect(
  DeploymentSyncCatchUpProbeRequestSchema,
  STRICT_PARSE_OPTIONS,
);

export class DeploymentSyncCatchUpProbeRequestError extends Data.TaggedError(
  "DeploymentSyncCatchUpProbeRequestError",
)<{
  readonly reason: "invalidRequest";
  readonly cause: Schema.SchemaError;
}> {}

export class DeploymentSyncCatchUpProbeAuthorizationError
  extends Data.TaggedError("DeploymentSyncCatchUpProbeAuthorizationError")<{
    readonly reason: "probeDisabled" | "unauthorized";
  }> {}

type DeploymentSyncCatchUpProbeAuthority = Pick<
  CaughtUpChangeAuthority,
  | "namespaceId"
  | "syncModelId"
  | "sourceEpoch"
  | "readThroughSequence"
  | "authorityWitness"
>;

export type DeploymentSyncCatchUpProbeOutcome =
  | Exclude<CatchUpTurnOutcome, { readonly _tag: "caughtUp" }>
  | Readonly<{
    readonly _tag: "caughtUp";
    readonly cursor: Extract<
      CatchUpTurnOutcome,
      { readonly _tag: "caughtUp" }
    >["cursor"];
    readonly authority: DeploymentSyncCatchUpProbeAuthority;
    readonly progress: Extract<
      CatchUpTurnOutcome,
      { readonly _tag: "caughtUp" }
    >["progress"];
  }>;

export type DeploymentSyncCatchUpProbeResponse =
  | Readonly<{
    readonly ok: true;
    readonly value: DeploymentSyncCatchUpProbeOutcome;
  }>
  | Readonly<{
    readonly ok: false;
    readonly error: DeploymentSyncCatchUpProbeFailure;
  }>;

export interface DeploymentSyncCatchUpProbeInput {
  readonly env: Pick<
    Env,
    | "FLAREX_EXECUTOR"
    | "FLAREX_EXECUTOR_TOKEN"
    | "FLAREX_EXECUTOR_URL"
    | "FLAREX_QUERY_SYNC_PROBE_TOKEN"
  >;
  readonly objectId: Pick<DurableObjectId, "name">;
  readonly storage: DeploymentQuerySyncStorage;
  readonly request: unknown;
}

type DeploymentSyncCatchUpProbeError =
  | DeploymentSyncCatchUpProbeRequestError
  | DeploymentSyncCatchUpProbeAuthorizationError
  | DeploymentQuerySyncBindingError
  | DeploymentSyncCatchUpTurnError;

type DeploymentSyncCatchUpProbeErrorTag =
  DeploymentSyncCatchUpProbeError["_tag"];

type DeploymentSyncCatchUpProbeFailureFor<
  Tag extends DeploymentSyncCatchUpProbeErrorTag,
> = Readonly<{
  readonly tag: Tag;
  readonly reason: Extract<
    DeploymentSyncCatchUpProbeError,
    { readonly _tag: Tag }
  > extends { readonly reason: infer Reason extends string }
    ? Reason
    : null;
}>;

export type DeploymentSyncCatchUpProbeFailure = {
  readonly [Tag in DeploymentSyncCatchUpProbeErrorTag]:
    DeploymentSyncCatchUpProbeFailureFor<Tag>;
}[DeploymentSyncCatchUpProbeErrorTag];

function decodeProbeRequest(
  input: unknown,
): Effect.Effect<
  DecodedDeploymentSyncCatchUpProbeRequest,
  DeploymentSyncCatchUpProbeRequestError
> {
  return decodeUnknownProbeRequest(input).pipe(
    Effect.mapError(cause => new DeploymentSyncCatchUpProbeRequestError({
      reason: "invalidRequest",
      cause,
    })),
  );
}

function authorizeProbe(
  env: Pick<Env, "FLAREX_QUERY_SYNC_PROBE_TOKEN">,
  request: DecodedDeploymentSyncCatchUpProbeRequest,
): Effect.Effect<void, DeploymentSyncCatchUpProbeAuthorizationError> {
  const expected = env.FLAREX_QUERY_SYNC_PROBE_TOKEN;
  if (expected === undefined || expected.length === 0) {
    return Effect.fail(new DeploymentSyncCatchUpProbeAuthorizationError({
      reason: "probeDisabled",
    }));
  }
  if (request.authorizationToken !== expected) {
    return Effect.fail(new DeploymentSyncCatchUpProbeAuthorizationError({
      reason: "unauthorized",
    }));
  }
  return Effect.void;
}

function failureResponse(
  error: DeploymentSyncCatchUpProbeError,
): DeploymentSyncCatchUpProbeResponse {
  const reason = "reason" in error && typeof error.reason === "string"
    ? error.reason
    : null;
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      tag: error._tag,
      reason,
    }) as DeploymentSyncCatchUpProbeFailure,
  });
}

function probeOutcome(
  outcome: CatchUpTurnOutcome,
): DeploymentSyncCatchUpProbeOutcome {
  if (outcome._tag !== "caughtUp") return outcome;
  return Object.freeze({
    _tag: outcome._tag,
    cursor: outcome.cursor,
    authority: Object.freeze({
      namespaceId: outcome.authority.namespaceId,
      syncModelId: outcome.authority.syncModelId,
      sourceEpoch: outcome.authority.sourceEpoch,
      readThroughSequence: outcome.authority.readThroughSequence,
      authorityWitness: outcome.authority.authorityWitness,
    }),
    progress: outcome.progress,
  });
}

export const runDeploymentSyncCatchUpProbe = Effect.fn(
  "DeploymentSyncCatchUpProbe.run",
)(function* (
  input: DeploymentSyncCatchUpProbeInput,
): Effect.fn.Return<DeploymentSyncCatchUpProbeResponse> {
  const result = yield* Effect.result(Effect.gen(function* () {
    const request = yield* decodeProbeRequest(input.request);
    yield* authorizeProbe(input.env, request);
    const binding = yield* Effect.fromResult(
      captureDeploymentQuerySyncBinding({
        objectId: input.objectId,
        observation: request.observation,
      }),
    );
    const freshInitializationCapability = request.authorizeFreshInitialization
      ? issueDeploymentQuerySyncFreshInitializationForIsolatedProbe(binding)
      : undefined;
    const hostEnv = Object.freeze({
      ...(input.env.FLAREX_EXECUTOR === undefined
        ? {}
        : { FLAREX_EXECUTOR: input.env.FLAREX_EXECUTOR }),
      ...(input.env.FLAREX_EXECUTOR_URL === undefined
        ? {}
        : { FLAREX_EXECUTOR_URL: input.env.FLAREX_EXECUTOR_URL }),
      ...(input.env.FLAREX_EXECUTOR_TOKEN === undefined
        ? {}
        : { FLAREX_EXECUTOR_TOKEN: input.env.FLAREX_EXECUTOR_TOKEN }),
    }) satisfies ExecutorHttpEnv;
    return yield* runDeploymentSyncCatchUpTurn({
      env: hostEnv,
      storage: input.storage,
      request: Object.freeze({
        binding,
        budget: request.budget,
        ...(freshInitializationCapability === undefined
          ? {}
          : { freshInitializationCapability }),
      }),
    });
  }));
  return Result.match(result, {
    onFailure: failureResponse,
    onSuccess: value => Object.freeze({
      ok: true,
      value: probeOutcome(value),
    }),
  });
});
