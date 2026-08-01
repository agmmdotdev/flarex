import { Cause, Effect, Exit, Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import {
  MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1,
} from "flarex-protocol/internal/application-revision-activation-request-v1";

import {
  makePrivateApplicationRevisionActivationCoordinatorV1,
} from "../../flarex-backend/src/deployment/PrivateApplicationRevisionActivationCoordinatorV1";
import {
  activateApplicationRevisionV1,
  inspectActiveApplicationRevisionSelectionV1,
  readActiveApplicationRevisionV1,
  type ApplicationRevisionActivationContextV1,
  type LocatedApplicationRevisionActivationTargetV1,
} from "../src/applicationRevisionActivationV1";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
  deriveApplicationRevisionSyscallValidatorV1,
  inspectApplicationRevisionSyscallValidatorV1,
  InvalidApplicationRevisionSyscallValidatorV1Error,
  validateApplicationRevisionSyscallDocumentInTransactionV1,
} from "../src/applicationRevisionSyscallValidatorV1";
import {
  settleApplicationRevisionReadinessV1,
} from "../src/applicationRevisionReadinessV1";
import { RUN_LOCATED_READ_COMMITTED_V1 } from
  "../src/transactionSessionAttemptKernel";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import type { LocatedApplicationRevisionRegistrationTargetV1 } from
  "../src/applicationRevisionRegistrationV1";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  prepareFsv04RegisteredRevisionFixtureV1,
} from "./fsv03PrivateAnalyzerToPostgresHarness";
import {
  authorityPorts,
  readinessContext,
} from "./fsv04ApplicationRevisionReadinessHarness";
import {
  makeRuntimeArtifactPublisherFixtureV1,
} from "./runtimeArtifactPublisherFixture";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export const FSV05_SUPPORTED_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const);

export interface Fsv05ApplicationRevisionActivationLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: Persistence;
  readonly registrationTarget: LocatedApplicationRevisionRegistrationTargetV1;
  readonly makeActivationTarget: () =>
    LocatedApplicationRevisionActivationTargetV1;
  readonly makeDecisionUncertainTarget: () => Readonly<{
    readonly target: LocatedApplicationRevisionActivationTargetV1;
    readonly wasInjected: () => boolean;
  }>;
}

export interface Fsv05ApplicationRevisionActivationProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly unsupportedTargetRejected: true;
  readonly emptyHeadRejected: true;
  readonly rollbackBoundaries: readonly [
    "afterActivationRevisionInsert",
    "afterActivationHeadWrite",
  ];
  readonly firstActivationDisposition: "inserted";
  readonly sameRequestDispositions: readonly ["replayed", "replayed"];
  readonly alreadyActiveRejected: true;
  readonly overflowCasRejected: true;
  readonly invalidatedReadinessRejected: true;
  readonly readerDriftStale: true;
  readonly concurrentReplacement: readonly ["inserted", "stale"];
  readonly uncertaintyDisposition: "replayed";
  readonly uncertaintyObservationFailurePreserved: true;
  readonly decisionUncertaintyInjected: true;
  readonly coldReloadRevision: bigint;
  readonly clonedSelectionRejected: true;
  readonly selectionRevokedAfterScope: true;
  readonly syscallValidatorAcceptedValidDocument: true;
  readonly syscallValidatorRejectedInvalidDocument: true;
  readonly syscallValidatorRejectedClone: true;
  readonly syscallValidatorRejectedForgery: true;
  readonly syscallValidatorRejectedMixedContext: true;
  readonly syscallValidatorRejectedSupersededSelection: true;
  readonly syscallValidatorRevokedAfterScope: true;
  readonly frameCorruptionRejected: true;
  readonly mixedEvidenceRejected: true;
  readonly activationRevisionCount: number;
  readonly activationHeadCount: number;
  readonly rollbackActionCount: number;
  readonly postgresVersion: string | null;
}

