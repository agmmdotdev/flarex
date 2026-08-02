import { createHash } from "node:crypto";

import {
  installedPrivateAnalyzerReleaseTupleV1,
} from "@flarex/analysis/internal/private-analyzer-release-v1";
import {
  makeDeclarativeV2SemanticStreamBudgetV1,
  type DeclarativeV2AnalyzerCompleteV1,
  type DeclarativeV2AnalyzerRestartEvidenceClaimV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import {
  executePointMutationV1,
  type PointMutationRuntimeContextV1,
} from "../../function-runtime/src/pointMutation";
import {
  analyzeStandardApplicationV1,
} from "@flarex/standard-application-analysis/v1";
import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
  type StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import { Effect, Result } from "effect";
import {
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  encodeDeclarativeV2FutureRegistrationIntentV1,
} from "flarex-protocol/internal/declarative-v2-future-registration-intent-v1";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  decodeActivePointMutationTargetMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  decodeSchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  makeRuntimeArtifactPublisherFixtureV1,
  type RuntimeArtifactPublisherFixtureV1,
} from "./runtimeArtifactPublisherFixture";

import {
  makePrivateApplicationRevisionRegistrationEvidenceBridgeV1,
} from "../../../apps/analyzer/src/PrivateApplicationRevisionRegistrationEvidence";
import {
  makePrivateDeclarativeV2AnalyzerHostV1,
  PrivateDeclarativeV2AnalyzerHostV1Error,
  type PrivateDeclarativeV2AnalyzerAdmissionV1,
} from "../../../apps/analyzer/src/DeclarativeV2AnalyzerPort";
import {
  loadPrivateDeclarativeV2SettledRestartEvidenceV1,
  persistPrivateDeclarativeV2RestartEvidenceV1,
  settlePrivateDeclarativeV2AnalyzerCommandV1,
} from "../../../apps/analyzer/src/PrivateDeclarativeV2AnalyzerRestartPlan";
import {
  makePointMutationExactRuntimeBindingRunnerV1,
  type PointMutationExactRuntimeArtifactHostBindingV1,
} from "../../executor/src/pointMutationExactRuntimeBinding";
import {
  withAuthenticatedApplicationRevisionEvidenceTestDriverV1,
  type AuthenticatedApplicationRevisionEvidenceTestDriverV1,
  type AuthenticatedDeclarativeV2PreparedCommandTestDriverV1,
} from "../../flarex-backend/test/authenticatedApplicationRevisionEvidenceFixture";
import type {
  DeclarativeV2AuthenticatedCommandProducerV1Error,
} from "../../flarex-backend/src/declarativeV2/AuthenticatedCommandProducer";
import {
  makeApplicationRevisionRegistrationContextV1,
  type DurableRegisteredApplicationRevisionV1,
  type LocatedApplicationRevisionRegistrationTargetV1,
  type PrivateApplicationRevisionAnalysisPreparationV1,
} from "../src/applicationRevisionRegistrationV1";
import {
  makeAuthenticatedDeclarativeV2CommandBridgeV1,
  type AuthenticatedDeclarativeV2CommandBridgeV1,
  type AuthenticatedDeclarativeV2CommandSessionV1,
} from "../src/authenticatedDeclarativeV2CommandBridgeV1";
import {
  decodeCanonicalFunctionMetadataSetV1,
} from "../src/functionMetadataCodec";
import {
  hashFunctionMetadataSha256V1,
} from "../src/functionMetadataSha256";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  makeDeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryV2,
} from "../src/declarativeV2VerifierProgressRepositoryV2";
import {
  getSchemaVersionArtifactByIdEffect,
} from "../src/schemaVersionArtifacts";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  executePrivateRegisteredRevisionPointMutationThroughC07V1,
  loadPrivateC07DurableAgreementV1,
  type C07PrivatePointMutationLaneV1,
  type C07SeedLiveRowV1,
} from "./c07PrivatePointMutationHarness";

const UTF8 = new TextEncoder();
const DEPLOYMENT_ID = "deployment_fsv03_private";
const PROJECT_ID = "project_fsv03_private";
const SCOPE_ID = decodeReplacementScopeIdV1(
  "scope_f3000000-0000-4000-8000-000000000001",
);
const EPOCH = "epoch_f3000000-0000-4000-8000-000000000002";
const LOCATOR = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "fsv03-private",
  schemaName: "public",
});
const MAXIMUM = 20_000_000n;
const FSV06_COMMAND_MAXIMUM = 40_000_000n;
const OPERATION_BUDGET = Object.freeze({
  maximumCalls: 256,
  maximumRows: 256,
  maximumFrameBytes: 128 * 1_048_576,
  maximumCanonicalBytes: 128 * 1_048_576,
  maximumHashBytes: 128 * 1_048_576,
  maximumElapsedMilliseconds: 120_000,
});
const PAGE_BUDGET = Object.freeze({
  ...OPERATION_BUDGET,
  maximumRows: 10_000,
  maximumPages: 1_024,
  maximumPayloadBytes: 128 * 1_048_576,
});
const PROGRESS_OPTIONS = Object.freeze({
  claimDurationMilliseconds: 120_000,
  randomUuid: uuidFactory("f3010000"),
  monotonicMilliseconds: () => 0,
});
const ZERO_DIGEST = new Uint8Array(32);

type Persistence =
  | PGliteFlarexPersistence
  | PostgresFlarexPersistence;

export interface Fsv03PrivateAnalyzerToPostgresLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: Persistence;
  readonly mutationCount?: number;
  readonly selectionFault?: "functionMetadataDigestMismatch";
  readonly registrationTarget:
    LocatedApplicationRevisionRegistrationTargetV1;
  /** FSV04-only handoff for probing the exact R2 bodies published by FSV02. */
  readonly runtimeArtifacts?: RuntimeArtifactPublisherFixtureV1;
  readonly c07: C07PrivatePointMutationLaneV1;
}

