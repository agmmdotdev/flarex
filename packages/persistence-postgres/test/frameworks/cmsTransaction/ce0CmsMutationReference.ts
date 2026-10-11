import { Cause, Clock, Effect, Schema } from "effect";
import {
  chargeHostPreparation,
  retainPreparedHost,
} from "../../../src/execution/preparation/preparedHostRuntime";
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
import type { CmsHostInput } from "../../../src/frameworks/cmsTransaction/host";
import {
  cmsError,
  cmsLimits,
  type CmsTransactionError,
} from "../../../src/frameworks/cmsTransaction/model";
import {
  prepareCmsApplicationFromBinding,
  requirePreparedCmsApplication,
  withCmsAdmission,
  requireCmsAdmission,
} from "../../../src/frameworks/cmsTransaction/admission";
import {
  prepareApplicationDocumentParticipant,
  enterApplicationDocumentParticipant,
  readPreparedApplicationDocumentParticipant,
} from "../../../src/storage/materialization/participant";
import { makeCmsRequestLifetime } from "../../../src/frameworks/cmsTransaction/lifetime";
import { capturePrivateJsonData } from "../../../src/values/privateJsonData";
import {
  hasRelationalSessionDatabase,
  runRelationalSession,
  readRelationalSessionCoLocatedInstallation,
  startRelationalRequestDeadline,
  boundRelationalRequestDeadline,
} from "../../../src/database/relationalTransaction/session";
import { runWithRequestRecovery } from "../../../src/database/relationalTransaction/requestRecovery";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { createCommittedPointOutcomeResolverV1 } from "../../../src/commit/committedPointOutcome";
import {
  allocatePointCommitKernelResult,
  readPointCommitDatabaseTime,
} from "../../../src/commit/publication/pointCommitProjection";
import {
  type ScopePublicationContribution,
  type ScopePublicationKernel,
} from "../../../src/commit/publication/scopePublicationModel";
import {
  ce0PersistenceStep as persistenceStep,
  projectCe0CmsRequestFailure as projectFailure,
} from "./ce0CmsReferencePersistence";
import {
  prepareCe0FirstInsertMaterialization,
  type Ce0FirstInsertMaterializationOptions,
} from "../../performance/ce0FirstInsertMaterialization";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { LogicalDocumentChange } from "../../../src/storage/documents/logicalDocuments/workingSet";
import { makeCe0FirstInsertDocuments } from "../../performance/ce0FirstInsertDocuments";
import {
  prepareCurrentApplicationBinding,
} from "../../../src/application/activation/currentBinding";
import {
  hasApplicationBindingComposition,
} from "../../../src/application/activation/repositoryIdentity";
import {
  writeCe0PublicationReference,
  advanceCe0PublicationReference,
} from "../../performance/ce0PublicationReference";

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
type ReferenceInput<Failure> = Pick<CmsHostInput<Failure>,
  "hostRuntime" | "database" | "controlDatabase" | "session" | "deploymentId" | "scopeId" |
  "authority" | "pointCommitAuthority" | "application" | "identityAndAccessPolicy" | "materialization"> &
  Readonly<{ referenceMaterialization?: Ce0FirstInsertMaterializationOptions }>;

export const makeCe0CmsMutationReference = Effect.fn("Ce0CmsReference.make")(function* <Failure>(input: ReferenceInput<Failure>) {
  const measurement = { executions: 0 };
  const retained = yield* retainPreparedHost(input.hostRuntime, composeCe0CmsMutationReference(input, measurement))
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
  return Object.freeze({ close: retained.close, executionCount: () => measurement.executions,
    run: (key: string, args: Json) => retained.use(host => host.run(key, args))
      .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))),
  });
});

