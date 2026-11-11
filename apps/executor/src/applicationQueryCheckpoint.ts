import type { CoreApplicationRegistrationMetadata, CoreDatabase, CorePersistenceError, CoreRetainedInterval } from "@flarex/persistence-postgres/internal/core";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Encoding, Option } from "effect";
import type { CoreQueryCheckpointRequest } from "flarex-protocol/internal/core-query-checkpoint";
import type { ExecutorApplicationProfile } from "./applicationConfiguration";

export class ExecutorApplicationCheckpointError extends Data.TaggedError("ExecutorApplicationCheckpointError")<{
  readonly reason: "scopeMismatch" | "profileNotReady" | "invalidCheckpoint";
  readonly cause?: unknown;
}> {}

export function matchesConfiguredRegistration(registration: CoreApplicationRegistrationMetadata, profile: ExecutorApplicationProfile) {
  return registration.deploymentId === profile.deploymentId && registration.scopeUuid === profile.scopeUuid
    && registration.epochUuid === profile.epochUuid && registration.analyzerIdentity === profile.analyzerIdentity
    && registration.analyzerPolicyIdentity === profile.analyzerPolicyIdentity && registration.compatibilityDate === profile.compatibilityDate
    && registration.generation === profile.generation;
}

const utf8 = new TextEncoder();
/** This domain frame identifies the complete authenticated publication, independently of its returned order. */
function sourceIdentityBytes(registration: CoreApplicationRegistrationMetadata): Uint8Array {
  const programs = registration.programs.map(program => [program.identity.functionPath, program.identity.programHash, program.identity.schemaHash] as const);
  programs.sort((left, right) => compareUtf16Strings(left[0], right[0]) || compareUtf16Strings(left[1], right[1]) || compareUtf16Strings(left[2], right[2]));
  return utf8.encode(JSON.stringify(["flarex.core-query-checkpoint.source", 1,
    registration.deploymentId, registration.scopeUuid, registration.epochUuid,
    registration.candidateId, registration.generation, registration.sourceArtifactRootSha256,
    registration.sourcePackageHash, registration.analyzerIdentity, registration.analyzerPolicyIdentity,
    registration.compatibilityDate, programs]));
}

/** A detached history certificate is produced only after the target's final metadata fence succeeds. */
export const readExecutorApplicationCheckpoint = Effect.fn("ExecutorApplication.readCheckpoint")(function* <Failure>(
  database: Pick<CoreDatabase, "withQueryTarget">,
  profile: ExecutorApplicationProfile,
  input: CoreQueryCheckpointRequest,
  sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, Failure>,
) {
  if (input.route.deploymentId !== profile.deploymentId || input.route.scopeUuid !== profile.scopeUuid)
    return yield* new ExecutorApplicationCheckpointError({ reason: "scopeMismatch" });
  return yield* database.withQueryTarget({ maximumElapsedMilliseconds: input.maximumElapsedMilliseconds }, target => Effect.gen(function* () {
    const active = yield* target.readApplicationRegistration();
    if (Option.isNone(active) || !matchesConfiguredRegistration(active.value, profile))
      return yield* new ExecutorApplicationCheckpointError({ reason: "profileNotReady" });
    const registration = active.value;
    const sourceId = Encoding.encodeHex(yield* sha256(sourceIdentityBytes(registration)));
    const interval = yield* target.retainedInterval(target.timestamp);
    const response = {
      format: "flarex.core-query-checkpoint.response" as const, version: 1 as const,
      route: Object.freeze({ deploymentId: registration.deploymentId, scopeUuid: registration.scopeUuid, epochUuid: registration.epochUuid }),
      sourceId, after: input.after, retainedFrom: String(interval.retainedFrom), through: String(interval.through),
    };
    if (input.route.epochUuid !== registration.epochUuid || input.sourceId !== null && input.sourceId !== sourceId)
      return Object.freeze({ ...response, kind: "sourceReplaced" as const });
    if (input.after !== null) {
      const retained = yield* target.retainedInterval(BigInt(input.after)).pipe(
        Effect.map(Option.some),
        Effect.catchTag("CorePersistenceError", (error): Effect.Effect<Option.Option<CoreRetainedInterval>, CorePersistenceError | ExecutorApplicationCheckpointError> => error.reason === "outOfRetention" ? Effect.succeed(Option.none())
          : error.reason === "invalidTarget" ? Effect.fail(new ExecutorApplicationCheckpointError({ reason: "invalidCheckpoint", cause: error }))
          : Effect.fail(error)),
      );
      if (Option.isNone(retained)) return Object.freeze({ ...response, kind: "historyUnavailable" as const });
    }
    return Object.freeze({ ...response, kind: "certified" as const });
  }));
});