export async function proveFsv05ApplicationRevisionActivationV1(
  lane: Fsv05ApplicationRevisionActivationLaneV1,
): Promise<Fsv05ApplicationRevisionActivationProofV1> {
  const artifacts = makeRuntimeArtifactPublisherFixtureV1();
  const first = await prepareReadyRevision(lane, artifacts, undefined, true);
  const coordinator = makeCoordinator(first.context);

  const emptyRead = await Effect.runPromise(Effect.exit(Effect.scoped(
    coordinator.readActive(first.context),
  )));
  requireFailureTag(emptyRead, "ActiveApplicationRevisionMissingV1Error");

  const beforeUnsupported = await activationCounts(lane.persistence);
  const unsupportedLocator = unsupportedFsv05LocatorV1();
  const storedScope = await lane.persistence.getScopeMetadataByDeploymentId(
    first.deploymentId,
  );
  if (storedScope === null) throw new Error("FSV05 scope metadata is missing.");
  const unsupportedTarget = Object.freeze({
    ...lane.makeActivationTarget(),
    physicalLocator: unsupportedLocator,
  });
  const unsupportedContext: ApplicationRevisionActivationContextV1 = {
    ...first.context,
    authority: Object.freeze({
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => Object.freeze({
          scopeId: storedScope.scopeId,
          deploymentId: storedScope.deploymentId,
          activeSchemaVersionId: storedScope.activeSchemaVersionId,
          createdAt: storedScope.createdAt,
          isolationKind: "shared_database" as const,
          physicalLocator: unsupportedLocator,
        }),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => unsupportedTarget },
    }),
  };
  const unsupported = await Effect.runPromise(Effect.exit(Effect.scoped(
    activateApplicationRevisionV1(
      first.revisionId,
      null,
      unsupportedContext,
    ),
  )));
  requireFailureTag(
    unsupported,
    "UnsupportedApplicationRevisionActivationTargetV1Error",
  );
  const afterUnsupported = await activationCounts(lane.persistence);
  requireEqualCounts(beforeUnsupported, afterUnsupported, "unsupported target");

  const rollbackBoundaries = [
    "afterActivationRevisionInsert",
    "afterActivationHeadWrite",
  ] as const;
  for (const boundary of rollbackBoundaries) {
    const failed = await Effect.runPromise(Effect.exit(Effect.scoped(
      activateApplicationRevisionV1(first.revisionId, null, {
        ...first.context,
        faultAfter: point => {
          if (point === boundary) throw new Error(`fault:${boundary}`);
        },
      }),
    )));
    requireFailure(failed);
    requireEqualCounts(
      beforeUnsupported,
      await activationCounts(lane.persistence),
      boundary,
    );
  }

  const firstActivated = await Effect.runPromise(Effect.scoped(
    coordinator.activate(first.revisionId, null, first.context),
  ));
  if (firstActivated.disposition !== "inserted") {
    throw new Error("FSV05 first activation was not inserted.");
  }
  const sameRequest = await Promise.all([
    Effect.runPromise(Effect.scoped(
      coordinator.activate(first.revisionId, null, first.context),
    )),
    Effect.runPromise(Effect.scoped(
      coordinator.activate(first.revisionId, null, first.context),
    )),
  ]);
  if (sameRequest.some(receipt => receipt.disposition !== "replayed")) {
    throw new Error("FSV05 same-request activation did not converge.");
  }

  let firstIssuedSelection: unknown = null;
  const firstActive = await Effect.runPromise(Effect.scoped(Effect.gen(
    function* () {
      const active = yield* coordinator.readActive(first.context);
      firstIssuedSelection = active.selection;
      const claimed = Result.getOrThrow(
        inspectActiveApplicationRevisionSelectionV1(active.selection),
      );
      if (claimed.applicationRevisionId !== first.revisionId) {
        throw new Error("FSV05 active selection resolved another revision.");
      }
      if (Result.isSuccess(inspectActiveApplicationRevisionSelectionV1(
        Object.freeze({ ...active.selection }),
      ))) {
        throw new Error("FSV05 accepted a cloned active selection.");
      }
      return active;
    },
  )));
  if (Result.isSuccess(
    inspectActiveApplicationRevisionSelectionV1(firstIssuedSelection),
  )) {
    throw new Error("FSV05 active selection survived its owning scope.");
  }
  const alreadyActive = await Effect.runPromise(Effect.exit(Effect.scoped(
    coordinator.activate(
      first.revisionId,
      firstActive.expectedActiveRevision,
      first.context,
    ),
  )));
  requireFailureTag(alreadyActive, "ApplicationRevisionAlreadyActiveV1Error");
  const overflowCas = await Effect.runPromise(Effect.exit(Effect.scoped(
    coordinator.activate(
      first.revisionId,
      Object.freeze({
        activationRevision:
          MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1 + 1n,
        activationHeadSha256:
          firstActive.expectedActiveRevision.activationHeadSha256,
      }),
      first.context,
    ),
  )));
  requireFailureTag(
    overflowCas,
    "InvalidApplicationRevisionActivationInputV1Error",
  );

  const second = await prepareReadyRevision(lane, artifacts, "second", false);
  await lane.persistence.query(
    "update fx_system_index_build_state set lifecycle = 'validating'",
  );
  const invalidated = await Effect.runPromise(Effect.exit(Effect.scoped(
    coordinator.activate(
      second.revisionId,
      firstActive.expectedActiveRevision,
      second.context,
    ),
  )));
  requireFailureTag(invalidated, "ApplicationRevisionActivationNotReadyV1Error");
  await lane.persistence.query(
    "update fx_system_index_build_state set lifecycle = 'enabled'",
  );
  let driftActivationCompleted = false;
  const driftRead = await Effect.runPromise(Effect.exit(Effect.scoped(
    coordinator.readActive(Object.freeze({
      ...first.context,
      beforeActiveReadTransaction: async () => {
        await Effect.runPromise(Effect.scoped(coordinator.activate(
          second.revisionId,
          firstActive.expectedActiveRevision,
          second.context,
        )));
        driftActivationCompleted = true;
      },
    })),
  )));
  requireFailureTag(driftRead, "ApplicationRevisionActivationStaleV1Error");
  if (!driftActivationCompleted) {
    throw new Error("FSV05 did not exercise the active-reader hint race.");
  }
  const secondActive = await Effect.runPromise(Effect.scoped(
    coordinator.readActive(second.context),
  ));
  if (secondActive.metadata.applicationRevisionId !== second.revisionId) {
    throw new Error("FSV05 coherent reader did not observe drift activation.");
  }

  const third = await prepareReadyRevision(lane, artifacts, "third", false);
  const fourth = await prepareReadyRevision(lane, artifacts, "fourth", false);

  const replacementRace = await Promise.all([
    Effect.runPromise(Effect.exit(Effect.scoped(coordinator.activate(
      third.revisionId,
      secondActive.expectedActiveRevision,
      third.context,
    )))),
    Effect.runPromise(Effect.exit(Effect.scoped(coordinator.activate(
      fourth.revisionId,
      secondActive.expectedActiveRevision,
      fourth.context,
    )))),
  ]);
  const inserted = replacementRace.find(Exit.isSuccess);
  const stale = replacementRace.find(Exit.isFailure);
  if (inserted === undefined || stale === undefined) {
    throw new Error("FSV05 replacement race did not select one winner.");
  }
  if (inserted.value.disposition !== "inserted") {
    throw new Error("FSV05 replacement winner was not inserted.");
  }
  requireFailureTag(stale, "ApplicationRevisionActivationStaleV1Error");
  const winner = inserted.value.applicationRevisionId === third.revisionId
    ? third
    : inserted.value.applicationRevisionId === fourth.revisionId
    ? fourth
    : null;
  if (winner === null) {
    throw new Error("FSV05 replacement winner was not a raced revision.");
  }
  const loser = winner === third ? fourth : third;

  const racedActive = await Effect.runPromise(Effect.scoped(
    coordinator.readActive(winner.context),
  ));
  if (racedActive.metadata.applicationRevisionId !== winner.revisionId) {
    throw new Error("FSV05 coherent reader did not observe replacement.");
  }

  const uncertain = lane.makeDecisionUncertainTarget();
  const uncertainContext = activationContext(
    loser.deploymentId,
    lane.persistence,
    uncertain.target,
  );
  const uncertainReceipt = await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      loser.revisionId,
      racedActive.expectedActiveRevision,
      uncertainContext,
    ),
  ));
  if (uncertainReceipt.disposition !== "replayed" ||
    !uncertain.wasInjected()) {
    throw new Error("FSV05 did not settle a lost activation response by replay.");
  }

  const afterObservedUncertainty = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(loser.context),
  ));
  const fifth = await prepareReadyRevision(lane, artifacts, "fifth", false);
  const failedObservationTarget = lane.makeDecisionUncertainTarget();
  const failedObservationContext = Object.freeze({
    ...activationContext(
      fifth.deploymentId,
      lane.persistence,
      failedObservationTarget.target,
    ),
    faultAfter: (point: "afterActivationRevisionInsert" |
      "afterActivationHeadWrite" | "beforeUncertaintyObservation") => {
      if (point === "beforeUncertaintyObservation") {
        throw new Error("injected uncertainty observation failure");
      }
    },
  });
  const failedObservation = await Effect.runPromise(Effect.exit(Effect.scoped(
    activateApplicationRevisionV1(
      fifth.revisionId,
      afterObservedUncertainty.expectedActiveRevision,
      failedObservationContext,
    ),
  )));
  requireFailureTag(
    failedObservation,
    "ApplicationRevisionActivationDecisionUncertainV1Error",
  );
  if (!failedObservationTarget.wasInjected()) {
    throw new Error("FSV05 did not inject the uncertain settlement.");
  }
  const observedLater = await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(
      fifth.revisionId,
      afterObservedUncertainty.expectedActiveRevision,
      fifth.context,
    ),
  ));
  if (observedLater.disposition !== "replayed") {
    throw new Error("FSV05 did not replay after fresh uncertainty observation.");
  }

  const coldTarget = lane.makeActivationTarget();
  const coldContext = activationContext(
    fifth.deploymentId,
    lane.persistence,
    coldTarget,
  );
  const cold = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(coldContext),
  ));
  if (cold.metadata.applicationRevisionId !== fifth.revisionId) {
    throw new Error("FSV05 cold reader did not reconstruct the active revision.");
  }

  let issuedSyscallValidator: unknown = null;
  const syscallValidatorProof = await Effect.runPromise(Effect.scoped(
    Effect.gen(function* () {
      const active = yield* readActiveApplicationRevisionV1(coldContext);
      const validator = yield*
        deriveApplicationRevisionSyscallValidatorV1(active.selection);
      issuedSyscallValidator = validator;
      const clock = yield* Effect.promise(() =>
        lane.persistence.getScopeClock(active.metadata.scopeId)
      );
      if (clock === null) throw new Error("C03-V scope clock is missing.");
      const tableRows = yield* Effect.promise(() => lane.persistence.query<{
        table_id: number;
      }>(
        `select table_id
           from fx_control_table
          where deployment_id = $1 and logical_name = 'orders'`,
        [fifth.deploymentId],
      ));
      const tableId = tableRows.rows[0]?.table_id;
      if (tableRows.rows.length !== 1 || tableId === undefined) {
        throw new Error("C03-V active schema omitted the orders table.");
      }
      const activeTableId = decodeCatalogTableId(tableId);
      const rowId = decodeAppRowIdHexV1("55".repeat(16));
      const documentId = appDocumentIdV1FromRowIdentity({
        tableId: activeTableId,
        rowId,
      });
      const creationTime = decodeAppCreationTimeV1(1);
      const validationContext = Object.freeze({
        anchor: Object.freeze({ scopeId: active.metadata.scopeId }),
        executionPin: Object.freeze({
          schemaVersionId: decodeCatalogSchemaVersionId(
            active.metadata.schemaVersionId,
          ),
        }),
        scopeClock: clock,
      });
      const validate = (
        candidate: unknown,
        status: unknown,
        suppliedContext = validationContext,
      ) =>
        Effect.promise(async () => {
          const document = await canonicalizeAppDocumentV1({
            tableId: activeTableId,
            rowId,
            creationTime,
            fields: { status },
          });
          return coldTarget[RUN_LOCATED_READ_COMMITTED_V1](tx =>
            Effect.runPromise(Effect.exit(
              validateApplicationRevisionSyscallDocumentInTransactionV1(
                candidate as typeof validator,
                tx,
                suppliedContext,
                {
                  operation: "replace",
                  tableName: "orders",
                  tableId: activeTableId,
                  documentId,
                  creationTime,
                  document,
                },
              ),
            ))
          );
        });
      const valid = yield* validate(validator, "complete");
      if (Exit.isFailure(valid)) {
        throw new Error("C03-V rejected a valid active document.");
      }
      const invalid = yield* validate(validator, 42);
      requireFailureTag(
        invalid,
        "ApplicationRevisionSyscallDocumentValidationV1Error",
      );
      const cloned = yield* validate(Object.freeze({ ...validator }), "complete");
      requireFailureTag(
        cloned,
        "InvalidApplicationRevisionSyscallValidatorV1Error",
      );
      const forged = yield* validate(Object.freeze({}), "complete");
      requireFailureTag(
        forged,
        "InvalidApplicationRevisionSyscallValidatorV1Error",
      );
      const mixedContext = yield* validate(validator, "complete", Object.freeze({
        ...validationContext,
        anchor: Object.freeze({
          scopeId: decodeReplacementScopeIdV1(
            "scope_00000000-0000-0000-0000-000000000001",
          ),
        }),
      }));
      requireFailureTag(
        mixedContext,
        "ApplicationRevisionSyscallValidatorStaleV1Error",
      );
      const replacement = yield* coordinator.activate(
        first.revisionId,
        active.expectedActiveRevision,
        first.context,
      );
      if (replacement.disposition !== "inserted") {
        throw new Error("C03-V superseding activation was not inserted.");
      }
      const superseded = yield* validate(validator, "complete");
      requireFailureTag(
        superseded,
        "ApplicationRevisionSyscallValidatorStaleV1Error",
      );
      return Object.freeze({
        valid: true,
        invalid: Exit.isFailure(invalid) &&
          Cause.findErrorOption(invalid.cause).pipe(option =>
            option._tag === "Some" &&
            option.value instanceof
              ApplicationRevisionSyscallDocumentValidationV1Error
          ),
        cloned: Exit.isFailure(cloned) &&
          Cause.findErrorOption(cloned.cause).pipe(option =>
            option._tag === "Some" &&
            option.value instanceof
              InvalidApplicationRevisionSyscallValidatorV1Error
          ),
        forged: Exit.isFailure(forged) &&
          Cause.findErrorOption(forged.cause).pipe(option =>
            option._tag === "Some" &&
            option.value instanceof
              InvalidApplicationRevisionSyscallValidatorV1Error
          ),
        mixedContext: Exit.isFailure(mixedContext),
        superseded: Exit.isFailure(superseded),
      });
    }),
  ));
  const syscallValidatorRevoked = Result.isFailure(
    inspectApplicationRevisionSyscallValidatorV1(issuedSyscallValidator),
  );
  if (
    !syscallValidatorProof.valid || !syscallValidatorProof.invalid ||
    !syscallValidatorProof.cloned || !syscallValidatorProof.forged ||
    !syscallValidatorProof.mixedContext || !syscallValidatorProof.superseded ||
    !syscallValidatorRevoked
  ) {
    throw new Error("C03-V syscall-validator authority proof did not close.");
  }

  const storedHead = await lane.persistence.query<{
    frame_bytes: Uint8Array;
  }>("select frame_bytes from fx_system_declarative_v2_activation_head");
  const originalFrame = storedHead.rows[0]?.frame_bytes;
  if (originalFrame === undefined) throw new Error("FSV05 head is missing.");
  await lane.persistence.query(
    "update fx_system_declarative_v2_activation_head set frame_bytes = $1",
    [new Uint8Array(originalFrame.length).fill(0xee)],
  );
  const corrupt = await Effect.runPromise(Effect.exit(Effect.scoped(
    readActiveApplicationRevisionV1(coldContext),
  )));
  requireFailureTag(corrupt, "ApplicationRevisionActivationCorruptionV1Error");
  await lane.persistence.query(
    "update fx_system_declarative_v2_activation_head set frame_bytes = $1",
    [originalFrame],
  );
  const headEvidence = await lane.persistence.query<{
    verdict_sha256: Uint8Array;
  }>("select verdict_sha256 from fx_system_declarative_v2_activation_head");
  const currentVerdict = headEvidence.rows[0]?.verdict_sha256;
  const otherEvidence = await lane.persistence.query<{
    verdict_sha256: Uint8Array;
  }>(`select verdict_sha256
       from fx_system_declarative_v2_verdict
      where revision_id <> $1
      order by revision_id
      limit 1`, [first.revisionId]);
  const otherVerdict = otherEvidence.rows[0]?.verdict_sha256;
  if (currentVerdict === undefined || otherVerdict === undefined) {
    throw new Error("FSV05 mixed-evidence fixture is incomplete.");
  }
  await lane.persistence.query(
    "update fx_system_declarative_v2_activation_head set verdict_sha256 = $1",
    [otherVerdict],
  );
  const mixed = await Effect.runPromise(Effect.exit(Effect.scoped(
    readActiveApplicationRevisionV1(coldContext),
  )));
  requireFailureTag(mixed, "ApplicationRevisionActivationCorruptionV1Error");
  await lane.persistence.query(
    "update fx_system_declarative_v2_activation_head set verdict_sha256 = $1",
    [currentVerdict],
  );

  const counts = await activationCounts(lane.persistence);
  const version = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
        "select version() as version",
      )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    unsupportedTargetRejected: true,
    emptyHeadRejected: true,
    rollbackBoundaries,
    firstActivationDisposition: "inserted",
    sameRequestDispositions: ["replayed", "replayed"] as const,
    alreadyActiveRejected: true,
    overflowCasRejected: true,
    invalidatedReadinessRejected: true,
    readerDriftStale: true,
    concurrentReplacement: ["inserted", "stale"] as const,
    uncertaintyDisposition: "replayed",
    uncertaintyObservationFailurePreserved: true,
    decisionUncertaintyInjected: true,
    coldReloadRevision: cold.metadata.activationRevision,
    clonedSelectionRejected: true,
    selectionRevokedAfterScope: true,
    syscallValidatorAcceptedValidDocument: true,
    syscallValidatorRejectedInvalidDocument: true,
    syscallValidatorRejectedClone: true,
    syscallValidatorRejectedForgery: true,
    syscallValidatorRejectedMixedContext: true,
    syscallValidatorRejectedSupersededSelection: true,
    syscallValidatorRevokedAfterScope: true,
    frameCorruptionRejected: true,
    mixedEvidenceRejected: true,
    activationRevisionCount: counts.activationRevisionCount,
    activationHeadCount: counts.activationHeadCount,
    rollbackActionCount: counts.rollbackActionCount,
    postgresVersion: version,
  });
}

