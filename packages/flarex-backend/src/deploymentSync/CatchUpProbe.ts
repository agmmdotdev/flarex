import { CheckpointBudgetSchema, type Checkpoint, type CheckpointError,
  type CheckpointOutcome } from "@flarex/query-sync/internal/checkpoint";
import { Cause, Data, Effect, Schema } from "effect";
import { CoreApplicationRouteIdentitySchema } from "flarex-protocol/internal/core-application";
import type { Env } from "../types";
import { runDeploymentSyncCatchUpTurn } from "./CatchUpHost";
import type { DeploymentCheckpointStorage } from "./CheckpointStore";

const requestSchema = Schema.Struct({ authorizationToken: Schema.String,
  route: CoreApplicationRouteIdentitySchema, budget: CheckpointBudgetSchema,
  authorizeFreshInitialization: Schema.Boolean }).annotate({ parseOptions: { onExcessProperty: "error" as const } });
const decodeRequest = Schema.decodeUnknownEffect(requestSchema);

export class DeploymentSyncCatchUpProbeRequestError extends Data.TaggedError("DeploymentSyncCatchUpProbeRequestError")<{
  readonly reason: "invalidRequest";
  readonly cause: Schema.SchemaError;
}> {}
export class DeploymentSyncCatchUpProbeAuthorizationError extends Data.TaggedError("DeploymentSyncCatchUpProbeAuthorizationError")<{
  readonly reason: "probeDisabled" | "unauthorized";
}> {}
export class DeploymentCheckpointBindingError extends Data.TaggedError("DeploymentCheckpointBindingError")<{
  readonly reason: "objectNameMissing" | "routeScopeMismatch";
}> {}

type WireCheckpoint = Readonly<{ sourceId: string; position: string }>;
type WireProgress = Readonly<{ sourceReads: number; stateTransitions: number; lastCheckpoint: WireCheckpoint | null }>;
export type DeploymentSyncCatchUpProbeOutcome =
  | Readonly<{ kind: "caughtUp"; target: WireCheckpoint; checkpoint: WireCheckpoint; progress: WireProgress }>
  | Readonly<{ kind: "continuationRequired"; reason: "sourceReadLimitReached" | "stateTransitionLimitReached" | "deadlineReached";
    progress: WireProgress }>
  | Readonly<{ kind: "resetRequired"; reason: "historyUnavailable" | "sourceReplaced"; progress: WireProgress }>;
type ProbeFailure = DeploymentSyncCatchUpProbeRequestError | DeploymentSyncCatchUpProbeAuthorizationError
  | DeploymentCheckpointBindingError | CheckpointError;
type WireProbeFailure = { [Tag in ProbeFailure["_tag"]]: Readonly<{
  tag: Tag; reason: Extract<ProbeFailure, { readonly _tag: Tag }>["reason"];
}> }[ProbeFailure["_tag"]];
export type DeploymentSyncCatchUpProbeResponse =
  | Readonly<{ ok: true; value: DeploymentSyncCatchUpProbeOutcome }>
  | Readonly<{ ok: false; error: WireProbeFailure }>;

export interface DeploymentSyncCatchUpProbeInput {
  readonly env: Pick<Env, "FLAREX_EXECUTOR" | "FLAREX_EXECUTOR_TOKEN" | "FLAREX_EXECUTOR_URL" | "FLAREX_QUERY_SYNC_PROBE_TOKEN">;
  readonly objectId: Pick<DurableObjectId, "name">;
  readonly storage: DeploymentCheckpointStorage;
  readonly request: unknown;
}
const checkpointToWire = (value: Checkpoint): WireCheckpoint => Object.freeze({ sourceId: value.sourceId, position: value.position.toString() });
function outcomeToWire(value: CheckpointOutcome): DeploymentSyncCatchUpProbeOutcome {
  const progress = Object.freeze({ ...value.progress, lastCheckpoint: value.progress.lastCheckpoint === null
    ? null : checkpointToWire(value.progress.lastCheckpoint) });
  if (value.kind === "caughtUp") return Object.freeze({ ...value, target: checkpointToWire(value.target),
    checkpoint: checkpointToWire(value.checkpoint), progress });
  return Object.freeze({ ...value, progress });
}
function failureToWire(error: ProbeFailure): WireProbeFailure {
  switch (error._tag) {
    case "DeploymentSyncCatchUpProbeRequestError":
      return Object.freeze({ tag: error._tag, reason: error.reason });
    case "DeploymentSyncCatchUpProbeAuthorizationError":
      return Object.freeze({ tag: error._tag, reason: error.reason });
    case "DeploymentCheckpointBindingError":
      return Object.freeze({ tag: error._tag, reason: error.reason });
    case "CheckpointError":
      return Object.freeze({ tag: error._tag, reason: error.reason });
  }
}

export const runDeploymentSyncCatchUpProbe = Effect.fn("DeploymentSyncCatchUpProbe.run")(function* (
  input: DeploymentSyncCatchUpProbeInput,
): Effect.fn.Return<DeploymentSyncCatchUpProbeResponse, ProbeFailure> {
  return yield* Effect.gen(function* () {
    const decoded = yield* decodeRequest(input.request).pipe(Effect.mapError(cause =>
      new DeploymentSyncCatchUpProbeRequestError({ reason: "invalidRequest", cause })));
    const request = Object.freeze({ ...decoded, route: Object.freeze({ ...decoded.route }),
      budget: Object.freeze({ ...decoded.budget }) });
    const expectedToken = input.env.FLAREX_QUERY_SYNC_PROBE_TOKEN;
    if (expectedToken === undefined || expectedToken.length === 0)
      return yield* new DeploymentSyncCatchUpProbeAuthorizationError({ reason: "probeDisabled" });
    if (request.authorizationToken !== expectedToken)
      return yield* new DeploymentSyncCatchUpProbeAuthorizationError({ reason: "unauthorized" });
    const objectName = input.objectId.name;
    if (objectName === undefined) return yield* new DeploymentCheckpointBindingError({ reason: "objectNameMissing" });
    if (objectName !== `deployment-sync:${request.route.scopeUuid}`)
      return yield* new DeploymentCheckpointBindingError({ reason: "routeScopeMismatch" });
    return yield* runDeploymentSyncCatchUpTurn({ env: input.env, storage: input.storage, request });
  }).pipe(Effect.map(value => Object.freeze({ ok: true as const, value: outcomeToWire(value) })),
    Effect.catchCause(cause => {
      const reason = cause.reasons[0];
      if (cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason))
        return Effect.succeed(Object.freeze({ ok: false as const, error: failureToWire(reason.error) }));
      return Effect.failCause(cause);
    }));
});
