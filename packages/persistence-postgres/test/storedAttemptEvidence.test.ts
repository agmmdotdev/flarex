import { Effect } from "effect";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import type { StoredAttemptEvidenceLoaderPortV1 } from "../../executor/src/storedAttemptAuthentication";
import * as persistenceRoot from "../src";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  createSessionJournalStorePersistenceV1,
  type SessionJournalAttemptV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "stored-attempt-evidence-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

interface Scenario {
  readonly persistence: PGliteFlarexPersistence;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly store: SessionJournalStorePersistenceV1;
  readonly attempt: SessionJournalAttemptV1;
  readonly loader: StoredAttemptEvidenceLoaderV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
}

describe("C04A bounded stored-attempt evidence loader", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  it("loads running+sealed evidence through the test-only structural seam", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      "createStoredAttemptEvidenceLoaderV1" | "StoredAttemptEvidenceV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createStoredAttemptEvidenceLoaderV1" in persistenceRoot).toBe(
      false,
    );

    let afterRepeatableRead = false;
    const current = await scenario("running_sealed", {
      afterRepeatableRead: () => {
        afterRepeatableRead = true;
      },
    });
    const envelope = await seal(current);
    const before = await timestamps(current.anchor.sessionId);

    const executorPort: StoredAttemptEvidenceLoaderPortV1 = current.loader;
    expectTypeOf(executorPort).toMatchTypeOf<
      StoredAttemptEvidenceLoaderPortV1
    >();
    const result = await executorPort.load(current.authority);

    expect(afterRepeatableRead).toBe(true);
    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(result.evidence.session.lifecycle).toBe("running");
    expect(result.evidence.root.journalBytes.byteLength).toBeGreaterThan(0);
    expect(bytesToHex(result.evidence.root.journalSha256)).toBe(
      envelope.journalSha256Hex,
    );
    expect(result.evidence.root.sealedFinalSyscallSequence).toBe(0n);
    expect(result.evidence.points).toEqual([]);
    expect(await timestamps(current.anchor.sessionId)).toEqual(before);
  });

  it("accepts finishing+sealed for reconstruction but rejects every other lifecycle", async () => {
    const finishing = await scenario("finishing_sealed");
    await seal(finishing);
    await setLifecycle(finishing.anchor.sessionId, "finishing");
    const finishingResult = await finishing.loader.load(finishing.authority);
    expect(finishingResult).toMatchObject({
      kind: "loaded",
      evidence: { session: { lifecycle: "finishing" } },
    });

    const committed = await scenario("committed_observation");
    await seal(committed);
    await setLifecycle(committed.anchor.sessionId, "committed");
    await persistence.query(
      "delete from fx_system_snapshot_lease where session_id = $1",
      [committed.anchor.sessionId],
    );
    await expect(committed.loader.load(committed.authority)).resolves
      .toMatchObject({ kind: "alreadyCommitted" });

    const otherLifecycles: ReadonlyArray<TransactionSessionLifecycleV1> = [
      "created",
      "committing",
      "retrying",
      "aborted",
      "expired",
    ];
    for (const lifecycle of otherLifecycles) {
      const current = await scenario(`lifecycle_${lifecycle}`);
      await seal(current);
      await setLifecycle(current.anchor.sessionId, lifecycle);
      await persistence.query(
        "delete from fx_system_snapshot_lease where session_id = $1",
        [current.anchor.sessionId],
      );
      await expect(current.loader.load(current.authority)).resolves
        .toMatchObject({
          kind: "notPlannable",
          reason: "lifecycle",
          lifecycle,
        });
    }
  });

  it("rejects every open/failed root for both accepted active lifecycles", async () => {
    for (const lifecycle of ["running", "finishing"] as const) {
      for (const rootState of ["open", "failed"] as const) {
        const current = await scenario(`root_${lifecycle}_${rootState}`);
        if (lifecycle === "finishing") {
          await setLifecycle(current.anchor.sessionId, lifecycle);
        }
        if (rootState === "failed") {
          await persistence.query(
            `
              update fx_system_tx_journal
              set state = 'failed',
                  failure_dimension = 'readDocuments',
                  updated_at = clock_timestamp()
              where session_id = $1
            `,
            [current.anchor.sessionId],
          );
        }
        await expect(current.loader.load(current.authority)).resolves
          .toMatchObject({
            kind: "notPlannable",
            reason: "rootNotSealed",
            rootState,
          });
      }
    }
  });

  it("fails closed when an active sealed attempt loses its lease or root", async () => {
    const missingLease = await scenario("missing_lease");
    await seal(missingLease);
    await persistence.query(
      "delete from fx_system_snapshot_lease where session_id = $1",
      [missingLease.anchor.sessionId],
    );
    await expect(missingLease.loader.load(missingLease.authority)).resolves
      .toMatchObject({
        kind: "corrupt",
        reason: "snapshotLeaseMissingOrDuplicate",
      });

    const missingRoot = await scenario("missing_root");
    await seal(missingRoot);
    await persistence.query(
      "delete from fx_system_tx_journal where session_id = $1",
      [missingRoot.anchor.sessionId],
    );
    await expect(missingRoot.loader.load(missingRoot.authority)).resolves
      .toMatchObject({
        kind: "corrupt",
        reason: "journalRootMissingOrDuplicate",
      });
  });

  it("uses database time and rejects expired or replaced exact attempts", async () => {
    const expired = await scenario("lease_expired");
    await seal(expired);
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expired.anchor.sessionId],
    );
    await expect(expired.loader.load(expired.authority)).resolves
      .toMatchObject({ kind: "notPlannable", reason: "expired" });

    const replaced = await scenario("attempt_replaced");
    await seal(replaced);
    await expect(replaced.loader.load({
      ...replaced.authority,
      attemptFence: TransactionAttemptFenceSchema.make(
        replaced.authority.attemptFence + 1n,
      ),
    })).resolves.toMatchObject({
      kind: "authorityMismatch",
      reason: "attemptReplaced",
    });
  });

  it("rejects stale generation, epoch, snapshot, schema, and revocation pins", async () => {
    const current = await scenario("stale_pins");
    await seal(current);
    const staleAuthorities: ReadonlyArray<Readonly<{
      authority: StoredAttemptEvidenceAuthorityV1;
      reason: string;
    }>> = [
      {
        authority: {
          ...current.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(99n),
        },
        reason: "generationChanged",
      },
      {
        authority: {
          ...current.authority,
          snapshotToken: SnapshotTokenSchema.make({
            ...current.authority.snapshotToken,
            epoch: ScopeEpochSchema.make("epoch_stale_c04a"),
          }),
        },
        reason: "epochChanged",
      },
      {
        authority: {
          ...current.authority,
          snapshotToken: SnapshotTokenSchema.make({
            ...current.authority.snapshotToken,
            commitSeq: CommitSeqSchema.make(
              current.authority.snapshotToken.commitSeq + 1n,
            ),
          }),
        },
        reason: "snapshotChanged",
      },
      {
        authority: {
          ...current.authority,
          schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_stale"),
        },
        reason: "schemaChanged",
      },
    ];
    for (const stale of staleAuthorities) {
      await expect(current.loader.load(stale.authority)).resolves
        .toMatchObject({ kind: "authorityMismatch", reason: stale.reason });
    }

    await setFlarexActivationClock(persistence, current.anchor.scopeId, {
      storageGenerationFence: current.anchor.storageGenerationFence,
      lastCommitSeq: current.anchor.snapshotToken.commitSeq,
      authorizationRevocationEpoch: 1n,
    });
    await expect(current.loader.load(current.authority)).resolves
      .toMatchObject({
        kind: "authorityMismatch",
        reason: "revocationEpochChanged",
      });
  });

  it("returns at most max+1 point rows and rejects overflow before decoding it", async () => {
    const current = await scenario("point_overflow");
    await seal(current);
    await persistence.query(
      `
        insert into fx_system_tx_journal_point (
          scope_uuid,
          session_id,
          attempt_fence,
          table_id,
          row_id,
          dependency_kind,
          dependency_revision_commit_seq,
          overlay_kind,
          created_at,
          updated_at
        )
        select
          scope_uuid,
          session_id,
          attempt_fence,
          generated_id,
          decode(lpad(to_hex(generated_id), 32, '0'), 'hex'),
          'missing_no_visible_revision',
          null,
          'none',
          created_at,
          updated_at
        from fx_system_tx_journal
        cross join generate_series(1, 4097) as generated_id
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );

    await expect(current.loader.load(current.authority)).resolves
      .toMatchObject({ kind: "corrupt", reason: "pointEvidenceOverflow" });
  });

  it("detaches journal, result, and point bytes from driver-owned rows", async () => {
    const current = await scenario("detached_bytes");
    const table = await current.store.resolvePointTable(current.attempt, "users");
    await current.store.runPointOperation(table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: "detached" },
    });
    await seal(current);
    const first = await current.loader.load(current.authority);
    if (first.kind !== "loaded") throw new Error("Expected loaded evidence.");
    const firstPoint = first.evidence.points[0];
    if (firstPoint === undefined) throw new Error("Expected point evidence.");
    first.evidence.root.journalBytes.fill(0);
    first.evidence.root.resultBytes.fill(0);
    firstPoint.rowId.fill(0);
    firstPoint.overlayValueBytes?.fill(0);

    const second = await current.loader.load(current.authority);
    if (second.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(second.evidence.root.journalBytes.some((byte) => byte !== 0)).toBe(
      true,
    );
    expect(second.evidence.root.resultBytes.some((byte) => byte !== 0)).toBe(
      true,
    );
    expect(second.evidence.points[0]?.rowId.some((byte) => byte !== 0)).toBe(
      true,
    );
    expect(
      second.evidence.points[0]?.overlayValueBytes?.some((byte) => byte !== 0),
    ).toBe(true);
  });

  interface ScenarioOptions {
    readonly afterRepeatableRead?: () => void | Promise<void>;
  }

  async function scenario(
    label: string,
    options: ScenarioOptions = {},
  ): Promise<Scenario> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_stored_attempt_${label}`,
    );
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      `schema_stored_attempt_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: nextUuid,
      },
    ).ensure({
      deploymentId,
      projectId: `project_stored_attempt_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [appTable("users")],
      indexes: [],
    });
    const ports = resolutionPorts(persistence);
    const activation = await createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: 60_000, randomUuid: nextUuid },
    ).activate(pointMutationSessionActivationFixture(
      deploymentId,
      scopeId,
      { evidence: { schemaVersionId } },
    ));
    const store = createSessionJournalStorePersistenceV1(ports, {
      randomUuid: nextUuid,
    });
    const authority = authorityFromAnchor(activation.anchor, schemaVersionId);
    const attempt = store.openAttempt({
      selector: selectorFromAnchor(activation.anchor),
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    });
    const loader = createStoredAttemptEvidenceLoaderV1(ports, options);
    return Object.freeze({
      persistence,
      anchor: activation.anchor,
      schemaVersionId,
      store,
      attempt,
      loader,
      authority,
    });
  }

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `93000000-0000-4000-8000-${suffix}`;
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

  async function seal(current: Scenario) {
    const prepared = await current.store.prepareSeal(current.attempt);
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    return current.store.completeSeal(prepared.preparation, journal, result);
  }

  async function setLifecycle(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
    lifecycle: TransactionSessionLifecycleV1,
  ): Promise<void> {
    await persistence.query(
      `
        update fx_system_tx_session
        set lifecycle = $2, updated_at = clock_timestamp()
        where session_id = $1
      `,
      [sessionId, lifecycle],
    );
  }

  async function timestamps(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<Readonly<Record<string, string>>> {
    const result = await persistence.query<Readonly<Record<string, string>>>(
      `
        select
          (select updated_at::text from fx_system_tx_session
            where session_id = $1) as session_updated_at,
          (select updated_at::text from fx_system_tx_journal
            where session_id = $1) as root_updated_at
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing timestamp row.");
    return row;
  }
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
  });
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}