export interface Fsv03PrivateAnalyzerToPostgresProofV1 {
  readonly lane: Fsv03PrivateAnalyzerToPostgresLaneV1["name"];
  readonly analysisKind: "registration_page";
  readonly registrationKind: "registered";
  readonly replayKind: "replayed";
  readonly durableAnalyzerEvidenceReloads: ReadonlyArray<
    "parse_module" | "link_page"
  >;
  readonly revisionId: string;
  readonly revisionStatus: "inactive";
  readonly forgedSelectionRejected: true;
  readonly mutationResultKind: "published" | "replayed";
  readonly mutationCommitSeq: string;
  readonly mutationCount: number;
  readonly mutationCommitSeqs: ReadonlyArray<string>;
  readonly mutationValue: unknown;
  readonly coldOutcomeCommitSeq: string;
  readonly durable: Readonly<{
    readonly currentValue: unknown;
    readonly commitSeqs: ReadonlyArray<string>;
    readonly changeCommitSeqs: ReadonlyArray<string>;
    readonly outcomeCommitSeqs: ReadonlyArray<string>;
    readonly outboxCommitSeqs: ReadonlyArray<string>;
    readonly completedRowCount: number;
  }>;
}

interface CommandSettlementState {
  readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly settlement: Readonly<{
    readonly receiptSha256: Uint8Array;
    readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  }>;
  readonly evidenceRootSha256: Uint8Array;
}

export interface Fsv04RegisteredRevisionFixtureInputV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: Persistence;
  readonly registrationTarget:
    LocatedApplicationRevisionRegistrationTargetV1;
  readonly runtimeArtifacts: RuntimeArtifactPublisherFixtureV1;
  readonly physicalLocator?: ScopePhysicalLocator;
  readonly revisionVariant?: string;
  readonly provisionScope?: boolean;
}

/** Test-only reuse of the accepted FSV01/FSV02 half of the FSV03 chain. */
export async function prepareFsv04RegisteredRevisionFixtureV1(
  input: Fsv04RegisteredRevisionFixtureInputV1,
) {
  const physicalLocator = input.physicalLocator ?? LOCATOR;
  if (input.provisionScope !== false) {
    await provisionRegistrationScope(input.persistence, physicalLocator);
  }
  const definition = Result.getOrThrow(
    prepareStandardApplicationDefinitionV1(
      definitionInput(input.revisionVariant),
    ),
  );
  const commandBudgetMaximum = input.revisionVariant?.startsWith("fsv06-")
    ? FSV06_COMMAND_MAXIMUM
    : MAXIMUM;
  const registration = await Effect.runPromise(Effect.scoped(
    withAuthenticatedApplicationRevisionEvidenceTestDriverV1(
      definition,
      {
        projectId: PROJECT_ID,
        deploymentId: DEPLOYMENT_ID,
        deploymentCreatedAt: "2026-07-31T00:00:00.000Z",
        commandBudgetMaximum,
      },
      driver => runAuthenticatedAnalysisAndRegistration(
        input,
        definition,
        driver,
        input.revisionVariant === undefined
          ? `register:fsv03:${input.name}`
          : `register:fsv03:${input.name}:${input.revisionVariant}`,
        commandBudgetMaximum,
      ),
    ),
  ));
  return Object.freeze({
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    physicalLocator,
    definition,
    ...registration,
  });
}

