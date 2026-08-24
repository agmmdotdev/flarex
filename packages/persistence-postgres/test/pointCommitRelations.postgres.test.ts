import { webcrypto } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

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
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  hasPointCommitApplicationRelationMaintenance,
  type PointCommitPublicationCommandV1,
} from "../src/pointCommitTransaction";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  createSessionJournalStorePersistenceV1,
  type SessionJournalAttemptV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import { createStoredAttemptEvidenceLoaderV1 } from
  "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  completeSessionJournalSeal,
  prepareSessionJournalSeal,
  runEffect,
  runSessionJournalPointOperation,
} from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
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
  TEST_GRANT_RETENTION_POLICY_V1,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LEASE_DURATION_MILLISECONDS = 300_000;

interface RelationScope {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly schemaVersionId:
    ApplicationRelationBindingPublication["binding"]["schemaVersionId"];
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

describePostgres("real PostgreSQL C09 relation commit serialization", () => {
  beforeAll(() => {
    if (globalThis.crypto === undefined) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      });
    }
  });

  it("prevents orphans in both insert-first and target-delete-first lock orders", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("9b000000");
      for (const first of ["insert", "delete"] as const) {
        const scope = await createRelationScope(
          persistence,
          randomUuid,
          `lock_${first}`,
          first === "insert" ? 101 : 102,
        );
        const seeded = await prepareRelationAttempt(
          persistence,
          randomUuid,
          scope,
          `${first}_seed`,
          async ({ store, attempt }) => {
            const users = await runEffect(
              store.resolvePointTableEffect(attempt, "users"),
            );
            return requireRelationInsertedDocumentId(
              await runSessionJournalPointOperation(store, users, {
                kind: "insert",
                syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
                fields: { name: `target_${first}` },
              }),
            );
          },
        );
        await runEffect(relationPublisher(persistence, scope).publish(
          seeded.command,
        ));

        const inserting = await prepareRelationAttempt(
          persistence,
          randomUuid,
          scope,
          `${first}_insert`,
          async ({ store, attempt }) => {
            const posts = await runEffect(
              store.resolvePointTableEffect(attempt, "posts"),
            );
            return requireRelationInsertedDocumentId(
              await runSessionJournalPointOperation(store, posts, {
                kind: "insert",
                syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
                fields: { author: seeded.value },
              }),
            );
          },
        );
        const deleting = await prepareRelationAttempt(
          persistence,
          randomUuid,
          scope,
          `${first}_delete`,
          async ({ store, attempt }) => {
            const users = await runEffect(
              store.resolvePointTableEffect(attempt, "users"),
            );
            await runSessionJournalPointOperation(store, users, {
              kind: "delete",
              syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
              documentId: seeded.value,
            });
          },
        );

        const firstAttempt = first === "insert" ? inserting : deleting;
        const secondAttempt = first === "insert" ? deleting : inserting;
        const entered = deferredSignal();
        const release = deferredSignal();
        const firstPublication = settle(runEffect(
          relationPublisher(persistence, scope, {
            afterTransactionStep: async (event) => {
              if (event.step !== "clockLocked") return;
              entered.resolve();
              await release.promise;
            },
          }).publish(firstAttempt.command),
        ));
        await entered.promise;
        const secondPublication = settle(runEffect(
          relationPublisher(persistence, scope).publish(secondAttempt.command),
        ));
        try {
          await waitForBlockedPointCommit(persistence, 1);
        } finally {
          release.resolve();
        }
        const [firstResult, secondResult] = await Promise.all([
          firstPublication,
          secondPublication,
        ]);

        expect(firstResult).toMatchObject({
          status: "fulfilled",
          value: { kind: "published", token: { commitSeq: 2n } },
        });
        expect(secondResult.status).toBe("rejected");
        if (secondResult.status !== "rejected") {
          throw new Error("Expected the serialized C09 loser to fail.");
        }
        expect(secondResult.reason).toBeInstanceOf(
          first === "insert"
            ? ApplicationRelationTargetDeleteRestrictedError
            : ApplicationRelationTargetNotLiveError,
        );

        const state = await postgresRelationState(persistence, scope);
        if (first === "insert") {
          expect(state).toMatchObject({
            edges: "1",
            orphanEdges: "0",
            liveRows: "2",
            tombstoneRows: "0",
            lastCommitSeq: "2",
          });
        } else {
          expect(state).toMatchObject({
            edges: "0",
            orphanEdges: "0",
            liveRows: "0",
            tombstoneRows: "1",
            lastCommitSeq: "2",
          });
        }
      }
    });
  }, 180_000);
});