async function prepareReadyRevision(
  lane: Fsv05ApplicationRevisionActivationLaneV1,
  artifacts: ReturnType<typeof makeRuntimeArtifactPublisherFixtureV1>,
  variant: string | undefined,
  provisionScope: boolean,
) {
  const registered = await prepareFsv04RegisteredRevisionFixtureV1({
    name: lane.name,
    persistence: lane.persistence,
    registrationTarget: lane.registrationTarget,
    runtimeArtifacts: artifacts,
    physicalLocator: FSV05_SUPPORTED_LOCATOR,
    ...(variant === undefined ? {} : { revisionVariant: variant }),
    provisionScope,
  }).catch(cause => {
    throw new Error(`FSV05 could not prepare revision ${variant ?? "base"}.`, {
      cause,
    });
  });
  const target = lane.makeActivationTarget();
  const context = readinessContext(
    registered.deploymentId,
    lane.persistence,
    target,
    artifacts,
  );
  const reconciliation = await Effect.runPromise(
    reconcilePublishedIndexBuildsV1Effect({
      controlDb: lane.persistence.drizzle,
      authority: authorityPorts(lane.persistence, target),
    }, {
      deploymentId: registered.deploymentId,
      schemaVersionId: registered.registered.schemaVersionId,
    }),
  );
  if (reconciliation.status !== "reconciled") {
    throw new Error(`FSV05 physical definitions were ${reconciliation.reason}.`);
  }
  for (const indexDefinitionId of reconciliation.definitionIds) {
    for (let step = 0; step < 64; step += 1) {
      const result = await Effect.runPromise(
        buildIntrinsicCreationTimeIndexV1Effect({
          controlDb: lane.persistence.drizzle,
          authority: authorityPorts(lane.persistence, target),
        }, {
          deploymentId: registered.deploymentId,
          indexDefinitionId,
          pageSize: 4,
        }),
      );
      if (result.lifecycle === "enabled") break;
      if (step === 63) throw new Error("FSV05 intrinsic build did not converge.");
    }
  }
  const ready = await Effect.runPromise(Effect.scoped(
    settleApplicationRevisionReadinessV1(
      registered.registered.revisionId,
      context,
    ),
  ));
  if (ready.status !== "ready") {
    throw new Error(`FSV05 revision remained not ready: ${ready.reason}.`);
  }
  return Object.freeze({
    deploymentId: registered.deploymentId,
    revisionId: registered.registered.revisionId,
    context: activationContext(
      registered.deploymentId,
      lane.persistence,
      target,
    ),
  });
}

