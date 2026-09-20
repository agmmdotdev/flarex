import { Effect, Schema } from "effect";
import { sql } from "drizzle-orm";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import {
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
} from "flarex-protocol/storage-authority";
import {
  TransactionRequestKeyV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import type { CmsHostInput } from "../src/cmsTransaction/host";
import {
  cmsError,
  cmsLimits,
  CmsTransactionError,
} from "../src/cmsTransaction/model";
import {
  prepareCmsApplication,
  withCmsAdmission,
  requireCmsAdmission,
} from "../src/cmsTransaction/admission";
import {
  prepareApplicationDocumentParticipant,
  enterApplicationDocumentParticipant,
} from "../src/applicationDocumentMaterialization/participant";
import { makeCmsRequestLifetime } from "../src/cmsTransaction/lifetime";
import { capturePrivateJsonData } from "../src/privateJsonData";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
} from "../src/scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../src/transactionSessionAttemptKernel";
import {
  hasRelationalSessionDatabase,
  runRelationalSession,
} from "../src/relationalTransaction/session";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { runWithRequestRecovery } from "../src/relationalTransaction/requestRecovery";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../src/scopeClock";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import {
  createCommittedPointOutcomeResolverV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
} from "../src/committedPointOutcome";
import {
  allocatePointCommitKernelResult,
  readPointCommitDatabaseTime,
  rethrowPublicationFailure,
} from "../src/commitPublication/pointCommitProjection";
import {
  type ScopePublicationContribution,
  type ScopePublicationKernel,
} from "../src/commitPublication/scopePublicationModel";
import {
  mapTransactionFailure,
  PointCommitSqlErrorV1,
} from "../src/pointCommitErrors";
import {
  writeCe0PublicationReference,
  advanceCe0PublicationReference,
} from "./ce0PublicationReference";

const decodeEmpty = Schema.decodeUnknownEffect(
  Schema.Struct({ count: Schema.Literal(0), prefix: Schema.NonEmptyString }),
);
const decodeRequestKey = Schema.decodeUnknownEffect(
  TransactionRequestKeyV1Schema,
);
const digest = makeLivePrivateSha256V1({
  invalidBudget: () => cmsError("limitExceeded"),
  invalidBytes: () => cmsError("invalidInput"),
  inputBytesExceeded: () => cmsError("limitExceeded"),
  unavailable: () => cmsError("resourceFailure"),
  nativeRejected: (cause) => cmsError("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid reference SHA-256 output"),
});
const hash = (bytes: Uint8Array) =>
  digest(bytes, { maximumInputBytes: cmsLimits.commandBytes });
const projectFailure = (cause: unknown): CmsTransactionError => {
  if (cause instanceof CmsTransactionError) return cause;
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1)
    return cmsError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1)
    return cmsError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError)
    return cmsError(
      cause.reason === "decisionUncertain"
        ? "decisionUncertain"
        : "resourceFailure",
      cause,
    );
  return cmsError("invalidAuthority", cause);
};
const persistenceStep = <Value>(work: () => Promise<Value>) =>
  Effect.tryPromise({
    try: () => work().catch(rethrowPublicationFailure),
    catch: (cause) => {
      const failure = mapTransactionFailure(cause);
      return cmsError(
        failure instanceof PointCommitSqlErrorV1
          ? "statementFailure"
          : "storedCorruption",
        failure,
      );
    },
  });

/** Test-only fixed zero-row request. Common admission, empty-delta checks,
 * lifetime, codecs, outcome resolution and physical recovery remain in the
 * request. Only orchestration and publication SQL are independent. No timing
 * or nonempty-materialization equivalence is claimed by this first profile. */