export async function proveFsv03PrivateAnalyzerToPostgresSystemV1(
  lane: Fsv03PrivateAnalyzerToPostgresLaneV1,
): Promise<Fsv03PrivateAnalyzerToPostgresProofV1> {
  await provisionRegistrationScope(lane.persistence);
  const definition = Result.getOrThrow(
    prepareStandardApplicationDefinitionV1(definitionInput()),
  );
  const registration = await Effect.runPromise(Effect.scoped(
    withAuthenticatedApplicationRevisionEvidenceTestDriverV1(
      definition,
      {
        projectId: PROJECT_ID,
        deploymentId: DEPLOYMENT_ID,
        deploymentCreatedAt: "2026-07-31T00:00:00.000Z",
        commandBudgetMaximum: MAXIMUM,
      },
      driver => runAuthenticatedAnalysisAndRegistration(
        lane,
        definition,
        driver,
      ),
    ),
  ));
  if (lane.selectionFault === "functionMetadataDigestMismatch") {
    await replaceFunctionMetadataBytesWithoutDigest(
      lane.persistence,
      registration.registered,
    );
  }
  const selection = await selectInactiveRevision(
    lane.persistence,
    registration.registered,
  );
  const forgedSelectionRejected =
    Result.isFailure(selection.claim(Object.freeze({ ...selection.handle })));
  if (!forgedSelectionRejected) {
    throw new Error("FSV03 accepted a cloned revision-selection authority.");
  }
  const selected = Result.getOrThrow(selection.claim(selection.handle));
  const tableId = selected.schemaManifest.tableDefinitions.tables[0]
    ?.tableId;
  if (tableId === undefined) {
    throw new Error("FSV03 selected revision omitted its orders table.");
  }
  const mutationCount = lane.mutationCount ?? 1;
  if (
    !Number.isSafeInteger(mutationCount) ||
    mutationCount < 1 ||
    mutationCount > 16
  ) {
    throw new Error("FSV03 mutationCount must be an integer from 1 through 16.");
  }
  const mutations = Array.from({ length: mutationCount }, (_, index) => {
    const rowId = decodeAppRowIdHexV1(
      (0x37 + index).toString(16).padStart(2, "0").repeat(16),
    );
    const documentId = appDocumentIdV1FromRowIdentity({
      tableId: decodeCatalogTableId(tableId),
      rowId,
    });
    return Object.freeze({ index, rowId, documentId });
  });
  for (const mutation of mutations) {
    await lane.c07.seedBaselineLiveRow({
      scopeId: SCOPE_ID,
      schemaVersionId: registration.registered.schemaVersionId,
      tableId: decodeCatalogTableId(tableId),
      rowId: mutation.rowId,
      creationTime: decodeAppCreationTimeV1(mutation.index + 1),
      value: Object.freeze({
        _id: mutation.documentId,
        _creationTime: mutation.index + 1,
        status: "pending",
      }),
    } satisfies C07SeedLiveRowV1);
  }
  const randomUuid = uuidFactory(
    lane.name === "pglite" ? "f3020000" : "f3030000",
  );
  const mutationProofs = await Promise.all(
    mutations.map(mutation =>
      executePrivateRegisteredRevisionPointMutationThroughC07V1({
        lane: lane.c07,
        target: selected,
        functionPath:
          TransactionFunctionPathV1Schema.make("orders:place"),
        args: { status: "complete" },
        requestKey:
          TransactionRequestKeyV1Schema.make(
            `request:fsv03:${lane.name}:${mutation.index}`,
          ),
        runtimeRunner:
          makePointMutationExactRuntimeBindingRunnerV1(
            pointMutationRuntimeBinding(mutation.documentId),
          ),
        randomUuid,
      })
    ),
  );
  const mutation = mutationProofs[0]!;
  const scopeUuid = projectScopeIdUuidV1(SCOPE_ID).scopeUuid;
  const durable = await loadPrivateC07DurableAgreementV1(
    lane.persistence,
    scopeUuid,
  );
  const currentRows = await lane.persistence.query<{ value_json: unknown }>(
    `select revision.value_json
       from fx_app_row_current as current_row
       join fx_app_row_rev as revision
         on revision.scope_uuid = current_row.scope_uuid
        and revision.table_id = current_row.table_id
        and revision.row_id = current_row.row_id
        and revision.commit_seq = current_row.commit_seq
      where current_row.scope_uuid = $1`,
    [scopeUuid],
  );
  const completedRowCount = currentRows.rows.filter(row =>
    row.value_json !== null &&
    typeof row.value_json === "object" &&
    !Array.isArray(row.value_json) &&
    "status" in row.value_json &&
    row.value_json.status === "complete"
  ).length;
  if (registration.registered.kind !== "registered") {
    throw new Error("FSV03 first registration unexpectedly replayed.");
  }
  if (registration.replayed.kind !== "replayed") {
    throw new Error("FSV03 registration replay unexpectedly inserted.");
  }
  return Object.freeze({
    lane: lane.name,
    analysisKind: registration.analysis.kind,
    registrationKind: registration.registered.kind,
    replayKind: registration.replayed.kind,
    durableAnalyzerEvidenceReloads:
      registration.durableAnalyzerEvidenceReloads,
    revisionId: registration.registered.revisionId,
    revisionStatus: registration.registered.status,
    forgedSelectionRejected: true,
    mutationResultKind: mutation.resultKind,
    mutationCommitSeq: mutation.commitSeq,
    mutationCount,
    mutationCommitSeqs: Object.freeze(
      sortNumericStrings(mutationProofs.map(item => item.commitSeq)),
    ),
    mutationValue: structuredClone(mutation.value),
    coldOutcomeCommitSeq: mutation.coldOutcomeCommitSeq,
    durable: Object.freeze({
      currentValue: structuredClone(durable.currentValue),
      commitSeqs: Object.freeze(sortNumericStrings(durable.commitSeqs)),
      changeCommitSeqs: Object.freeze(
        sortNumericStrings(durable.changeCommitSeqs),
      ),
      outcomeCommitSeqs: Object.freeze(
        sortNumericStrings(durable.outcomeCommitSeqs),
      ),
      outboxCommitSeqs: Object.freeze(
        sortNumericStrings(durable.outboxCommitSeqs),
      ),
      completedRowCount,
    }),
  });
}

