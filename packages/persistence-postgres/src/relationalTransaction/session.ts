import { Cause, Effect, Result, Schema } from "effect";
import { observeExecution } from "../executionDiagnostics/operation";
import { FrameworkCommandMilliseconds } from "../frameworkExecutionPolicy";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { PostgresFlarexPersistence } from "../postgres";
import {
  makePostgresPhysicalSessionDriver,
  type PostgresPhysicalSessionOptions,
} from "../physicalSession/postgres";
import { makePhysicalSessionAccess } from "../physicalSession/drizzle";
import { makePhysicalDeadlineOperations, type PhysicalDeadline } from "../physicalSession/deadline";
import {
  physicalSessionErrors,
  PhysicalSessionResourceIssue,
} from "../physicalSession/errors";
import { flarexSchema } from "../schema";
import { closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards, hasProtectedMetadataFinalGuardScope } from "../preparedMetadataEpoch";
import { acquireInstallationAdmission, closeInstallationAdmission, lockInstallationForCurrentTransaction,
  requireCoLocatedInstallationAdmission, type PreparedCoLocatedReadInstallation,
  getCoLocatedReadInstallationReferencesResult, acquireCoLocatedInstallationAdmission,
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
  Readonly<{ kind: "managed"; installation: PreparedInstallation; coLocated?: PreparedCoLocatedReadInstallation }>;
export type RunRelationalSession = <Value, Failure>(
  profile: RelationalSessionProfile,
  work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
  commandBudget?: number | PhysicalDeadline,
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
/** Exact installed pair owned by this session, never caller-authored epochs. */
export function readRelationalSessionCoLocatedInstallation(session: RelationalSession, database: FlarexMetadataDatabase) {
  const state = sessions.get(session);
  if (state === undefined || state.database !== database) return Result.fail(relationalError("invalidAuthority"));
  const profile = state.installation;
  if (profile.kind === "fullProof" || profile.coLocated === undefined) return Result.succeed(undefined);
  return getCoLocatedReadInstallationReferencesResult(profile.coLocated, database).pipe(
    Result.flatMap(refs => refs.targetInstallation === profile.installation ? Result.succeed(profile.coLocated) :
      Result.fail(relationalError("invalidAuthority"))), Result.mapError(cause => relationalError("invalidAuthority", cause)));
}
const projectInstallation = (cause: unknown) => new RelationalSessionError({ reason: "resourceFailure", cause });

/** One original request deadline, shared by pre-business refresh and recovery. */
export const startRelationalRequestDeadline = (milliseconds: number) => isCommandMilliseconds(milliseconds)
  ? physicalDeadlines.start("initial", milliseconds)
  : Effect.fail(relationalError("invalidAuthority"));
export const boundRelationalRequestDeadline = <Value, Failure, Requirements>(deadline: PhysicalDeadline,
  work: Effect.Effect<Value, Failure, Requirements>) => physicalDeadlines.remaining(deadline, "callback").pipe(
    Effect.flatMap(remaining => work.pipe(Effect.timeoutOrElse({
      duration: remaining, orElse: () => physicalDeadlines.fail(deadline, "callback"),
    }))));

export interface OrdinaryRelationalEntryWork<Value, Failure> {
  readonly enter: (tx: FlarexMetadataTransaction, requireInstallation: Effect.Effect<void, RelationalSessionError>) => Effect.Effect<Value, Failure | RelationalSessionError>;
}

// SDK policy owns optional named observation; this stable persistence operation
// does not create default diagnostic spans on each ordinary request.
export const runRelationalSession = Effect.fnUntraced(
  function* <Value, Failure>(
    session: RelationalSession,
    profile: RelationalSessionProfile,
    work: ((tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>) | OrdinaryRelationalEntryWork<Value, Failure>,
    commandBudget?: number | PhysicalDeadline,
    installation?: RelationalInstallationProfile,
  ) {
    const state = sessions.get(session);
    if (state === undefined)
      return yield* Effect.fail(relationalError("invalidAuthority"));
    if (typeof commandBudget === "number" && (profile !== "command" || !isCommandMilliseconds(commandBudget)))
      return yield* Effect.fail(relationalError("invalidAuthority"));
    const admission = installation ?? state.installation;
    return yield* state.run(profile, tx => {
      const ordinary = typeof work !== "function";
      const requireInstallation = (
      admission.kind === "managed" && admission.coLocated !== undefined
        ? !ordinary
          ? acquireCoLocatedInstallationAdmission(admission.coLocated, state.database, tx).pipe(Effect.mapError(projectInstallation))
          : requireCoLocatedInstallationAdmission(admission.coLocated, state.database, tx).pipe(Effect.mapError(projectInstallation))
        : (admission.kind === "managed" ? acquireInstallationAdmission(admission.installation, state.database, tx) :
          lockInstallationForCurrentTransaction(tx)).pipe(Effect.mapError(projectInstallation))
      );
      return (ordinary ? work.enter(tx, requireInstallation) : requireInstallation.pipe(Effect.andThen(() => work(tx)))).pipe(
      Effect.tap(() => hasProtectedMetadataFinalGuardScope(tx) ? flushProtectedMetadataFinalGuards(tx).pipe(
        Effect.mapError(cause => new RelationalSessionError({ reason: "resourceFailure", cause }))) : Effect.void),
      Effect.ensuring(Effect.sync(() => { closeProtectedMetadataFinalGuardScope(tx); closeInstallationAdmission(tx); })),
      );
    }, commandBudget);
  },
  work => observeExecution("RelationalSession.run", work),
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
  const run: RunRelationalSession = Effect.fnUntraced(
    function* <Value, Failure>(
      profile: RelationalSessionProfile,
      work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
      commandBudget?: number | PhysicalDeadline,
    ) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const deadline = typeof commandBudget === "object" ? commandBudget : yield* physicalDeadlines.start(
            "initial", commandBudget ?? relationalLimits.commandMs);
          yield* physicalDeadlines.requireKind(deadline, "initial");
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
      );
    },
    work => observeExecution("RelationalSession.postgres", work),
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
