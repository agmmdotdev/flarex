import { Cause, Effect } from "effect";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { PostgresFlarexPersistence } from "../postgres";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../frameworkSchema/artifact/postgresControlSession";
import {
  startFrameworkSchemaArtifactControlDeadline,
  FrameworkSchemaArtifactControlSessionResourceIssue,
} from "../frameworkSchema/artifact/controlSession";
import {
  RelationalSessionError,
  relationalError,
  relationalLimits,
} from "./model";

declare const sessionBrand: unique symbol;
export interface RelationalSession {
  readonly [sessionBrand]: true;
}
export type RunRelationalSession = <Value, Failure>(
  work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
) => Effect.Effect<Value, Failure | RelationalSessionError>;
const sessions = new WeakMap<
  object,
  Readonly<{ database: FlarexMetadataDatabase; run: RunRelationalSession }>
>();

/** Internal resource composition only. Consumers receive a host, never this issuer. */
export function issueRelationalSession(
  database: FlarexMetadataDatabase,
  run: RunRelationalSession,
): RelationalSession {
  // SAFETY: all session authority is held by this WeakMap, never token properties.
  const token = Object.freeze({}) as RelationalSession;
  sessions.set(token, Object.freeze({ database, run }));
  return token;
}
export function hasRelationalSessionDatabase(
  session: RelationalSession,
  database: FlarexMetadataDatabase,
): boolean {
  return sessions.get(session)?.database === database;
}
export const runRelationalSession = Effect.fn("RelationalSession.run")(
  function* <Value, Failure>(
    session: RelationalSession,
    work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
  ) {
    const state = sessions.get(session);
    if (state === undefined)
      return yield* Effect.fail(relationalError("invalidAuthority"));
    return yield* state.run(work);
  },
);

export function makePostgresRelationalSession(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  testOptions?: Parameters<
    typeof makePostgresFrameworkSchemaArtifactControlSessionDriver
  >[1],
): RelationalSession {
  // Reuse only the proven physical initial-transaction driver. No artifact
  // repository, recovery attempt, migration token or finalizer is composed.
  const initial = makePostgresFrameworkSchemaArtifactControlSessionDriver(
    persistence.pool,
    testOptions,
  ).runInitialTransactionEffect;
  const run: RunRelationalSession = Effect.fn("RelationalSession.postgres")(
    <Value, Failure>(
      work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
    ) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
            "initial",
            relationalLimits.commandMs,
          );
          const result = yield* initial(
            {
              deadline,
              lockTimeoutMilliseconds: relationalLimits.lockMs,
              recoveryTimeoutMilliseconds: relationalLimits.cleanupMs,
            },
            restore,
            work,
          );
          switch (result.kind) {
            case "committed":
              return result.value;
            case "callbackRolledBack":
              return yield* Effect.failCause(
                Cause.map(result.callbackCause, projectResource<Failure>),
              );
            case "callbackCleanupFailed":
              return yield* Effect.failCause(
                Cause.combine(
                  // Keep the callback's original Cause, including interruption/defects.
                  Cause.map(result.callbackCause, projectResource<Failure>),
                  Cause.fail(
                    new RelationalSessionError({
                      reason: "cleanupFailure",
                      cause: result.cleanupCause,
                    }),
                  ),
                ),
              );
            case "notCommitted":
              return yield* Effect.fail(
                new RelationalSessionError({
                  reason: "resourceFailure",
                  cause: result.cause,
                }),
              );
            case "uncertain":
              return yield* Effect.fail(
                new RelationalSessionError({
                  reason: "decisionUncertain",
                  cause: result.initialSettlementCause,
                }),
              );
          }
        }),
      ),
  );
  return issueRelationalSession(persistence.drizzle, run);
}
function projectResource<Failure>(
  error: Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
): Failure | RelationalSessionError {
  return error instanceof FrameworkSchemaArtifactControlSessionResourceIssue
    ? new RelationalSessionError({ reason: "resourceFailure", cause: error })
    : error;
}