const runAuthenticatedAnalysisAndRegistration = Effect.fn(
  "FSV03.runAuthenticatedAnalysisAndRegistration",
)(function* (
  lane: Pick<
    Fsv03PrivateAnalyzerToPostgresLaneV1,
    "name" | "persistence" | "registrationTarget" | "runtimeArtifacts"
  >,
  definition: PreparedStandardApplicationDefinitionV1,
  driver: AuthenticatedApplicationRevisionEvidenceTestDriverV1,
  registrationRequestKey = `register:fsv03:${lane.name}`,
  commandBudgetMaximum = MAXIMUM,
) {
    const evidenceBridge =
      makePrivateApplicationRevisionRegistrationEvidenceBridgeV1(driver.port);
    const authenticatedEvidence = yield* evidenceBridge.issue(
      driver.request,
      driver.preparation,
      definition,
    );
    const registrationContext = makeApplicationRevisionRegistrationContextV1({
      authority: {
        scopeMetadata: lane.persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error(
              "FSV03 shared registration must not read split receipts.",
            );
          },
        },
        scopeClockTargets: {
          resolve: async () => lane.registrationTarget,
        },
      },
      functionMetadataBudget: {
        maximumFunctionsVisited: 16,
        maximumValidatorNodesVisited: 256,
        maximumCanonicalUtf8BytesMaterialized: 64_000,
      },
      progressRepository: PROGRESS_OPTIONS,
      evidenceAuthority: evidenceBridge.authority,
      runtimeArtifactPublisher:
        (lane.runtimeArtifacts ?? makeRuntimeArtifactPublisherFixtureV1())
          .publisher,
    });
    const preparation = yield* registrationContext.prepareAnalysis({
      preparedDefinition: definition,
      authenticatedEvidence,
      attemptCeilings: budget(
        "attempt_ceilings",
        commandBudgetMaximum * 4n,
      ),
    });
    const repository = makeDeclarativeV2VerifierProgressRepositoryV2(
      lane.registrationTarget,
      PROGRESS_OPTIONS,
    );
    const persistenceBridge =
      makeAuthenticatedDeclarativeV2CommandBridgeV1(repository, {
        preparedReservations: driver.preparedReservations,
      });
    const acquired = yield* Effect.acquireRelease(
      persistenceBridge.acquire(
        SCOPE_ID,
        preparation.attemptSha256,
        OPERATION_BUDGET,
      ),
      acquired => persistenceBridge.release(
        acquired.session,
        OPERATION_BUDGET,
      ).pipe(Effect.orDie),
    );
    const sourceCommand = yield* driver.prepareCommand({
      kind: "source_page",
      firstModuleOrdinal: 0n,
      moduleCount: 1n,
    });
    const sessionBindings = Object.freeze({
      attemptSha256: new Uint8Array(preparation.attemptSha256),
      candidateSha256: new Uint8Array(preparation.candidateSha256),
      authenticatedInputSha256: new Uint8Array(
        sourceCommand.commitments.freshAuthenticatedInputSha256,
      ),
      analyzerReleaseSha256: analyzerReleaseSha256(),
      analyzerIdentitySha256: new Uint8Array(
        sourceCommand.commitments.analyzerIdentitySha256,
      ),
      verifierIdentitySha256: new Uint8Array(
        sourceCommand.commitments.verifierIdentitySha256,
      ),
    });
    const sessionAuthority = Object.freeze({});
    const commandAdmissions =
      new WeakMap<object, PrivateDeclarativeV2AnalyzerAdmissionV1>();
    const host = makePrivateDeclarativeV2AnalyzerHostV1({
      claims: {
        session(authority) {
          return authority === sessionAuthority
            ? Effect.succeed(sessionBindings)
            : Effect.fail(new PrivateDeclarativeV2AnalyzerHostV1Error({
              operation: "open",
              reason: "invalidAdmission",
              path: "sessionAuthority",
            }));
        },
        command(_session, capability) {
          const admission = commandAdmissions.get(capability);
          return admission === undefined
            ? Effect.fail(new PrivateDeclarativeV2AnalyzerHostV1Error({
              operation: "execute",
              reason: "invalidAdmission",
              path: "commandAuthority",
            }))
            : Effect.succeed(admission);
        },
        restart() {
          return Effect.fail(new PrivateDeclarativeV2AnalyzerHostV1Error({
            operation: "rehydrate",
            reason: "invalidAdmission",
            path: "restartAuthority",
          }));
        },
      },
    });
    let registrationProduced:
      | Effect.Success<
        ReturnType<
          AuthenticatedDeclarativeV2PreparedCommandTestDriverV1["produce"]
        >
      >
      | undefined;
    let commandAuthority: unknown;
    const durableAnalyzerEvidenceReloads: Array<
      "parse_module" | "link_page"
    > = [];
    const analysisContext = Object.freeze({
      analyze: () =>
        Effect.gen(function* () {
          const analyzerSession = yield* host.open(sessionAuthority);
          const observed = yield* repository.observeAttempt(
            SCOPE_ID,
            preparation.attemptSha256,
            OPERATION_BUDGET,
          );
          if (observed.kind !== "present") {
            return yield* Effect.die(
              new Error("FSV03 attempt disappeared."),
            );
          }
          let currentProgress = observed.attempt.progress;
          let resultingUsage = observed.attempt.usage;
          const source = yield* executeCommand({
            driver,
            preparedCommand: sourceCommand,
            persistenceBridge,
            persistenceSession: acquired.session,
            host,
            analyzerSession,
            commandAdmissions,
            currentProgress,
            resultingUsage,
            preparation,
            restartCommitments: driver.restartCommitments,
            selection: "source_page",
            parsePagesRootSha256: ZERO_DIGEST,
          });
          currentProgress = source.settlement.nextProgress;
          resultingUsage = source.resultingUsage;
          const parseCommand = yield* driver.prepareCommand({
            kind: "parse_module",
            moduleOrdinal: 0n,
          });
          const parsed = yield* executeCommand({
            driver,
            preparedCommand: parseCommand,
            persistenceBridge,
            persistenceSession: acquired.session,
            host,
            analyzerSession,
            commandAdmissions,
            currentProgress,
            resultingUsage,
            preparation,
            restartCommitments: driver.restartCommitments,
            selection: "parse_module",
            parsePagesRootSha256: ZERO_DIGEST,
          });
          currentProgress = parsed.settlement.nextProgress;
          resultingUsage = parsed.resultingUsage;
          const parsePagesRootSha256 = parsed.evidenceRootSha256;
          const coldParse = yield*
            loadPrivateDeclarativeV2SettledRestartEvidenceV1({
              bridge: persistenceBridge,
              session: acquired.session,
              commandKind: "parse_module",
              sequence: parsed.settlement.sequence,
              reservationSha256: parsed.settlement.reservationSha256,
              outputManifestSha256:
                frameSha256(parsed.settlement.outputManifest),
              receiptSha256: parsed.settlement.receiptSha256,
              pageBudget: PAGE_BUDGET,
            });
          if (coldParse.pages.length === 0) {
            return yield* Effect.die(
              new Error(
                "FSV03 cold parse evidence reload omitted persisted pages.",
              ),
            );
          }
          durableAnalyzerEvidenceReloads.push("parse_module");
          const registrationCommand = yield* driver.prepareCommand({
            kind: "registration_page",
          });
          const linkCommand = yield* driver.prepareCommand({
            kind: "link_page",
          });
          const linkProposal = yield* persistenceBridge.proposeReservation(
            acquired.session,
            "link_page",
          );
          const linkAuthority = yield* linkCommand.bindReservation(
            linkProposal.lineage,
          );
          const linkReady = yield* persistenceBridge.prepareReservation(
            acquired.session,
            linkProposal.proposal,
            linkAuthority,
          );
          const nextProgress = Object.freeze({
            kind: "progress_cursor" as const,
            phase: "registration" as const,
            settledSequence: linkReady.reservation.sequence,
            moduleOrdinal: 0n,
            edgeOrdinal: 0n,
            pageOrdinal: 0n,
            previousReceiptSha256:
              linkReady.reservation.predecessorReceiptSha256 === null
                ? null
                : new Uint8Array(
                  linkReady.reservation.predecessorReceiptSha256,
                ),
          });
          const intent = Result.getOrThrow(
            encodeDeclarativeV2FutureRegistrationIntentV1({
              attemptSha256: preparation.attemptSha256,
              candidateSha256: preparation.candidateSha256,
              linkReservationSha256: linkReady.reservationSha256,
              linkSequence: linkReady.reservation.sequence,
              registrationSequence: linkReady.reservation.sequence + 1n,
              registrationCurrentProgressSha256:
                frameSha256(nextProgress),
              registrationCommandBudgetSha256:
                registrationCommand.commitments.commandBudgetSha256,
              registrationCommandInputSha256:
                registrationCommand.commitments.commandInputSha256,
              freshAuthenticatedInputSha256:
                registrationCommand.commitments.freshAuthenticatedInputSha256,
              parsePagesRootSha256,
              analyzerReleaseSha256: sessionBindings.analyzerReleaseSha256,
              analyzerIdentitySha256:
                registrationCommand.commitments.analyzerIdentitySha256,
              verifierIdentitySha256:
                registrationCommand.commitments.verifierIdentitySha256,
            }),
          );
          const intentSha256 = sha256(intent.canonicalBytes);
          const linked = yield* executeCommand({
            driver,
            preparedCommand: linkCommand,
            persistenceBridge,
            persistenceSession: acquired.session,
            host,
            analyzerSession,
            commandAdmissions,
            currentProgress,
            resultingUsage,
            preparation,
            restartCommitments: driver.restartCommitments,
            selection: "link_page",
            parsePagesRootSha256,
            futureRegistrationIntentBytes: intent.canonicalBytes,
            futureRegistrationIntentSha256: intentSha256,
            nextProgress,
            preparedReservation: linkReady,
          });
          currentProgress = linked.settlement.nextProgress;
          resultingUsage = linked.resultingUsage;
          const coldLink = yield*
            loadPrivateDeclarativeV2SettledRestartEvidenceV1({
              bridge: persistenceBridge,
              session: acquired.session,
              commandKind: "link_page",
              sequence: linked.settlement.sequence,
              reservationSha256: linked.settlement.reservationSha256,
              outputManifestSha256:
                frameSha256(linked.settlement.outputManifest),
              receiptSha256: linked.settlement.receiptSha256,
              pageBudget: PAGE_BUDGET,
            });
          if (coldLink.pages.length === 0) {
            return yield* Effect.die(
              new Error(
                "FSV03 cold link evidence reload omitted persisted pages.",
              ),
            );
          }
          durableAnalyzerEvidenceReloads.push("link_page");
          const registered = yield* executeCommand({
            driver,
            preparedCommand: registrationCommand,
            persistenceBridge,
            persistenceSession: acquired.session,
            host,
            analyzerSession,
            commandAdmissions,
            currentProgress,
            resultingUsage,
            preparation,
            restartCommitments: driver.restartCommitments,
            selection: "registration_page",
            parsePagesRootSha256,
            futureRegistrationIntentBytes: intent.canonicalBytes,
            futureRegistrationIntentSha256: intentSha256,
            semantic: definition.artifactIngressPlan.semantic,
          });
          registrationProduced = registered.produced;
          if (registered.complete.kind !== "registration_page") {
            return yield* Effect.die(
              new Error(
                "FSV03 analyzer omitted registration terminal result.",
              ),
            );
          }
          return registered.complete;
        }),
    });
    const analysis = yield* analyzeStandardApplicationV1(
      definition,
      analysisContext,
    );
    if (registrationProduced === undefined) {
      return yield* Effect.die(
        new Error("FSV03 lost registration producer authority."),
      );
    }
    commandAuthority = yield* evidenceBridge.bindCommand(
      authenticatedEvidence,
      driver.request,
      registrationProduced.result,
      preparation,
    );
    yield* registrationContext.correlateAnalysis(
      preparation,
      analysis,
      commandAuthority,
    );
    const registered = yield* registrationContext.register(
      analysis,
      registrationRequestKey,
    );
    const replayed = yield* registrationContext.register(
      analysis,
      registrationRequestKey,
    );
    return Object.freeze({
      analysis,
      registered,
      replayed,
      durableAnalyzerEvidenceReloads:
        Object.freeze([...durableAnalyzerEvidenceReloads]),
    });
});

