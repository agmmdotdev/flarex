import { Cause, Effect, Schema } from "effect";
import { FrameworkCommandMilliseconds } from "../frameworkExecutionPolicy";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { PostgresFlarexPersistence } from "../postgres";
import {
  makePostgresPhysicalSessionDriver,
  type PostgresPhysicalSessionOptions,
} from "../physicalSession/postgres";
import { makePhysicalSessionAccess } from "../physicalSession/drizzle";
import { makePhysicalDeadlineOperations } from "../physicalSession/deadline";
import {
  physicalSessionErrors,
  PhysicalSessionResourceIssue,
} from "../physicalSession/errors";
import { flarexSchema } from "../schema";
import { closeProtectedMetadataFinalGuardScope } from "../preparedMetadataEpoch";
import { acquireInstallationAdmission, closeInstallationAdmission, lockInstallationForCurrentTransaction,
  requireCoLocatedInstallationAdmission, type PreparedCoLocatedReadInstallation,
  type PreparedInstallation } from "../installationLifecycle";
import {
  RelationalSessionError,
  relationalError,
  relationalLimits,
} from "./model";

const access = makePhysicalSessionAccess(flarexSchema);
const physicalDeadlines = makePhysicalDeadlineOperations(physicalSessionErrors);
const isCommandMilliseconds = Schema.is(FrameworkCommandMilliseconds);

declare const sessionBrand: unique symbol;
export interface RelationalSession {
  readonly [sessionBrand]: true;
}
export type RelationalSessionProfile = "command" | "snapshotRead";
export type RelationalInstallationProfile = Readonly<{ kind: "fullProof" }> |
  Readonly<{ kind: "managed"; installation: PreparedInstallation }>;
export type RunRelationalSession = <Value, Failure>(
  profile: RelationalSessionProfile,
  work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
  commandMs?: number,
) => Effect.Effect<Value, Failure | RelationalSessionError>;
const sessions = new WeakMap<
  object,
  Readonly<{ database: FlarexMetadataDatabase; run: RunRelationalSession; installation: RelationalInstallationProfile }>
>();

/** Internal resource composition only. Consumers receive a host, never this issuer. */
export function issueRelationalSession(
  database: FlarexMetadataDatabase,
  run: RunRelationalSession,
  installation: RelationalInstallationProfile = { kind: "fullProof" },
): RelationalSession {
  // SAFETY: all session authority is held by this WeakMap, never token properties.
  const token = Object.freeze({}) as RelationalSession;
  sessions.set(token, Object.freeze({ database, run, installation: Object.freeze({ ...installation }) }));
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
    profile: RelationalSessionProfile,
    work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
    commandMs?: number,
    installation?: RelationalInstallationProfile,
  ) {
    const state = sessions.get(session);
    if (state === undefined)
      return yield* Effect.fail(relationalError("invalidAuthority"));
    if (commandMs !== undefined && (profile !== "command" || !isCommandMilliseconds(commandMs)))
      return yield* Effect.fail(relationalError("invalidAuthority"));
    const admission = installation ?? state.installation;
    return yield* state.run(profile, tx => (
      admission.kind === "managed"
        ? acquireInstallationAdmission(admission.installation, state.database, tx)
        : lockInstallationForCurrentTransaction(tx)
    ).pipe(
      Effect.mapError(cause => new RelationalSessionError({ reason: "resourceFailure", cause })),
      Effect.andThen(() => work(tx)),
      Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))),
    ), commandMs);
  },
);

/** The standalone kernel combines installation entry with its bounded guard
 * query. Business work starts only after both actual admissions are recorded.
 * Entry is trusted persistence code; native commands never receive this port. */
export const runCoLocatedRelationalReadSession = Effect.fn("RelationalSession.coLocatedRead")(
  function* <Entry, Value, EntryFailure, Failure>(session: RelationalSession,
    installation: PreparedCoLocatedReadInstallation,
    enter: (tx: FlarexMetadataTransaction) => Effect.Effect<Entry, EntryFailure>,
    work: (tx: FlarexMetadataTransaction, entry: Entry) => Effect.Effect<Value, Failure>) {
    const state = sessions.get(session);
    if (state === undefined) return yield* Effect.fail(relationalError("invalidAuthority"));
    return yield* state.run("snapshotRead", tx => enter(tx).pipe(
      Effect.tap(() => requireCoLocatedInstallationAdmission(installation, state.database, tx).pipe(
        Effect.mapError(cause => new RelationalSessionError({ reason: "resourceFailure", cause })))),
      Effect.flatMap(entry => work(tx, entry)),
      Effect.ensuring(Effect.sync(() => {
        closeProtectedMetadataFinalGuardScope(tx);
        closeInstallationAdmission(tx);
      })),
    ));
  },
);

export function makePostgresRelationalSession(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  testOptions?: PostgresPhysicalSessionOptions,
  installation?: RelationalInstallationProfile,
): RelationalSession {
  // This data session consumes only the neutral initial-transaction operation.
  // Request reconciliation remains with its host; no control policy is composed.
  const initial = makePostgresPhysicalSessionDriver(
    persistence.pool,
    { access, errors: physicalSessionErrors },
    testOptions,
  ).runInitialTransactionEffect;
  const run: RunRelationalSession = Effect.fn("RelationalSession.postgres")(
    <Value, Failure>(
      profile: RelationalSessionProfile,
      work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
      commandMs?: number,
    ) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const deadline = yield* physicalDeadlines.start(
            "initial",
            commandMs ?? relationalLimits.commandMs,
          );
          const result = yield* initial(
            {
              isolationLevel: profile === "snapshotRead" ? "repeatable read" : "read committed",
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
  return issueRelationalSession(persistence.drizzle, run, installation);
}
function projectResource<Failure>(
  error: Failure | PhysicalSessionResourceIssue,
): Failure | RelationalSessionError {
  return error instanceof PhysicalSessionResourceIssue
    ? new RelationalSessionError({ reason: "resourceFailure", cause: error })
    : error;
}
