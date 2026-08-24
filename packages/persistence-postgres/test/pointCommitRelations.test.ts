import { webcrypto } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";
import { beforeAll, describe, expect, it } from "vitest";

import {
  publishApplicationRelationBindingEffect,
  type ApplicationRelationBindingPublication,
  type ApplicationRelationBindingRepository,
} from "../src/applicationRelationBinding";
import {
  ApplicationRelationTargetDeleteRestrictedError,
  ApplicationRelationTargetNotLiveError,
  createApplicationRelationCommitPort,
} from "../src/applicationRelationCommit";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  hasPointCommitApplicationRelationMaintenance,
  PointCommitCorruptionV1Error,
  type PointCommitPublicationCommandV1,
  type PointCommitTransactionProofStepV1,
} from "../src/pointCommitTransaction";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  fxAppEdgeCurrent,
  fxAppRowCurrent,
} from "../src/schema";
import {
  createSessionJournalStorePersistenceV1,
  type SessionJournalAttemptV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import { createApplicationNativeMutationPGliteFixture } from
  "./fixtures/applicationNativeMutationTestFixture";
import {
  bridgeActiveApplicationReadinessForRelationCommitTest,
  installApplicationRelationCommitAuthorityForTest,
  relationAuthorityFromAnchor,
  relationBindingPublicationInput,
  requireRelationInsertedDocumentId,
  selectorFromRelationAnchor,
} from "./pointCommitRelationTestSupport";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  completeSessionJournalSeal,
  prepareSessionJournalSeal,
  runEffect,
  runEffectFailure,
  runSessionJournalPointOperation,
} from "./effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const LEASE_DURATION_MILLISECONDS = 60_000;
const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "point-commit-relations-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

interface RelationScope {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly schemaVersionId:
    ApplicationRelationBindingPublication["binding"]["schemaVersionId"];
  readonly publication: ApplicationRelationBindingPublication;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
}

interface PreparedRelationAttempt<Value> {
  readonly value: Value;
  readonly command: PointCommitPublicationCommandV1;
}

interface RelationOperationContext {
  readonly store: SessionJournalStorePersistenceV1;
  readonly attempt: SessionJournalAttemptV1;
}

interface PrepareRelationAttemptOptions {
  readonly beforeEvidenceLoad?: (sessionId: string) => Promise<void>;
}