const executeCommand = Effect.fn("FSV03.executeCommand")(function* (
  input: Readonly<{
  readonly driver: AuthenticatedApplicationRevisionEvidenceTestDriverV1;
  readonly preparedCommand:
    AuthenticatedDeclarativeV2PreparedCommandTestDriverV1;
  readonly persistenceBridge: AuthenticatedDeclarativeV2CommandBridgeV1<
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly persistenceSession: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly host: ReturnType<typeof makePrivateDeclarativeV2AnalyzerHostV1>;
  readonly analyzerSession: Effect.Success<
    ReturnType<
      ReturnType<typeof makePrivateDeclarativeV2AnalyzerHostV1>["open"]
    >
  >;
  readonly commandAdmissions:
    WeakMap<object, PrivateDeclarativeV2AnalyzerAdmissionV1>;
  readonly currentProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly preparation: PrivateApplicationRevisionAnalysisPreparationV1;
  readonly restartCommitments:
    AuthenticatedApplicationRevisionEvidenceTestDriverV1[
      "restartCommitments"
    ];
  readonly selection:
    | "source_page"
    | "parse_module"
    | "link_page"
    | "registration_page";
  readonly parsePagesRootSha256: Uint8Array;
  readonly futureRegistrationIntentBytes?: Uint8Array;
  readonly futureRegistrationIntentSha256?: Uint8Array;
  readonly nextProgress?: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly preparedReservation?: Readonly<{
    readonly ready: Parameters<
      AuthenticatedDeclarativeV2CommandBridgeV1["reservePrepared"]
    >[0];
    readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
    readonly reservationSha256: Uint8Array;
  }>;
  readonly semantic?:
    PreparedStandardApplicationDefinitionV1["artifactIngressPlan"]["semantic"];
  }>,
) {
    const preparedReservation = input.preparedReservation ??
      (yield* Effect.gen(function* () {
        const proposal = yield* input.persistenceBridge.proposeReservation(
          input.persistenceSession,
          input.selection,
        );
        const authority = yield* input.preparedCommand.bindReservation(
          proposal.lineage,
        );
        return yield* input.persistenceBridge.prepareReservation(
          input.persistenceSession,
          proposal.proposal,
          authority,
        );
      }));
    const reserved = yield* input.persistenceBridge.reservePrepared(
      preparedReservation.ready,
      input.futureRegistrationIntentBytes ?? null,
      OPERATION_BUDGET,
    );
    const produced = yield* input.preparedCommand.produce(
      reserved.reservation,
    );
    input.commandAdmissions.set(produced.capability, {
      currentProgress: input.currentProgress,
      ...(input.nextProgress === undefined
        ? {}
        : { nextProgress: input.nextProgress }),
      ...(input.futureRegistrationIntentSha256 === undefined
        ? {}
        : {
          futureRegistrationIntentSha256:
            input.futureRegistrationIntentSha256,
        }),
      totalModuleCount: 1n,
      parsePagesRootSha256: input.parsePagesRootSha256,
      analyzerReleaseSha256: analyzerReleaseSha256(),
      ...(input.semantic === undefined
        ? {}
        : {
          semanticBudget: Result.getOrThrow(
            makeDeclarativeV2SemanticStreamBudgetV1(
              input.semantic.bytes.byteLength,
              input.semantic.maximumRecordBytes,
              input.semantic.recordCount,
              input.semantic.bytes.byteLength,
            ),
          ),
        }),
    });
    const complete = yield* input.host.execute({
      session: input.analyzerSession,
      commandFactory: produced.commandFactory,
      capability: produced.capability,
      transportBudget: produced.transportBudget,
      allowance: 1_024,
    });
    const terminal = yield* materializeTerminalEvidence({
      ...input,
      complete,
      reservation: reserved.reservation,
      work: reserved.work,
      commandBudget: input.preparedCommand.commandBudget,
    });
    const commandUsage = Object.freeze({
      ...terminal.actual,
      kind: "command_budget" as const,
    });
    const resultingUsage = addUsage(
      input.resultingUsage,
      input.preparedCommand.commandBudget,
    );
    const receipt = Object.freeze({
      kind: "command_receipt" as const,
      reservationSha256: frameSha256(reserved.reservation),
      commandUsageSha256: frameSha256(commandUsage),
      resultingAttemptUsageSha256: frameSha256(resultingUsage),
      outputManifestSha256: frameSha256(terminal.outputManifest),
      nextProgressSha256: frameSha256(terminal.nextProgress),
    }) satisfies DeclarativeV2VerifierCommandReceiptFrameV2;
    const settlement = yield* settlePrivateDeclarativeV2AnalyzerCommandV1({
      host: input.host,
      bridge: input.persistenceBridge,
      work: reserved.work,
      result: complete,
      requestSha256: produced.receipt.requestSha256,
      outputManifest: terminal.outputManifest,
      commandUsage,
      resultingUsage,
      nextProgress: terminal.nextProgress,
      receipt,
      operationBudget: OPERATION_BUDGET,
    });
    return Object.freeze({
      complete,
      produced,
      resultingUsage,
      settlement,
      evidenceRootSha256:
        new Uint8Array(terminal.outputManifest.evidenceRootSha256),
    });
});