export const makeCe0EmptyMutationReference = Effect.fn(
  "Ce0EmptyReference.make",
)(function* <Failure>(
  input: Pick<
    CmsHostInput<Failure>,
    | "database"
    | "controlDatabase"
    | "session"
    | "deploymentId"
    | "authority"
    | "pointCommitAuthority"
    | "application"
    | "identityAndAccessPolicy"
    | "materialization"
  >,
) {
  const {
    database,
    controlDatabase,
    session,
    deploymentId,
    application,
    pointCommitAuthority,
  } = input;
  if (!hasRelationalSessionDatabase(session, database))
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const compositionAuthority = input.authority;
  const authority =
    captureTrustedScopeAuthorityResolutionPorts(compositionAuthority);
  const options = Object.freeze({ ...input.materialization });
  const identity = yield* Effect.fromResult(
    capturePrivateJsonData(
      input.identityAndAccessPolicy,
      cmsLimits.documentBytes,
      cmsError,
    ),
  );
  const canonicalIdentity = yield* canonicalizeSuccessfulResultV1Effect(
    identity.value,
  ).pipe(Effect.mapError(projectFailure));
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(
    yield* hash(canonicalIdentity.canonicalBytes),
  );
  const owner = Object.freeze({ hostId: Symbol("ce0.empty.reference") });
  let executions = 0;
  const run = Effect.fn("Ce0EmptyReference.run")(function* (
    requestKey: string,
    args: Json,
  ): Effect.fn.Return<Json, CmsTransactionError> {
    const captured = yield* Effect.fromResult(
      capturePrivateJsonData(args, cmsLimits.commandBytes, cmsError),
    );
    // Explicit profile bound, even when a key happens to name another result.
    yield* decodeEmpty(captured.value).pipe(
      Effect.mapError(() => cmsError("unsupportedProfile")),
    );
    const key = yield* decodeRequestKey(requestKey).pipe(
      Effect.mapError((cause) => cmsError("invalidInput", cause)),
    );
    if (!/^cms\/[0-9a-f-]{36}$/.test(key))
      return yield* Effect.fail(cmsError("invalidInput"));
    const transactionId = crypto.randomUUID();
    const requestIdentity = Object.freeze({
      requestId: Symbol("ce0.empty.request"),
    });
    const attempt = Effect.fn("Ce0EmptyReference.attempt")(function* (
      recoverOnly: boolean,
    ) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        deploymentId,
        authority,
      );
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
        return yield* Effect.fail(cmsError("invalidAuthority"));
      const prepared = yield* prepareCmsApplication(
        application,
        compositionAuthority,
        controlDatabase,
        deploymentId,
      );
      if (prepared.schema.relations.length !== 0)
        return yield* Effect.fail(cmsError("unsupportedProfile"));
      const participant = yield* prepareApplicationDocumentParticipant(
        prepared.schema,
        controlDatabase,
        located.authority,
        pointCommitAuthority,
        options,
        prepared.schema.writePolicy?.writePolicies
          .filter((policy) => policy.owner === "payload")
          .map((policy) => policy.tableId) ?? [],
      ).pipe(
        Effect.catchTag("ApplicationParticipantError", (error) =>
          Effect.fail(cmsError(error.reason, error.cause)),
        ),
      );
      return yield* runRelationalSession(session, "command", (tx) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* runDrizzleStatementEffect(
              tx.execute(
                sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`,
              ),
              (cause) => cmsError("statementFailure", cause),
            );
            const clock =
              yield* lockScopeClockForOrdinaryWriteInTransactionEffect(
                tx,
                located.authority.scopeId,
              );
            return yield* withCmsAdmission(
              prepared,
              tx,
              located.authority,
              clock,
              (admission) =>
                Effect.gen(function* () {
                  const state = yield* requireCmsAdmission(admission);
                  if (
                    state.frame.payloadLifecycle !== null ||
                    state.frame.commerce.length !== 0 ||
                    state.frame.crossDomainReferences.length !== 0
                  ) {
                    return yield* Effect.fail(cmsError("unsupportedProfile"));
                  }
                  const scope = yield* Effect.fromResult(
                    projectScopeIdUuidV1Result(located.authority.scopeId),
                  );
                  const epoch = yield* Effect.fromResult(
                    projectScopeEpochUuidV1Result(clock.epoch),
                  );
                  const evidence = yield* canonicalizeSuccessfulResultV1Effect({
                    domain: "flarex.private.cms-command",
                    version: 1,
                    deploymentId,
                    scopeId: located.authority.scopeId,
                    epoch: clock.epoch,
                    storageGeneration: clock.storageGeneration,
                    fence: clock.storageGenerationFence.toString(),
                    binding: state.frame,
                    head: {
                      sequence: state.head.sequence.toString(),
                      sha256: state.head.sha256,
                    },
                    operation: "measuredInsert",
                    args: captured.value,
                  });
                  const lookup = {
                    scopeUuid: scope.scopeUuid,
                    requestKey: key,
                    expectedIdentityAccessPolicySha256: identityDigest,
                    expectedFunctionPath: TransactionFunctionPathV1Schema.make(
                      "__flarex_private_cms/measuredInsert",
                    ),
                    expectedRequestSha256:
                      TransactionRequestSha256V1Schema.make(
                        yield* hash(evidence.canonicalBytes),
                      ),
                  };
                  const outcome =
                    yield* createCommittedPointOutcomeResolverV1(tx).resolve(
                      lookup,
                    );
                  if (outcome.kind === "available")
                    return outcome.successfulResult.valueJson;
                  if (outcome.kind === "expired")
                    return yield* Effect.fail(cmsError("resultUnavailable"));
                  if (recoverOnly)
                    return yield* Effect.fail(cmsError("decisionUncertain"));
                  const lifetime = yield* makeCmsRequestLifetime(
                    owner,
                    requestIdentity,
                    transactionId,
                    "write",
                  );
                  return yield* Effect.gen(function* () {
                    yield* Effect.fromResult(
                      lifetime.charge(
                        captured.bytes + evidence.canonicalBytes.byteLength,
                      ),
                    );
                    const entered = yield* enterApplicationDocumentParticipant(
                      participant,
                      tx,
                      located.authority,
                      clock,
                      state.schema,
                    ).pipe(
                      Effect.catchTag("ApplicationParticipantError", (error) =>
                        Effect.fail(cmsError(error.reason, error.cause)),
                      ),
                    );
                    // Same root invocation capture/accounting, with no document API or
                    // nested callback admitted by this fixed operation.
                    const child = yield* Effect.fromResult(
                      capturePrivateJsonData(
                        captured.value,
                        lifetime.remainingBytes(),
                        cmsError,
                      ),
                    );
                    yield* Effect.fromResult(lifetime.charge(child.bytes));
                    executions++;
                    const output = yield* Effect.fromResult(
                      capturePrivateJsonData(
                        [],
                        lifetime.remainingBytes(),
                        cmsError,
                      ),
                    );
                    yield* Effect.fromResult(lifetime.charge(output.bytes));
                    const result = yield* canonicalizeSuccessfulResultV1Effect(
                      output.value,
                    );
                    yield* Effect.fromResult(
                      lifetime.charge(result.canonicalBytes.byteLength),
                    );
                    const resultSha256 = yield* hash(result.canonicalBytes);
                    yield* lifetime.seal;
                    const delta = yield* entered
                      .prepareDelta([], [])
                      .pipe(
                        Effect.catchTag(
                          "ApplicationParticipantError",
                          (error) =>
                            Effect.fail(cmsError(error.reason, error.cause)),
                        ),
                      );
                    const now = yield* persistenceStep(() =>
                      readPointCommitDatabaseTime(tx, scope.scopeId, options),
                    );
                    const envelope = {
                      record: clock,
                      scopeUuid: scope.scopeUuid,
                      epochUuid: epoch.epochUuid,
                    };
                    const allocation = yield* Effect.fromResult(
                      allocatePointCommitKernelResult(envelope, now),
                    ).pipe(
                      Effect.mapError((cause) =>
                        cmsError("resourceFailure", cause),
                      ),
                    );
                    const adjacency = yield* delta
                      .lower(allocation.commitSeq)
                      .pipe(
                        Effect.catchTag(
                          "ApplicationParticipantError",
                          (error) =>
                            Effect.fail(cmsError(error.reason, error.cause)),
                        ),
                      );
                    if (adjacency.length !== 0)
                      return yield* Effect.fail(cmsError("unsupportedProfile"));
                    const contribution: ScopePublicationContribution = {
                      authorityPins: {
                        scopeId: scope.scopeId,
                        requestKey: key,
                        functionPath: lookup.expectedFunctionPath,
                      },
                      rowIntents: [],
                      identityAccessPolicySha256: identityDigest,
                      requestSha256: lookup.expectedRequestSha256,
                      resultSha256,
                      successfulResult: {
                        ...result,
                        encoding: "application-value",
                      },
                    };
                    const kernel: ScopePublicationKernel = {
                      clock: envelope,
                      ...allocation,
                      relationAdjacencyChanges: [],
                    };
                    yield* persistenceStep(() =>
                      writeCe0PublicationReference(
                        tx,
                        contribution,
                        kernel,
                        options,
                      ),
                    );
                    yield* persistenceStep(() =>
                      advanceCe0PublicationReference(
                        tx,
                        contribution,
                        kernel,
                        options,
                      ),
                    );
                    return result.valueJson;
                  }).pipe(Effect.ensuring(lifetime.close));
                }),
            );
          }),
        ),
      );
    });
    return yield* runWithRequestRecovery(attempt, {
      hasRequestKey: true,
      projectFailure,
      isDecisionUncertain: (error) => error.reason === "decisionUncertain",
    });
  });
  return Object.freeze({ run, executionCount: () => executions });
});