async function createRelationScope(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  label: string,
  publicationSequence: number,
): Promise<RelationScope> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_c09_postgres_${label}`,
  );
  const locator = Object.freeze({
    kind: "shared_database",
    databaseKey: `c09-postgres-${label}`,
    schemaName: "public",
  }) satisfies SharedDatabaseScopePhysicalLocator;
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_c09_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  const publication = await runEffect(publishApplicationRelationBindingEffect(
    relationRepository(persistence),
    await relationBindingPublicationInput(
      deploymentId,
      publicationSequence,
    ),
  ));
  await setFlarexActivationClock(persistence, scopeId);
  return Object.freeze({
    deploymentId,
    scopeId,
    schemaVersionId: publication.binding.schemaVersionId,
    ports: resolutionPorts(persistence),
  });
}

async function prepareRelationAttempt<Value>(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: RelationScope,
  label: string,
  operation: (context: RelationOperationContext) => Promise<Value>,
): Promise<PreparedRelationAttempt<Value>> {
  const activation = await runEffect(
    createPointMutationSessionActivationPersistenceV1(scope.ports, {
      leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      randomUuid,
    }).activateEffect(pointMutationSessionActivationFixture(
      scope.deploymentId,
      scope.scopeId,
      {
        evidence: {
          schemaVersionId: scope.schemaVersionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:c09:postgres:${label}`,
          ),
        },
      },
    )),
  );
  if (activation.status !== "created") {
    throw new Error("Expected a newly created PostgreSQL C09 attempt.");
  }
  const store = createSessionJournalStorePersistenceV1(scope.ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
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
  const authority = relationAuthorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
    activation.executionClaim,
  );
  const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error("Expected running PostgreSQL C09 evidence.");
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
    throw new Error("Expected finishing PostgreSQL C09 evidence.");
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
  persistence: PostgresFlarexPersistence,
  scope: RelationScope,
  options: Parameters<typeof createPointCommitPublisherPortV1>[1] = {},
) {
  const applicationRelations = createApplicationRelationCommitPort(
    persistence.drizzle,
    scope.ports,
  );
  const publisher = createPointCommitPublisherPortV1(scope.ports, {
    ...options,
    applicationRelations,
  });
  if (!hasPointCommitApplicationRelationMaintenance(publisher)) {
    throw new Error("Missing PostgreSQL C09 point-commit composition.");
  }
  return publisher;
}

function relationRepository(
  persistence: PostgresFlarexPersistence,
): ApplicationRelationBindingRepository {
  return {
    db: persistence.drizzle,
    runTransaction: run => persistence.drizzle.transaction(run),
  };
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  };
}

async function postgresRelationState(
  persistence: PostgresFlarexPersistence,
  scope: RelationScope,
) {
  const scopeUuid = projectScopeIdUuidV1(scope.scopeId).scopeUuid;
  const result = await persistence.query<{
    edges: string;
    orphan_edges: string;
    live_rows: string;
    tombstone_rows: string;
    last_commit_seq: string;
  }>(`
    select
      (select count(*)::text from fx_app_edge_current edge
        where edge.scope_uuid = $1) as edges,
      (select count(*)::text
         from fx_app_edge_current edge
         left join fx_app_row_current target
           on target.scope_uuid = edge.scope_uuid
          and target.table_id = edge.target_table_id
          and target.row_id = edge.target_row_id
         left join fx_app_row_rev revision
           on revision.scope_uuid = target.scope_uuid
          and revision.table_id = target.table_id
          and revision.row_id = target.row_id
          and revision.commit_seq = target.commit_seq
        where edge.scope_uuid = $1
          and (target.commit_seq is null or revision.is_tombstone is distinct from false)
      ) as orphan_edges,
      (select count(*)::text
         from fx_app_row_current current_row
         join fx_app_row_rev revision
           on revision.scope_uuid = current_row.scope_uuid
          and revision.table_id = current_row.table_id
          and revision.row_id = current_row.row_id
          and revision.commit_seq = current_row.commit_seq
        where current_row.scope_uuid = $1 and revision.is_tombstone = false
      ) as live_rows,
      (select count(*)::text
         from fx_app_row_current current_row
         join fx_app_row_rev revision
           on revision.scope_uuid = current_row.scope_uuid
          and revision.table_id = current_row.table_id
          and revision.row_id = current_row.row_id
          and revision.commit_seq = current_row.commit_seq
        where current_row.scope_uuid = $1 and revision.is_tombstone = true
      ) as tombstone_rows,
      last_commit_seq::text
    from fx_system_scope_clock
    where scope_uuid = $1
  `, [scopeUuid]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing PostgreSQL C09 state.");
  return Object.freeze({
    edges: row.edges,
    orphanEdges: row.orphan_edges,
    liveRows: row.live_rows,
    tombstoneRows: row.tombstone_rows,
    lastCommitSeq: row.last_commit_seq,
  });
}

async function waitForBlockedPointCommit(
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(`
      select count(*)::int as blocked
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and cardinality(pg_blocking_pids(pid)) > 0
        and query ilike '%fx_system_scope_clock%'
    `);
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked C09 transaction(s).`,
  );
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

function settle<Value>(promise: Promise<Value>) {
  return promise.then(
    (value) => Object.freeze({ status: "fulfilled" as const, value }),
    (reason: unknown) => Object.freeze({ status: "rejected" as const, reason }),
  );
}

function uuidFactory(prefix: string): () => string {
  let counter = 1;
  return () => {
    const suffix = counter.toString().padStart(12, "0");
    counter += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}
