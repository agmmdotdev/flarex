import { Clock, Effect, Schema } from "effect";
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
  type CmsTransactionError,
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
import { runWithRequestRecovery } from "../src/relationalTransaction/requestRecovery";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../src/scopeClock";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1 } from "../src/committedPointOutcome";
import {
  allocatePointCommitKernelResult,
  readPointCommitDatabaseTime,
} from "../src/commitPublication/pointCommitProjection";
import {
  type ScopePublicationContribution,
  type ScopePublicationKernel,
} from "../src/commitPublication/scopePublicationModel";
import {
  ce0PersistenceStep as persistenceStep,
  projectCe0CmsRequestFailure as projectFailure,
} from "./ce0CmsReferencePersistence";
import { prepareCe0FirstInsertMaterialization } from "./ce0FirstInsertMaterialization";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CmsFinalDocumentChange } from "../src/cmsTransaction/documents";
import { makeCe0FirstInsertDocuments } from "./ce0FirstInsertDocuments";
import {
  writeCe0PublicationReference,
  advanceCe0PublicationReference,
} from "./ce0PublicationReference";

const decodeInput = Schema.decodeUnknownEffect(
  Schema.Union([
    Schema.Struct({
      count: Schema.Literals([0, 1, 8, 32]),
      prefix: Schema.NonEmptyString,
    }),
    Schema.Struct({
      titles: Schema.Array(Schema.String).check(Schema.isMaxLength(32)),
    }),
  ]),
  { onExcessProperty: "error" },
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

/** Test-only scalar request. Admission, schema validation, readers, lifetime and
 * physical recovery are common. First-insert execution, writes and publication are independent.
 * This incremental reference supplies no complete CE0 timing claim. */
export const makeCe0CmsMutationReference = Effect.fn("Ce0CmsReference.make")(
  function* <Failure>(
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
    const owner = Object.freeze({ hostId: Symbol("ce0.cms.reference") });
    let executions = 0;
    const run = Effect.fn("Ce0CmsReference.run")(function* (
      requestKey: string,
      args: Json,
    ): Effect.fn.Return<Json, CmsTransactionError> {
      const captured = yield* Effect.fromResult(
        capturePrivateJsonData(args, cmsLimits.commandBytes, cmsError),
      );
      // Explicit profile bound, even when a key happens to name another result.
      const insertInput = yield* decodeInput(captured.value).pipe(
        Effect.mapError(() => cmsError("unsupportedProfile")),
      );
      const insertCount =
        "titles" in insertInput ? insertInput.titles.length : insertInput.count;
      const key = yield* decodeRequestKey(requestKey).pipe(
        Effect.mapError((cause) => cmsError("invalidInput", cause)),
      );
      if (!/^cms\/[0-9a-f-]{36}$/.test(key))
        return yield* Effect.fail(cmsError("invalidInput"));
      const transactionId = crypto.randomUUID();
      const requestIdentity = Object.freeze({
        requestId: Symbol("ce0.cms.request"),
      });
      const attempt = Effect.fn("Ce0CmsReference.attempt")(function* (
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
                    const evidence =
                      yield* canonicalizeSuccessfulResultV1Effect({
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
                      expectedFunctionPath:
                        TransactionFunctionPathV1Schema.make(
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
                      const entered =
                        insertCount === 0
                          ? yield* enterApplicationDocumentParticipant(
                              participant,
                              tx,
                              located.authority,
                              clock,
                              state.schema,
                            ).pipe(
                              Effect.catchTag(
                                "ApplicationParticipantError",
                                (error) =>
                                  Effect.fail(
                                    cmsError(error.reason, error.cause),
                                  ),
                              ),
                            )
                          : null;
                      const applyInserts =
                        insertCount === 0
                          ? null
                          : yield* prepareCe0FirstInsertMaterialization(
                              tx,
                              participant,
                              located.authority,
                              clock,
                            );
                      const working =
                        insertCount === 0
                          ? null
                          : yield* makeCe0FirstInsertDocuments(
                              admission,
                              lifetime,
                              transactionId,
                              AppCreationTimeV1Schema.make(
                                yield* Clock.currentTimeMillis,
                              ),
                              participant.unique,
                            );
                      // Match the root invocation capture and accounting.
                      const child = yield* Effect.fromResult(
                        capturePrivateJsonData(
                          captured.value,
                          lifetime.remainingBytes(),
                          cmsError,
                        ),
                      );
                      yield* Effect.fromResult(lifetime.charge(child.bytes));
                      executions++;
                      const documents: Json[] = [];
                      if (working !== null)
                        for (let index = 0; index < insertCount; index++) {
                          const title =
                            "titles" in insertInput
                              ? insertInput.titles[index]
                              : `${insertInput.prefix}-${index.toString().padStart(2, "0")}`;
                          if (title === undefined)
                            return yield* Effect.fail(cmsError("invalidInput"));
                          documents.push(yield* working.insert(title));
                        }
                      const output = yield* Effect.fromResult(
                        capturePrivateJsonData(
                          documents,
                          lifetime.remainingBytes(),
                          cmsError,
                        ),
                      );
                      yield* Effect.fromResult(lifetime.charge(output.bytes));
                      const result =
                        yield* canonicalizeSuccessfulResultV1Effect(
                          output.value,
                        );
                      yield* Effect.fromResult(
                        lifetime.charge(result.canonicalBytes.byteLength),
                      );
                      const resultSha256 = yield* hash(result.canonicalBytes);
                      yield* lifetime.seal;
                      let changes: readonly CmsFinalDocumentChange[] = [];
                      let receiptCount = 0;
                      if (working !== null) {
                        const closed = yield* working.close();
                        changes = closed.changes;
                        receiptCount = closed.receiptCount;
                      }
                      const delta =
                        entered === null
                          ? null
                          : yield* entered
                              .prepareDelta([], [])
                              .pipe(
                                Effect.catchTag(
                                  "ApplicationParticipantError",
                                  (error) =>
                                    Effect.fail(
                                      cmsError(error.reason, error.cause),
                                    ),
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
                      if (applyInserts !== null)
                        yield* applyInserts(changes, allocation.commitSeq);
                      const adjacency =
                        delta === null
                          ? []
                          : yield* delta
                              .lower(allocation.commitSeq)
                              .pipe(
                                Effect.catchTag(
                                  "ApplicationParticipantError",
                                  (error) =>
                                    Effect.fail(
                                      cmsError(error.reason, error.cause),
                                    ),
                                ),
                              );
                      if (adjacency.length !== 0)
                        return yield* Effect.fail(
                          cmsError("unsupportedProfile"),
                        );
                      yield* Effect.fromResult(
                        lifetime.charge(receiptCount * 128),
                      );
                      const contribution: ScopePublicationContribution = {
                        authorityPins: {
                          scopeId: scope.scopeId,
                          requestKey: key,
                          functionPath: lookup.expectedFunctionPath,
                        },
                        rowIntents: changes,
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
  },
);