describe("C09 point-commit relation maintenance", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;
  let publicationCounter = 1;

  beforeAll(async () => {
    if (globalThis.crypto === undefined) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      });
    }
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  it("publishes same-commit source and target rows with one authenticated edge", async () => {
    const scope = await createRelationScope("same_commit");
    const prepared = await prepareRelationAttempt(
      scope,
      "same_commit",
      async ({ store, attempt }) => {
        const users = await runEffect(
          store.resolvePointTableEffect(attempt, "users"),
        );
        const posts = await runEffect(
          store.resolvePointTableEffect(attempt, "posts"),
        );
        const userId = requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, users, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
            fields: { name: "Ada" },
          }),
        );
        const postId = requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, posts, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
            fields: { author: userId },
          }),
        );
        return Object.freeze({ userId, postId });
      },
    );
    const steps: PointCommitTransactionProofStepV1[] = [];
    const queries: string[] = [];
    const publisher = relationPublisher(scope, {
      afterTransactionStep: (event) => {
        steps.push(event.step);
        return Promise.resolve();
      },
      observeQuery: (query) => queries.push(query.name),
    });

    expect(hasPointCommitApplicationRelationMaintenance(publisher)).toBe(true);
    await expect(runEffect(publisher.publish(prepared.command))).resolves
      .toMatchObject({ kind: "published", token: { commitSeq: 1n } });
    expect(steps).toContain("relationTargetsValidated");
    expect(steps).toContain("relationEdgeWritten");
    expect(queries).not.toContain("loadRelationTargets");

    const state = await relationState(scope);
    expect(state.currentRows).toHaveLength(2);
    expect(state.edges).toEqual([expect.objectContaining({
      sourceTableId: decodeCatalogTableId(1),
      sourceRowId: decodeAppDocumentIdentityV1(prepared.value.postId).rowId,
      targetTableId: decodeCatalogTableId(2),
      targetRowId: decodeAppDocumentIdentityV1(prepared.value.userId).rowId,
      position: null,
      schemaVersionId: scope.schemaVersionId,
      commitSeq: 1n,
    })]);

    await expect(runEffect(publisher.publish(prepared.command))).resolves
      .toMatchObject({ kind: "replayed", token: { commitSeq: 1n } });
    expect((await relationState(scope)).edges).toHaveLength(1);
  });

  it("rejects a missing stored target before publishing rows or edges", async () => {
    const scope = await createRelationScope("missing_target");
    const missingUserId = appDocumentIdV1FromRowIdentity({
      tableId: decodeCatalogTableId(2),
      rowId: decodeAppRowIdHexV1("fe".repeat(16)),
    });
    const prepared = await prepareRelationAttempt(
      scope,
      "missing_target",
      async ({ store, attempt }) => {
        const posts = await runEffect(
          store.resolvePointTableEffect(attempt, "posts"),
        );
        return requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, posts, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
            fields: { author: missingUserId },
          }),
        );
      },
    );
    const queries: string[] = [];
    const failure = await runEffectFailure(
      relationPublisher(scope, {
        observeQuery: (query) => queries.push(query.name),
      }).publish(prepared.command),
    );

    expect(failure).toBeInstanceOf(ApplicationRelationTargetNotLiveError);
    expect(queries).toContain("loadRelationTargets");
    expect(await durableRelationState(scope)).toMatchObject({
      revisions: "0",
      currentRows: "0",
      edges: "0",
      commits: "0",
      changes: "0",
      outcomes: "0",
      wakes: "0",
      lastCommitSeq: "0",
    });
  });

  it("applies edge removal before restrict and rejects orphaning target deletes", async () => {
    const scope = await createRelationScope("restrict");
    const inserted = await prepareRelationAttempt(
      scope,
      "restrict_seed",
      async ({ store, attempt }) => {
        const users = await runEffect(
          store.resolvePointTableEffect(attempt, "users"),
        );
        const posts = await runEffect(
          store.resolvePointTableEffect(attempt, "posts"),
        );
        const userId = requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, users, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
            fields: { name: "Grace" },
          }),
        );
        const postId = requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, posts, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
            fields: { author: userId },
          }),
        );
        return Object.freeze({ userId, postId });
      },
    );
    await runEffect(relationPublisher(scope).publish(inserted.command));
    const beforeDelete = await durableRelationState(scope);

    const targetOnlyDelete = await prepareRelationAttempt(
      scope,
      "restrict_target_only",
      async ({ store, attempt }) => {
        const users = await runEffect(
          store.resolvePointTableEffect(attempt, "users"),
        );
        await runSessionJournalPointOperation(store, users, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: inserted.value.userId,
        });
      },
    );
    const restricted = await runEffectFailure(
      relationPublisher(scope).publish(targetOnlyDelete.command),
    );
    expect(restricted).toBeInstanceOf(
      ApplicationRelationTargetDeleteRestrictedError,
    );
    expect(await durableRelationState(scope)).toEqual(beforeDelete);

    const sourceAndTargetDelete = await prepareRelationAttempt(
      scope,
      "restrict_source_and_target",
      async ({ store, attempt }) => {
        const posts = await runEffect(
          store.resolvePointTableEffect(attempt, "posts"),
        );
        const users = await runEffect(
          store.resolvePointTableEffect(attempt, "users"),
        );
        await runSessionJournalPointOperation(store, posts, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: inserted.value.postId,
        });
        await runSessionJournalPointOperation(store, users, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          documentId: inserted.value.userId,
        });
      },
    );
    const steps: PointCommitTransactionProofStepV1[] = [];
    await expect(runEffect(relationPublisher(scope, {
      afterTransactionStep: (event) => {
        steps.push(event.step);
        return Promise.resolve();
      },
    }).publish(sourceAndTargetDelete.command))).resolves.toMatchObject({
      kind: "published",
      token: { commitSeq: 2n },
    });
    expect(steps.indexOf("relationEdgeWritten")).toBeLessThan(
      steps.indexOf("relationRestrictValidated"),
    );
    expect((await relationState(scope)).edges).toEqual([]);
  });

  it("rolls row, edge, feed, and clock state back after relation maintenance", async () => {
    const scope = await createRelationScope("rollback");
    const prepared = await prepareRelationAttempt(
      scope,
      "rollback",
      async ({ store, attempt }) => {
        const users = await runEffect(
          store.resolvePointTableEffect(attempt, "users"),
        );
        const posts = await runEffect(
          store.resolvePointTableEffect(attempt, "posts"),
        );
        const userId = requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, users, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
            fields: { name: "Rollback" },
          }),
        );
        await runSessionJournalPointOperation(store, posts, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          fields: { author: userId },
        });
      },
    );
    const injected = new PointCommitCorruptionV1Error({
      reason: "publicationInvariantInvalid",
    });
    const failure = await runEffectFailure(relationPublisher(scope, {
      afterTransactionStep: (event) => {
        if (event.step === "relationEdgeWritten") throw injected;
        return Promise.resolve();
      },
    }).publish(prepared.command));
    expect(failure).toBe(injected);
    expect(await durableRelationState(scope)).toMatchObject({
      revisions: "0",
      currentRows: "0",
      edges: "0",
      edgeVersions: "0",
      commits: "0",
      changes: "0",
      outcomes: "0",
      wakes: "0",
      lastCommitSeq: "0",
      lastOutboxSeq: "0",
    });

    await expect(runEffect(relationPublisher(scope).publish(prepared.command)))
      .resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
    expect(await durableRelationState(scope)).toMatchObject({
      revisions: "2",
      currentRows: "2",
      edges: "1",
      commits: "1",
      changes: "2",
      outcomes: "1",
      wakes: "1",
      lastCommitSeq: "1",
      lastOutboxSeq: "1",
    });
  });

  it("validates relation digests against the locked active Application head before writes", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "c09-active-readiness-test",
      compatibilityDate: "2026-08-24",
    });
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      fixture.deploymentId,
    );
    publicationCounter += 1;
    const relationInput = await relationBindingPublicationInput(
      deploymentId,
      publicationCounter,
    );
    const controlPublication = await runEffect(
      publishApplicationRelationBindingEffect(
        relationRepository(fixture.control),
        relationInput,
      ),
    );
    const targetPublication = await runEffect(
      publishApplicationRelationBindingEffect(
        relationRepository(fixture.target),
        relationInput,
      ),
    );
    expect(targetPublication.binding).toEqual(controlPublication.binding);

    const scope: RelationScope = Object.freeze({
      deploymentId,
      scopeId: decodeReplacementScopeIdV1(fixture.authority.scopeId),
      schemaVersionId: controlPublication.binding.schemaVersionId,
      publication: controlPublication,
      ports: fixture.sessionAuthority,
    });
    await setFlarexActivationClock(fixture.target, scope.scopeId);
    const matchingReadiness = Object.freeze({
      scopeId: scope.scopeId,
      applicationSchemaSha256:
        controlPublication.binding.applicationSchemaSha256,
      schemaVersionId: scope.schemaVersionId,
      schemaManifestSha256:
        controlPublication.binding.schemaManifestSha256,
    });
    await bridgeActiveApplicationReadinessForRelationCommitTest(
      fixture.target,
      matchingReadiness,
    );
    const prepared = await prepareRelationAttempt(
      scope,
      "active_readiness",
      async ({ store, attempt }) => {
        const users = await runEffect(
          store.resolvePointTableEffect(attempt, "users"),
        );
        const posts = await runEffect(
          store.resolvePointTableEffect(attempt, "posts"),
        );
        const userId = requireRelationInsertedDocumentId(
          await runSessionJournalPointOperation(store, users, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
            fields: { name: "Active" },
          }),
        );
        await runSessionJournalPointOperation(store, posts, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          fields: { author: userId },
        });
      },
      {
        beforeEvidenceLoad: sessionId =>
          installApplicationRelationCommitAuthorityForTest(fixture.target, {
            scopeId: scope.scopeId,
            schemaVersionId: scope.schemaVersionId,
            sessionId,
          }),
      },
    );
    const before = await durableRelationState(scope, fixture.target);
    await bridgeActiveApplicationReadinessForRelationCommitTest(
      fixture.target,
      Object.freeze({
        ...matchingReadiness,
        applicationSchemaSha256: "0".repeat(64),
      }),
    );
    const rejectedSteps: PointCommitTransactionProofStepV1[] = [];
    const publisher = relationPublisherFor(
      scope,
      fixture.control,
      {
        afterTransactionStep: event => {
          rejectedSteps.push(event.step);
          return Promise.resolve();
        },
      },
    );
    const failure = await runEffectFailure(
      publisher.publish(prepared.command),
    );
    expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "relationBindingInvalid" });
    expect(rejectedSteps).toContain("clockLocked");
    expect(rejectedSteps).not.toContain("relationBindingValidated");
    expect(rejectedSteps).not.toContain("sessionLocked");
    expect(await durableRelationState(scope, fixture.target)).toEqual(before);

    await bridgeActiveApplicationReadinessForRelationCommitTest(
      fixture.target,
      matchingReadiness,
    );
    const acceptedSteps: PointCommitTransactionProofStepV1[] = [];
    await expect(runEffect(relationPublisherFor(
      scope,
      fixture.control,
      {
        afterTransactionStep: event => {
          acceptedSteps.push(event.step);
          return Promise.resolve();
        },
      },
    ).publish(prepared.command))).resolves.toMatchObject({
      kind: "published",
      token: { commitSeq: 1n },
    });
    expect(acceptedSteps).toContain("relationBindingValidated");
    expect(acceptedSteps).toContain("activeApplicationSchemaValidated");
    expect((await relationState(scope, fixture.target)).edges).toHaveLength(1);
  }, 180_000);

  async function createRelationScope(label: string): Promise<RelationScope> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_c09_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator: sharedLocator, randomUuid: nextUuid },
    ).ensure({
      deploymentId,
      projectId: `project_c09_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    publicationCounter += 1;
    const publication = await runEffect(
      publishApplicationRelationBindingEffect(
        relationRepository(persistence),
        await relationBindingPublicationInput(deploymentId, publicationCounter),
      ),
    );
    await setFlarexActivationClock(persistence, scopeId);
    return Object.freeze({
      deploymentId,
      scopeId,
      schemaVersionId: publication.binding.schemaVersionId,
      publication,
      ports: resolutionPorts(persistence),
    });
  }

  async function prepareRelationAttempt<Value>(
    scope: RelationScope,
    label: string,
    operation: (context: RelationOperationContext) => Promise<Value>,
    options: PrepareRelationAttemptOptions = {},
  ): Promise<PreparedRelationAttempt<Value>> {
    const activation = await runEffect(
      createPointMutationSessionActivationPersistenceV1(scope.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
        randomUuid: nextUuid,
      }).activateEffect(pointMutationSessionActivationFixture(
        scope.deploymentId,
        scope.scopeId,
        {
          evidence: {
            schemaVersionId: scope.schemaVersionId,
            requestKey: TransactionRequestKeyV1Schema.make(
              `request:c09:${label}`,
            ),
          },
        },
      )),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a newly created C09 point attempt.");
    }
    const store = createSessionJournalStorePersistenceV1(scope.ports, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      randomUuid: nextUuid,
    });
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: scope.schemaVersionId,
    }));
    const value = await operation(Object.freeze({ store, attempt }));
    const prepared = await prepareSessionJournalSeal(store, attempt);
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await completeSessionJournalSeal(
      store,
      prepared.preparation,
      journal,
      successfulResult,
    );
    await options.beforeEvidenceLoad?.(activation.anchor.sessionId);
    const authority = relationAuthorityFromAnchor(
      activation.anchor,
      scope.schemaVersionId,
      activation.executionClaim,
    );
    const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
    const running = await runEffect(loader.loadEffect(authority));
    if (running.kind !== "loaded") {
      throw new Error("Expected running C09 stored evidence.");
    }
    await runEffect(
      createPointCommitFinishingTransitionPortV1(scope.ports).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          authority,
          running.evidence,
        ),
      ),
    );
    const finishing = await runEffect(loader.loadFinishingEffect(
      selectorFromRelationAnchor(activation.anchor),
    ));
    if (finishing.kind !== "loaded") {
      throw new Error("Expected finishing C09 stored evidence.");
    }
    const command = await pointCommitCommandFromStoredAttemptV1(
      authority,
      finishing.evidence,
    );
    return Object.freeze({
      value,
      command: Object.freeze({
        ...command,
        successfulResult: Object.freeze({
          valueCodecVersion: successfulResult.evidence.valueCodecVersion,
          value: successfulResult.valueJson,
          canonicalBytes: successfulResult.canonicalBytes,
          semanticSizeBytes: successfulResult.semanticSizeBytes,
          sha256Hex: successfulResult.evidence.sha256Hex,
        }),
      }),
    });
  }

  function relationPublisher(
    scope: RelationScope,
    options: Parameters<typeof createPointCommitPublisherPortV1>[1] = {},
  ) {
    return relationPublisherFor(scope, persistence, options);
  }

  function relationPublisherFor(
    scope: RelationScope,
    control: PGliteFlarexPersistence,
    options: Parameters<typeof createPointCommitPublisherPortV1>[1] = {},
  ) {
    const applicationRelations = createApplicationRelationCommitPort(
      control.drizzle,
      scope.ports,
    );
    return createPointCommitPublisherPortV1(scope.ports, {
      ...options,
      applicationRelations,
    });
  }

  async function relationState(
    scope: RelationScope,
    selected: PGliteFlarexPersistence = persistence,
  ) {
    const scopeUuid = projectScopeIdUuidV1(scope.scopeId).scopeUuid;
    const currentRows = await selected.drizzle.select({
      tableId: fxAppRowCurrent.tableId,
      rowId: fxAppRowCurrent.rowId,
      commitSeq: fxAppRowCurrent.commitSeq,
    }).from(fxAppRowCurrent).where(eq(
      fxAppRowCurrent.scopeUuid,
      scopeUuid,
    )).orderBy(asc(fxAppRowCurrent.tableId), asc(fxAppRowCurrent.rowId));
    const edges = await selected.drizzle.select({
      relationId: fxAppEdgeCurrent.relationId,
      edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId,
      sourceTableId: fxAppEdgeCurrent.sourceTableId,
      sourceRowId: fxAppEdgeCurrent.sourceRowId,
      targetTableId: fxAppEdgeCurrent.targetTableId,
      targetRowId: fxAppEdgeCurrent.targetRowId,
      position: fxAppEdgeCurrent.position,
      schemaVersionId: fxAppEdgeCurrent.schemaVersionId,
      commitSeq: fxAppEdgeCurrent.commitSeq,
    }).from(fxAppEdgeCurrent).where(eq(
      fxAppEdgeCurrent.scopeUuid,
      scopeUuid,
    ));
    return Object.freeze({
      currentRows: Object.freeze(currentRows),
      edges: Object.freeze(edges.map((edge) => Object.freeze({
        ...edge,
        sourceRowId: appRowIdHexV1FromBytes(edge.sourceRowId),
        targetRowId: appRowIdHexV1FromBytes(edge.targetRowId),
      }))),
    });
  }

  async function durableRelationState(
    scope: RelationScope,
    selected: PGliteFlarexPersistence = persistence,
  ) {
    const scopeUuid = projectScopeIdUuidV1(scope.scopeId).scopeUuid;
    const result = await selected.query<{
      revisions: string;
      current_rows: string;
      edges: string;
      edge_versions: string;
      commits: string;
      changes: string;
      outcomes: string;
      wakes: string;
      last_commit_seq: string;
      last_outbox_seq: string;
    }>(`
      select
        (select count(*)::text from fx_app_row_rev
          where scope_uuid = $1) as revisions,
        (select count(*)::text from fx_app_row_current
          where scope_uuid = $1) as current_rows,
        (select count(*)::text from fx_app_edge_current
          where scope_uuid = $1) as edges,
        (select count(*)::text from fx_app_edge_adjacency_version
          where scope_uuid = $1) as edge_versions,
        (select count(*)::text from fx_system_commit
          where scope_uuid = $1) as commits,
        (select count(*)::text from fx_system_commit_app_row_change
          where scope_uuid = $1) as changes,
        (select count(*)::text from fx_system_idempotency
          where scope_uuid = $1) as outcomes,
        (select count(*)::text from fx_system_outbox
          where scope_uuid = $1) as wakes,
        last_commit_seq::text,
        last_outbox_seq::text
      from fx_system_scope_clock
      where scope_uuid = $1
    `, [scopeUuid]);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing C09 durable state.");
    return Object.freeze({
      revisions: row.revisions,
      currentRows: row.current_rows,
      edges: row.edges,
      edgeVersions: row.edge_versions,
      commits: row.commits,
      changes: row.changes,
      outcomes: row.outcomes,
      wakes: row.wakes,
      lastCommitSeq: row.last_commit_seq,
      lastOutboxSeq: row.last_outbox_seq,
    });
  }

  function resolutionPorts(
    selected: PGliteFlarexPersistence,
  ): PointMutationSessionAuthorityResolutionPortsV1 {
    return {
      scopeMetadata: selected,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared placement must not read split receipts.");
        },
      },
      scopeSessionTargets: {
        resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            selected,
            physicalLocator,
          ),
      },
    };
  }

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `9a000000-0000-4000-8000-${suffix}`;
  }
});

function relationRepository(
  persistence: PGliteFlarexPersistence,
): ApplicationRelationBindingRepository {
  return {
    db: persistence.drizzle,
    runTransaction: run => persistence.drizzle.transaction(run),
  };
}