const materializeTerminalEvidence = Effect.fn(
  "FSV03.materializeTerminalEvidence",
)(function* (input: Readonly<{
  readonly complete: DeclarativeV2AnalyzerCompleteV1;
  readonly host: ReturnType<typeof makePrivateDeclarativeV2AnalyzerHostV1>;
  readonly analyzerSession: Effect.Success<
    ReturnType<
      ReturnType<typeof makePrivateDeclarativeV2AnalyzerHostV1>["open"]
    >
  >;
  readonly persistenceBridge: AuthenticatedDeclarativeV2CommandBridgeV1<
    DeclarativeV2AuthenticatedCommandProducerV1Error
  >;
  readonly restartCommitments:
    AuthenticatedApplicationRevisionEvidenceTestDriverV1[
      "restartCommitments"
    ];
  readonly parsePagesRootSha256: Uint8Array;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly work: Parameters<
    AuthenticatedDeclarativeV2CommandBridgeV1["settle"]
  >[0];
}>) {
    if (input.complete.kind === "source_page") {
      return Object.freeze({
        actual: input.complete.result.actual,
        nextProgress: input.complete.result.nextProgress,
        outputManifest: input.complete.result.outputManifest,
      });
    }
    if (input.complete.kind === "registration_page") {
      return Object.freeze({
        actual: input.complete.result.actual,
        nextProgress: input.complete.result.nextProgress,
        outputManifest: input.complete.result.outputManifest,
      });
    }
    if (
      input.complete.kind !== "parse_module" &&
      input.complete.kind !== "link_page"
    ) {
      return yield* Effect.die(
        new Error(
          `FSV03 received unexpected ${input.complete.kind} completion.`,
        ),
      );
    }
    const claim = Object.freeze({
      commandKind: input.complete.kind,
      sequence: input.complete.sequence,
      reservationSha256: frameSha256(input.reservation),
      authenticatedInputSha256:
        new Uint8Array(input.reservation.freshAuthenticatedInputSha256),
      sourceCommitmentSha256:
        new Uint8Array(
          input.restartCommitments.sourceCommitmentSha256,
        ),
      semanticCommitmentSha256:
        new Uint8Array(
          input.restartCommitments.semanticCommitmentSha256,
        ),
      settledCommandUsage: input.complete.actual,
      parsePagesRootSha256: input.complete.kind === "link_page"
        ? new Uint8Array(input.parsePagesRootSha256)
        : null,
      maximumPagePayloadBytes: 65_536n,
      outputManifest: null,
      outputManifestSha256: null,
      receiptSha256: null,
    }) satisfies DeclarativeV2AnalyzerRestartEvidenceClaimV1;
    const persisted = yield* persistPrivateDeclarativeV2RestartEvidenceV1({
      host: input.host,
      session: input.analyzerSession,
      result: input.complete,
      claim,
      maximum: input.commandBudget,
      allowance: 1_024,
      bridge: input.persistenceBridge,
      work: input.work,
      pageBudget: PAGE_BUDGET,
    });
    const outputManifest = Object.freeze({
      kind: "command_output_manifest" as const,
      reservationSha256: frameSha256(input.reservation),
      commandKind: input.complete.kind,
      sequence: input.complete.sequence,
      evidenceRootSha256: persisted.terminal.finalPageSha256,
      evidenceCount: persisted.terminal.recordCount,
      diagnosticsRootSha256:
        persisted.terminal.diagnosticsRootSha256,
      diagnosticCount: persisted.terminal.diagnosticCount,
      nextProgressSha256: frameSha256(input.complete.nextProgress),
    }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
    return Object.freeze({
      actual: input.complete.actual,
      nextProgress: input.complete.nextProgress,
      outputManifest,
    });
});

function pointMutationRuntimeBinding(
  documentId: string,
): PointMutationExactRuntimeArtifactHostBindingV1 {
  return Object.freeze({
    run: async (
      request: Parameters<
        PointMutationExactRuntimeArtifactHostBindingV1["run"]
      >[0],
      journal: Parameters<
        PointMutationExactRuntimeArtifactHostBindingV1["run"]
      >[1],
    ) => {
      const result = await executePointMutationV1(
        {
          function: request.function,
          arguments: request.arguments,
          tables: request.tables,
        },
        {
          resolve: path =>
            path === "orders:place"
              ? Object.freeze({
                isMutation: true,
                isPublic: true,
                _handler: async (
                  context: PointMutationRuntimeContextV1,
                  args: Readonly<Record<string, unknown>>,
                ) => {
                  await context.db.patch(documentId, {
                    status: args.status,
                  });
                  return { ok: true };
                },
              })
              : undefined,
        },
        {
          open: () => ({
            context: {
              auth: { getUserIdentity: async () => null },
              db: {
                get: async () => null,
                insert: async () => {
                  throw new Error("FSV03 insert is outside this proof.");
                },
                patch: async (_id, patch) => {
                  const table = await journal.resolvePointTable("orders");
                  const patched = await table.runPointOperation({
                    kind: "patch",
                    syscallSequence: "1",
                    documentId,
                    patch,
                  });
                  if (
                    patched.kind !== "unit" ||
                    patched.operation !== "patch"
                  ) {
                    throw new Error("FSV03 runtime patch did not settle.");
                  }
                },
                replace: async () => {
                  throw new Error("FSV03 replace is outside this proof.");
                },
                delete: async () => {
                  throw new Error("FSV03 delete is outside this proof.");
                },
                query: () => {
                  throw new Error("FSV03 query is outside this proof.");
                },
                normalizeId: () => {
                  throw new Error("FSV03 normalizeId is outside this proof.");
                },
                system: Object.freeze({}),
              },
            },
            journal: {
              close: () => undefined,
              drain: async () => undefined,
            },
          }),
        },
      );
      return {
        format: "flarex.point-mutation-exact-runtime-host-response",
        version: 1,
        kind: "success",
        result: {
          format: "flarex.point-mutation-exact-runtime-result",
          version: 1,
          value: result,
        },
        [Symbol.dispose]: () => undefined,
      };
    },
  });
}

async function selectInactiveRevision(
  persistence: Persistence,
  registered: DurableRegisteredApplicationRevisionV1,
) {
  const rows = await persistence.query<{
    revision_id: string;
    status: string;
    package_sha256: Uint8Array;
    artifact_sha256: Uint8Array;
    schema_version_id: string;
    schema_artifact_sha256: Uint8Array;
    function_metadata_bytes: Uint8Array;
    function_metadata_sha256: Uint8Array;
  }>(
    `select revision_id, status, package_sha256, artifact_sha256,
            schema_version_id, schema_artifact_sha256,
            function_metadata_bytes, function_metadata_sha256
       from fx_system_application_revision_v1
      where scope_id = $1 and candidate_sha256 = $2`,
    [registered.scopeId, registered.candidateSha256],
  );
  const row = rows.rows[0];
  if (
    rows.rows.length !== 1 ||
    row === undefined ||
    row.revision_id !== registered.revisionId ||
    row.status !== "inactive" ||
    row.schema_version_id !== registered.schemaVersionId ||
    !bytesEqual(
      row.function_metadata_sha256,
      registered.functionMetadataSha256,
    )
  ) {
    throw new Error("FSV03 durable revision selection failed closed.");
  }
  const schemaArtifact = await Effect.runPromise(
    getSchemaVersionArtifactByIdEffect(
      persistence.drizzle,
      registered.deploymentId,
      registered.schemaVersionId,
    ),
  );
  if (
    schemaArtifact === null ||
    !bytesEqual(
      schemaArtifact.manifestSha256,
      row.schema_artifact_sha256,
    )
  ) {
    throw new Error("FSV03 durable schema artifact failed closed.");
  }
  const schemaManifest = decodeSchemaManifestAppSchemaV1(
    schemaArtifact.manifestJson,
  );
  if (
    schemaManifest.tableDefinitions.tables.length !== 1 ||
    schemaManifest.tableDefinitions.tables[0]?.logicalName !== "orders"
  ) {
    throw new Error("FSV03 durable orders schema is missing.");
  }
  const metadata = Result.getOrThrow(
    decodeCanonicalFunctionMetadataSetV1(
      row.function_metadata_bytes,
      {
        maximumFunctionsVisited: 16,
        maximumValidatorNodesVisited: 256,
        maximumCanonicalUtf8BytesMaterialized: 64_000,
      },
    ),
  );
  const functionMetadataSha256 = await Effect.runPromise(
    hashFunctionMetadataSha256V1(metadata.canonicalBytes, {
      maximumInputBytes: 64_000,
    }),
  );
  if (!bytesEqual(functionMetadataSha256, row.function_metadata_sha256)) {
    throw new Error("FSV03 durable function metadata failed closed.");
  }
  const functions = metadata.functions.map(fn => ({
    path: fn.metadata.functionPath,
    executionModule: fn.metadata.executionModule,
    kind: fn.metadata.kind,
    visibility: fn.metadata.visibility,
    argsValidator: fn.metadata.argsValidator,
    returnsValidator: fn.metadata.returnsValidator,
  }));
  const target = decodeActivePointMutationTargetMetadataV1({
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId: registered.deploymentId,
    scopeId: decodeReplacementScopeIdV1(registered.scopeId),
    packageId: `package_${hex(row.package_sha256)}`,
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${hex(row.package_sha256).slice(0, 32)}`,
    sourcePackageHash: hex(row.package_sha256),
    schemaVersionId: registered.schemaVersionId,
    functions,
    schemaManifest,
  });
  const handles = new WeakMap<object, typeof target>();
  const handle = Object.freeze({});
  handles.set(handle, target);
  return Object.freeze({
    handle,
    claim(authority: unknown) {
      const selected = authority !== null && typeof authority === "object"
        ? handles.get(authority)
        : undefined;
      return selected === undefined
        ? Result.fail(new Error("Invalid FSV03 revision selection authority."))
        : Result.succeed(structuredClone(selected));
    },
  });
}

async function replaceFunctionMetadataBytesWithoutDigest(
  persistence: Persistence,
  registered: DurableRegisteredApplicationRevisionV1,
): Promise<void> {
  const rows = await persistence.query<{
    function_metadata_bytes: Uint8Array;
  }>(
    `select function_metadata_bytes
       from fx_system_application_revision_v1
      where scope_id = $1 and candidate_sha256 = $2`,
    [registered.scopeId, registered.candidateSha256],
  );
  const row = rows.rows[0];
  if (rows.rows.length !== 1 || row === undefined) {
    throw new Error("FSV03 function metadata fault target is missing.");
  }
  const budget = {
    maximumFunctionsVisited: 16,
    maximumValidatorNodesVisited: 256,
    maximumCanonicalUtf8BytesMaterialized: 64_000,
  };
  const metadata = Result.getOrThrow(
    decodeCanonicalFunctionMetadataSetV1(
      row.function_metadata_bytes,
      budget,
    ),
  );
  const changedText = metadata.canonicalText.replace(
    '"functionPath":"orders:place"',
    '"functionPath":"orders:place_mismatch"',
  );
  if (changedText === metadata.canonicalText) {
    throw new Error("FSV03 function metadata fault could not be injected.");
  }
  const changedBytes = new TextEncoder().encode(changedText);
  Result.getOrThrow(decodeCanonicalFunctionMetadataSetV1(
    changedBytes,
    budget,
  ));
  await persistence.query(
    `update fx_system_application_revision_v1
        set function_metadata_bytes = $3,
            function_metadata_byte_length = $4
      where scope_id = $1 and candidate_sha256 = $2`,
    [
      registered.scopeId,
      registered.candidateSha256,
      changedBytes,
      changedBytes.byteLength,
    ],
  );
}

async function provisionRegistrationScope(
  persistence: Persistence,
  physicalLocator: ScopePhysicalLocator = LOCATOR,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId: DEPLOYMENT_ID,
    projectId: PROJECT_ID,
  });
  await persistence.insertScopeMetadata({
    scopeId: SCOPE_ID,
    deploymentId: DEPLOYMENT_ID,
    physicalLocator,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [SCOPE_ID, EPOCH],
  );
}

function definitionInput(
  revisionVariant?: string,
): StandardApplicationDefinitionInputV1 {
  if (
    revisionVariant === "fsv06-insert" ||
    revisionVariant === "fsv06-update"
  ) {
    return fsv06DefinitionInput(revisionVariant);
  }
  const variantSpaces = revisionVariant === "second"
    ? " "
    : revisionVariant === "third"
    ? "  "
    : revisionVariant === "fourth"
    ? "   "
    : "    ";
  const okLiteral = revisionVariant === undefined
    ? "true"
    : `${variantSpaces}false`;
  return {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 256,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: "orders",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                status: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
          },
        }],
        indexes: [],
      },
      modules: [{
        modulePath: "orders",
        functions: [{
          exportName: "place",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: {
            type: "object",
            value: {
              ok: {
                optional: false,
                fieldType: { type: "boolean" },
              },
            },
          },
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 32_000,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 16_000,
    },
    graphInput: {
      modules: [{
        path: "orders.js",
        roles: ["function", "execution"],
        sourceBytes: UTF8.encode(
          `export function place() { return { ok: ${okLiteral} }; }\n` +
            "export function run() {}\n",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "orders",
        artifactModulePath: "orders.js",
      }],
      executionPath: "orders.js",
      schemaPath: null,
      authPath: null,
    },
  };
}

function fsv06DefinitionInput(
  revisionVariant: "fsv06-insert" | "fsv06-update",
): StandardApplicationDefinitionInputV1 {
  const insert = revisionVariant === "fsv06-insert";
  const exportName = insert ? "c" : "u";
  const artifactModulePath = insert ? "i" : "u";
  return {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 512,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: "o",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                status: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
          },
        }],
        indexes: [],
      },
        modules: [{
          modulePath: "o",
        functions: [{
            exportName,
            kind: "mutation",
            visibility: "public",
            argsValidator: { type: "any" },
            returnsValidator: { type: "any" },
          }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 8_192,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 64_000,
      maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 32_000,
    },
    graphInput: {
      modules: [{
        path: artifactModulePath,
        roles: ["function", "execution"],
        sourceBytes: UTF8.encode(
          insert
            ? 'import{databaseInsert}from"flarex:platform";export async function c(_,a){try{return await databaseInsert("o",a)}catch{}}'
            : 'import{databasePatch}from"flarex:platform";export function u(_,a){return databasePatch(a.id,a.d)}',
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "o",
        artifactModulePath,
      }],
      executionPath: artifactModulePath,
      schemaPath: null,
      authPath: null,
    },
  };
}

function budget<Kind extends DeclarativeV2VerifierBudgetFrameV2["kind"]>(
  kind: Kind,
  value: bigint,
): DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: Kind } {
  return Object.freeze({
    kind,
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        value,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: Kind };
}

function addUsage(
  left: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  },
  right: DeclarativeV2VerifierBudgetFrameV2,
): DeclarativeV2VerifierBudgetFrameV2 & {
  readonly kind: "attempt_usage";
} {
  return Object.freeze({
    kind: "attempt_usage",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
        dimension,
        left[dimension] + right[dimension],
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
}

function frameSha256(
  frame: Parameters<typeof encodeDeclarativeV2VerifierProgressFrameV2>[0],
): Uint8Array {
  return sha256(Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(frame, {
      maximumFrameBytes: 1_048_576,
      maximumCanonicalBytes: 1_048_576,
    }),
  ).canonicalBytes);
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function analyzerReleaseSha256(): Uint8Array {
  return bytesFromHex(
    installedPrivateAnalyzerReleaseTupleV1().implementationIdentity,
  );
}

function bytesFromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function uuidFactory(prefix: string): () => string {
  let counter = 1;
  return () => {
    const suffix = counter.toString().padStart(12, "0");
    counter += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

function sortNumericStrings(values: ReadonlyArray<string>): string[] {
  return [...values].sort((left, right) => Number(left) - Number(right));
}