function activationContext(
  deploymentId: string,
  persistence: Persistence,
  target: LocatedApplicationRevisionActivationTargetV1,
): ApplicationRevisionActivationContextV1 {
  return Object.freeze({
    deploymentId,
    controlDb: persistence.drizzle,
    authority: authorityPorts(persistence, target),
  });
}

function makeCoordinator(context: ApplicationRevisionActivationContextV1) {
  return makePrivateApplicationRevisionActivationCoordinatorV1({
    activateApplicationRevisionV1: (
      revisionId: string,
      expectedActiveRevision: Parameters<
        typeof activateApplicationRevisionV1
      >[1],
      suppliedContext: ApplicationRevisionActivationContextV1,
    ) => activateApplicationRevisionV1(
      revisionId,
      expectedActiveRevision,
      suppliedContext,
    ),
    readActiveApplicationRevisionV1: (
      suppliedContext: ApplicationRevisionActivationContextV1,
    ) => readActiveApplicationRevisionV1(suppliedContext),
  });
}

async function activationCounts(persistence: Persistence) {
  const rows = await persistence.query<{
    revisions: string;
    heads: string;
    rollbacks: string;
  }>(`select
    (select count(*)::text from fx_system_declarative_v2_activation_revision) as revisions,
    (select count(*)::text from fx_system_declarative_v2_activation_head) as heads,
    (select count(*)::text from fx_system_declarative_v2_activation_revision
      where action = 'rollback') as rollbacks`);
  const row = rows.rows[0];
  if (row === undefined) throw new Error("FSV05 activation counts are missing.");
  return Object.freeze({
    activationRevisionCount: Number(row.revisions),
    activationHeadCount: Number(row.heads),
    rollbackActionCount: Number(row.rollbacks),
  });
}

function requireEqualCounts(
  expected: Awaited<ReturnType<typeof activationCounts>>,
  actual: Awaited<ReturnType<typeof activationCounts>>,
  operation: string,
) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`FSV05 ${operation} exposed a partial activation.`);
  }
}

function requireFailure(exit: Exit.Exit<unknown, unknown>): void {
  if (Exit.isSuccess(exit)) throw new Error("FSV05 expected a typed failure.");
}

function requireFailureTag(
  exit: Exit.Exit<unknown, unknown>,
  tag: string,
): void {
  requireFailure(exit);
  const error = Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause)
    : null;
  if (
    error === null || error._tag === "None" ||
    !isTaggedError(error.value, tag)
  ) {
    throw new Error(`FSV05 expected ${tag}.`);
  }
}

function isTaggedError(value: unknown, tag: string): boolean {
  return typeof value === "object" && value !== null &&
    "_tag" in value && value._tag === tag;
}

export function unsupportedFsv05LocatorV1() {
  return Object.freeze({
    kind: "shared_database",
    databaseKey: "not-primary",
    schemaName: "public",
  });
}