const composeCe0CmsMutationReference = Effect.fn("Ce0CmsReference.compose")(
  function* <Failure>(
    input: ReferenceInput<Failure>,
    measurement: { executions: number },
  ) {
    const {
      database,
      controlDatabase,
      session,
      deploymentId,
      scopeId,
      application,
      pointCommitAuthority,
    } = input;
    if (!hasRelationalSessionDatabase(session, database))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    if (!hasApplicationBindingComposition(application, input.authority))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const options = Object.freeze({ ...input.materialization });
    const referenceOptions = Object.freeze({ ...input.referenceMaterialization });
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
    yield* chargeHostPreparation({ deploymentId, identityDigest, commands: ["measuredInsert"] })
      .pipe(Effect.mapError(projectFailure));
    const owner = Object.freeze({ hostId: Symbol("ce0.cms.reference") });
    const currentPreparation = yield* prepareCurrentApplicationBinding(application, database, (selection, context) => Effect.gen(function* () {
      const prepared = yield* prepareCmsApplicationFromBinding(selection, controlDatabase, deploymentId, scopeId);
      const preparation = yield* requirePreparedCmsApplication(prepared);
      if (preparation.schema.relations.length !== 0 || context.planningHead === undefined)
        return yield* Effect.fail(cmsError("unsupportedProfile"));
      const participant = yield* prepareApplicationDocumentParticipant(preparation.schema, controlDatabase, context.authority,
        pointCommitAuthority, options, [...preparation.tableIds], { intrinsic: preparation.intrinsicDefinitions, developer: preparation.indexDefinitions,
          unique: preparation.uniqueDefinitions, relations: preparation.relations, planningHead: context.planningHead }).pipe(
        Effect.catchTag("LogicalDocumentMaterializationError", error => Effect.fail(cmsError(error.reason, error.cause))));
      const participantState = yield* readPreparedApplicationDocumentParticipant(participant);
      return { prepared, participant, participantState };
    }), { selection: { deploymentId, scopeId },
      installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(session, database)),
      candidateIssuer: pointCommitAuthority });
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
      const deadline = yield* startRelationalRequestDeadline(cmsLimits.commandMs).pipe(Effect.mapError(projectFailure));
      const attempt = Effect.fn("Ce0CmsReference.attempt")(function* (
        recoverOnly: boolean,
      ) {
        return yield* currentPreparation.withEntry(({ payload: { prepared, participant, participantState } }, enter) =>
          runRelationalSession(session, "command", { enter: (tx, requireInstallation) =>
            enter(tx, requireInstallation, Effect.gen(function* () {
              yield* runDrizzleStatementEffect(
                tx.execute(
                  sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`,
                ),
                (cause) => cmsError("statementFailure", cause),
              );
            }), ({ clock, authority: entryAuthority, checked }) => Effect.scoped(Effect.gen(function* () {
              return yield* withCmsAdmission(
                prepared,
                tx,
                entryAuthority,
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
                      projectScopeIdUuidV1Result(entryAuthority.scopeId),
                    );
                    const epoch = yield* Effect.fromResult(
                      projectScopeEpochUuidV1Result(clock.epoch),
                    );
                    const evidence =
                      yield* canonicalizeSuccessfulResultV1Effect({
                        domain: "flarex.private.cms-command",
                        version: 1,
                        deploymentId,
                        scopeId: entryAuthority.scopeId,
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
                              entryAuthority,
                              clock,
                              state.schema,
                            ).pipe(
                              Effect.catchTag(
                                "LogicalDocumentMaterializationError",
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
                              entryAuthority,
                              clock,
                              referenceOptions,
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
                              participantState.unique,
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
                      measurement.executions++;
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
                      let changes: readonly LogicalDocumentChange[] = [];
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
                                  "LogicalDocumentMaterializationError",
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
                                  "LogicalDocumentMaterializationError",
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
                  }), undefined, checked,
              );
            })), "ordinaryWrite") }, deadline));
      });
      return yield* boundRelationalRequestDeadline(deadline, runWithRequestRecovery(attempt, {
        hasRequestKey: true,
        projectFailure,
        isDecisionUncertain: (error) => error.reason === "decisionUncertain",
      })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
    });
    return Object.freeze({ run });
  },
);
