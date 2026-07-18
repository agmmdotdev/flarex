import { Effect, Exit, Fiber, Schema } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  CommitEnvelopeV1Schema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  decodeActivePointMutationTargetMetadataV1,
  preparePointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import {
  createPointMutationSessionAttemptLoadingV1,
} from "../../executor/src/pointMutationSessionActivation";
import {
  createStoredAttemptAuthenticationV1,
  type StoredAttemptEvidenceLoaderPortV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "../../executor/src/transactionGrant";
import * as persistenceRoot from "../src";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowTransaction,
} from "../src/appRows";
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
  type PinnedPointTableV1,
  type SessionJournalAttemptV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
  MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  StoredCommitAuthorityEvidencePersistenceV1Error,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceQueryV1,
} from "../src/storedCommitAuthorityEvidence";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoadResultV1,
  type StoredAttemptEvidenceLoaderV1,
  type StoredAttemptFinishingEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitResourceExhaustionV1Error,
  PointCommitSqlErrorV1,
  PointCommitStaleAuthorityV1Error,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  CommittedPointOutcomeRequestKeyReuseErrorV1,
} from "../src/committedPointOutcome";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "stored-attempt-evidence-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

interface Scenario {
  readonly persistence: PGliteFlarexPersistence;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly store: SessionJournalStorePersistenceV1;
  readonly attempt: SessionJournalAttemptV1;
  readonly loader: StoredAttemptFinishingEvidenceLoaderV1;
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
    const result = await runEffect(executorPort.loadEffect(current.authority));

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
    const finishingResult = await runEffect(
      finishing.loader.loadFinishingEffect(
        selectorFromAnchor(finishing.anchor),
      ),
    );
    expect(finishingResult).toMatchObject({
      kind: "loaded",
      evidence: { session: { lifecycle: "finishing" } },
    });

    const running = await scenario("running_recovery_rejected");
    await seal(running);
    await expect(runEffect(running.loader.loadFinishingEffect(
      selectorFromAnchor(running.anchor),
    ))).resolves.toMatchObject({
      kind: "notPlannable",
      reason: "lifecycle",
      lifecycle: "running",
    });

    const committed = await scenario("committed_observation");
    await seal(committed);
    await setLifecycle(committed.anchor.sessionId, "committed");
    await persistence.query(
      "delete from fx_system_snapshot_lease where session_id = $1",
      [committed.anchor.sessionId],
    );
    await expect(runEffect(committed.loader.loadFinishingEffect(
      selectorFromAnchor(committed.anchor),
    ))).resolves
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
      await expect(runEffect(current.loader.loadFinishingEffect(
        selectorFromAnchor(current.anchor),
      ))).resolves
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
        await expect(runEffect(
          current.loader.loadEffect(current.authority),
        )).resolves
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
    await expect(runEffect(
      missingLease.loader.loadEffect(missingLease.authority),
    )).resolves
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
    await expect(runEffect(
      missingRoot.loader.loadEffect(missingRoot.authority),
    )).resolves
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
    await expect(runEffect(expired.loader.loadEffect(expired.authority))).resolves
      .toMatchObject({ kind: "notPlannable", reason: "expired" });

    const replaced = await scenario("attempt_replaced");
    await seal(replaced);
    await expect(runEffect(replaced.loader.loadEffect({
      ...replaced.authority,
      attemptFence: TransactionAttemptFenceSchema.make(
        replaced.authority.attemptFence + 1n,
      ),
    }))).resolves.toMatchObject({
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
      await expect(runEffect(
        current.loader.loadEffect(stale.authority),
      )).resolves
        .toMatchObject({ kind: "authorityMismatch", reason: stale.reason });
    }

    await setFlarexActivationClock(persistence, current.anchor.scopeId, {
      storageGenerationFence: current.anchor.storageGenerationFence,
      lastCommitSeq: current.anchor.snapshotToken.commitSeq,
      authorizationRevocationEpoch: 1n,
    });
    await expect(runEffect(
      current.loader.loadEffect(current.authority),
    )).resolves
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

    await expect(runEffect(
      current.loader.loadEffect(current.authority),
    )).resolves
      .toMatchObject({ kind: "corrupt", reason: "pointEvidenceOverflow" });
  });

  it("detaches journal, result, and point bytes from driver-owned rows", async () => {
    const current = await scenario("detached_bytes");
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: "detached" },
    });
    await seal(current);
    const first = await runEffect(current.loader.loadEffect(current.authority));
    if (first.kind !== "loaded") throw new Error("Expected loaded evidence.");
    const firstPoint = first.evidence.points[0];
    if (firstPoint === undefined) throw new Error("Expected point evidence.");
    first.evidence.root.journalBytes.fill(0);
    first.evidence.root.resultBytes.fill(0);
    firstPoint.rowId.fill(0);
    firstPoint.overlayValueBytes?.fill(0);

    const second = await runEffect(
      current.loader.loadEffect(current.authority),
    );
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

  it("size-projects C04B1 authority evidence before bounded payload transfer", async () => {
    const current = await scenario("commit_authority_capture");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const queries: StoredCommitAuthorityEvidenceQueryV1["name"][] = [];
    let transactionClosed = false;
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        observeQuery: (query) => queries.push(query.name),
        afterRepeatableRead: () => {
          transactionClosed = true;
        },
      },
    );
    const result = await runEffect(loader.loadEffect(authority));

    expect(transactionClosed).toBe(true);
    expect(result.kind).toBe("loaded");
    expect(queries.indexOf("authoritySizes")).toBeLessThan(
      queries.indexOf("authorityPayload"),
    );
    expect(queries.indexOf("schemaSizes")).toBeLessThan(
      queries.indexOf("schemaPayload"),
    );
    expect(queries).not.toContain("activePackageId");
    if (result.kind !== "loaded") throw new Error("Expected C04B1 evidence.");
    expect(result.evidence.schema.schemaVersionId).toBe(
      current.schemaVersionId,
    );
    expect(result.evidence.schema.stableBindings).toEqual([
      { logicalName: "users", tableId: 1 },
    ]);
    result.evidence.session.validatedArgsCanonicalBytes.fill(0);
    const second = await runEffect(loader.loadEffect(authority));
    if (second.kind !== "loaded") throw new Error("Expected detached reload.");
    expect(
      second.evidence.session.validatedArgsCanonicalBytes.some(
        (byte) => byte !== 0,
      ),
    ).toBe(true);
  });

  it("does not observe interruption until authority capture settles", async () => {
    const current = await scenario("commit_authority_interruption");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        afterSizeProjection: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    );

    const fiber = Effect.runFork(loader.loadEffect(authority));
    await entered.promise;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(interruptionSettled).toBe(false);
    release.resolve();
    await interruption;
    expect(interruptionSettled).toBe(true);
    const exit = await runEffect(Fiber.await(fiber));
    expect(Exit.hasInterrupts(exit)).toBe(true);
  });

  it("rejects stored JSON text whose parsed value leaves the JSON domain", async () => {
    const current = await scenario("commit_authority_non_finite_json");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    await persistence.query(
      `
        update fx_system_tx_session
        set validated_args_json = '{"nested": 1e400}'::jsonb
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );

    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
    );
    await expect(runEffect(loader.loadEffect(authority))).resolves.toMatchObject({
      kind: "corrupt",
      reason: "sessionEvidenceInvalid",
    });
  });

  it("composes C03 through private C04C1 after both SQL captures close", async () => {
    let storedSqlClosed = false;
    const current = await c04b2Scenario("commit_input_composition", {
      afterRepeatableRead: () => {
        storedSqlClosed = true;
      },
    });
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    const insertedThenDeleted = await runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: "transient" },
    });
    if (
      insertedThenDeleted.kind !== "completed" ||
      insertedThenDeleted.outcome.kind !== "inserted"
    ) {
      throw new Error("Expected the transient insert to complete.");
    }
    await expect(runPointOperation(current.store, table, {
      kind: "delete",
      syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
      documentId: insertedThenDeleted.outcome.documentId,
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(3n),
      fields: { name: "material" },
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "inserted" },
    });
    const envelope = await seal(current);
    const loadedAttempt = await current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    });
    const storedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (storedEvidence.kind !== "loaded") {
      throw new Error("Expected stored insert/delete evidence to load.");
    }
    expect(storedEvidence.evidence.points).toHaveLength(2);
    expect(storedEvidence.evidence.points).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dependencyKind: "missing_no_visible_revision",
        overlayKind: "deleted",
      }),
      expect.objectContaining({
        dependencyKind: "missing_no_visible_revision",
        overlayKind: "live",
      }),
    ]));
    storedSqlClosed = false;
    let authoritySqlClosed = false;
    let schemaDecodeAfterSqlClose = false;
    let metadataAfterSqlClose = false;
    let authorityQueries = 0;
    let metadataLoads = 0;
    const authorityLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        observeQuery: () => {
          authorityQueries += 1;
        },
        afterRepeatableRead: () => {
          authoritySqlClosed = true;
        },
        beforeSchemaArtifactDecode: () => {
          schemaDecodeAfterSqlClose = authoritySqlClosed;
        },
      },
    );
    const pointCommitSteps: string[] = [];
    const authentication = createStoredAttemptAuthenticationV1(
      current.loader,
      {
        evidenceLoader: authorityLoader,
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => {
            metadataLoads += 1;
            metadataAfterSqlClose = authoritySqlClosed;
            return Effect.succeed(structuredClone(current.functionSnapshot));
          },
        },
        pointCommit: createPointCommitPublisherPortV1(
          resolutionPorts(persistence),
          {
            afterTransactionStep: (event) => {
              pointCommitSteps.push(event.step);
              return Promise.resolve();
            },
          },
        ),
        pointCommitFinishing: createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ),
      },
    );
    const authority = await runEffect(
      authentication.deriveAuthority(loadedAttempt),
    );
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(stored),
    );
    const beforeVerification = { authorityQueries, metadataLoads };
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const prepared = await runEffect(
      authentication.planPointCommit(verified),
    );
    const finishing = await runEffect(
      authentication.enterPointCommitFinishing(prepared),
    );
    const rollbackProof = await runEffect(
      authentication.provePointCommitRollback(finishing),
    );

    expect(storedSqlClosed).toBe(true);
    expect(authoritySqlClosed).toBe(true);
    expect(schemaDecodeAfterSqlClose).toBe(true);
    expect(metadataAfterSqlClose).toBe(true);
    expect(authentication.isCommitInputVerified(verified)).toBe(true);
    expect(authentication.isPointCommitPrepared(prepared)).toBe(true);
    expect({ authorityQueries, metadataLoads }).toEqual(beforeVerification);
    expect(rollbackProof).toEqual({ kind: "wouldCommit" });
    expect(pointCommitSteps).toContain("tentativeRowWritten");
    const durable = await persistence.query<{
      revisions: string;
      current_rows: string;
      last_commit_seq: string;
    }>(
      `
        select
          (select count(*)::text from fx_app_row_rev
            where scope_uuid = $1) as revisions,
          (select count(*)::text from fx_app_row_current
            where scope_uuid = $1) as current_rows,
          last_commit_seq::text
        from fx_system_scope_clock
        where scope_uuid = $1
      `,
      [storedEvidence.evidence.scopeUuid],
    );
    expect(durable.rows[0]).toEqual({
      revisions: "0",
      current_rows: "0",
      last_commit_seq: "0",
    });
  });

  it("publishes one point mutation atomically and replays it without authority", async () => {
    const prepared = await prepareO07BScenario(
      "o07b_publish_replay",
      async (current, table) => {
        await expect(runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "published" },
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "inserted" },
        });
      },
    );
    const published = await runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
      successfulResult: { valueJson: { ok: true } },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "1",
      current_rows: "1",
      commit_headers: "1",
      commit_changes: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
    const terminal = await o07bTerminalState(
      prepared.scopeUuid,
      prepared.current.anchor.sessionId,
    );
    expect(terminal).toEqual({
      lifecycle: "committed",
      leases: "0",
      journals: "0",
      receipts: "0",
      points: "0",
      write_events: "0",
    });

    if (published.kind !== "published") {
      throw new Error("Expected the initial O07-B publication.");
    }
    const callerBytes = published.successfulResult.canonicalBytes;
    callerBytes.fill(0);
    const replayed = await runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(replayed).toMatchObject({
      kind: "replayed",
      token: published.token,
      successfulResult: { valueJson: { ok: true } },
    });
    expect(replayed.kind === "replayed"
      ? replayed.successfulResult.canonicalBytes
      : new Uint8Array()).not.toEqual(callerBytes);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "1",
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("reconstructs finishing evidence in fresh factories and converges on one publication", async () => {
    const prepared = await prepareO07BScenario("c05b_fresh_recovery");
    const createRecoveryExecutor = () =>
      createO07BAuthentication(prepared.current);
    const selector = {
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    };
    const second = createRecoveryExecutor();
    const secondHandle = await runEffect(
      second.reconstructPointCommitFinishing(selector),
    );
    const first = createRecoveryExecutor();
    const firstHandle = await runEffect(
      first.reconstructPointCommitFinishing(selector),
    );
    const outcomes = await Promise.all([
      runEffect(first.publishPointCommit(firstHandle)),
      runEffect(second.publishPointCommit(secondHandle)),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "published",
      "replayed",
    ]);
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "published",
        token: expect.objectContaining({
          scopeUuid: prepared.scopeUuid,
          commitSeq: 1n,
        }),
      }),
      expect.objectContaining({
        kind: "replayed",
        token: expect.objectContaining({
          scopeUuid: prepared.scopeUuid,
          commitSeq: 1n,
        }),
      }),
    ]));
    expect(await runFailure(
      createRecoveryExecutor().resumePointCommit(selector),
    )).toMatchObject({
      _tag: "StoredAttemptAlreadyCommittedV1Error",
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "1",
      commit_changes: "0",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("publishes a successful zero-row mutation as one zero-change commit", async () => {
    const prepared = await prepareO07BRunningScenario("o07b_zero_row");
    const published = await runEffect(
      prepared.authentication.finishPointCommit(prepared.runningPlan),
    );
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "1",
      commit_changes: "0",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
    const header = await persistence.query<{
      change_count: number;
      delivery_state: string;
      attempt_count: string;
      claim_fence: string;
      same_initial_time: boolean;
    }>(
      `
        select commit.change_count, wake.delivery_state,
          wake.attempt_count::text, wake.claim_fence::text,
          wake.created_at = wake.next_attempt_at as same_initial_time
        from fx_system_commit as commit
        join fx_system_outbox as wake
          on wake.scope_uuid = commit.scope_uuid
          and wake.commit_seq = commit.commit_seq
        where commit.scope_uuid = $1
      `,
      [prepared.scopeUuid],
    );
    expect(header.rows[0]).toEqual({
      change_count: 0,
      delivery_state: "pending",
      attempt_count: "0",
      claim_fence: "0",
      same_initial_time: true,
    });
  });

  it("rejects malformed successful-result evidence before database I/O", async () => {
    const prepared = await prepareO06Scenario(
      "o07b_result_evidence",
      () => Promise.resolve(),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    const observedQueries: string[] = [];
    const publisher = createPointCommitPublisherPortV1(
      resolutionPorts(persistence),
      { observeQuery: (query) => observedQueries.push(query.name) },
    );
    const failure = await runFailure(publisher.publish(Object.freeze({
      ...prepared.command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: result.valueJson,
        canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
          new Uint8Array(result.canonicalBytes.byteLength + 1),
        ),
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    })));
    expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "successfulResultInvalid" });
    expect(observedQueries).toEqual([]);
    expect(await o06DurableState(prepared.evidence.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "0",
      last_outbox_seq: "0",
    });
  });

  it("captures result insertion bytes once before locking the scope clock", async () => {
    const prepared = await prepareO06Scenario(
      "o07b_result_capture",
      () => Promise.resolve(),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    let clockLocked = false;
    let byteReads = 0;
    const publisher = createPointCommitPublisherPortV1(
      resolutionPorts(persistence),
      {
        afterTransactionStep: (event) => {
          if (event.step === "clockLocked") clockLocked = true;
          return Promise.resolve();
        },
      },
    );
    const published = await runEffect(publisher.publish(Object.freeze({
      ...prepared.command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: result.valueJson,
        get canonicalBytes() {
          if (clockLocked) {
            throw new Error("Result bytes were read after the scope lock.");
          }
          byteReads += 1;
          return CanonicalSuccessfulResultBytesV1Schema.make(
            new Uint8Array(result.canonicalBytes),
          );
        },
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    })));
    expect(published.kind).toBe("published");
    expect(clockLocked).toBe(true);
    expect(byteReads).toBe(1);
  });

  it("replays across epoch rollover, but a missing old receipt is stale", async () => {
    const prepared = await prepareO07BScenario("o07b_epoch_replay");
    const published = await runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(published.kind).toBe("published");
    const nextEpoch = ScopeEpochSchema.make(
      "epoch_94000000-0000-4000-8000-000000000001",
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set epoch = $2, updated_at = clock_timestamp()
        where scope_uuid = $1
      `,
      [
        prepared.scopeUuid,
        nextEpoch,
      ],
    );
    await expect(runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).resolves.toMatchObject({ kind: "replayed", token: { commitSeq: 1n } });

    await persistence.query(
      `delete from fx_system_idempotency where scope_uuid = $1`,
      [prepared.scopeUuid],
    );
    const missingFailure = await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(missingFailure).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
    expect(missingFailure).toMatchObject({ reason: "epochChanged" });
  });

  it("rolls back every publication atom when a late invariant fails", async () => {
    const prepared = await prepareO07BScenario(
      "o07b_late_rollback",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "rolled back" },
        });
      },
      {
        afterTransactionStep: (event) => {
          if (event.step === "wakeWritten") {
            throw new PointCommitCorruptionV1Error({
              reason: "publicationInvariantInvalid",
            });
          }
          return Promise.resolve();
        },
      },
    );
    const failure = await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "0",
      last_outbox_seq: "0",
    });
    expect(await o07bTerminalState(
      prepared.scopeUuid,
      prepared.current.anchor.sessionId,
    )).toMatchObject({
      lifecycle: "finishing",
      leases: "1",
      journals: "1",
    });

    const recovered = createO07BAuthentication(prepared.current);
    const published = await runEffect(recovered.resumePointCommit({
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    }));
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "1",
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("reports exact request-key evidence reuse before stale session checks", async () => {
    const prepared = await prepareO07BScenario("o07b_reuse_conflict");
    await runEffect(prepared.authentication.publishPointCommit(prepared.plan));
    await persistence.query(
      `
        update fx_system_idempotency
        set identity_access_policy_sha256 = decode(repeat('aa', 32), 'hex')
        where scope_uuid = $1
      `,
      [prepared.scopeUuid],
    );
    const failure = await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(failure).toBeInstanceOf(
      CommittedPointOutcomeRequestKeyReuseErrorV1,
    );
    expect(failure).toMatchObject({
      mismatches: ["identityAccessPolicySha256"],
    });
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
    });
  });

  it("rolls back live, delete, and insert-delete point lowering", async () => {
    const live = await prepareO06Scenario(
      "o06_live_rollback",
      async (current, table) => {
        await expect(runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "live" },
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "inserted" },
        });
      },
    );
    const liveBefore = await o06DurableState(live.evidence.scopeUuid);
    const liveSteps: string[] = [];
    const liveResult = await runEffect(
      createPointCommitRollbackProofPortV1(resolutionPorts(persistence), {
        afterTransactionStep: (event) => {
          liveSteps.push(event.step);
          return Promise.resolve();
        },
      }).prove(live.command),
    );
    expect(liveResult).toEqual({ kind: "wouldCommit" });
    expect(Object.isFrozen(liveResult)).toBe(true);
    expect(liveSteps).toEqual([
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
      "dependenciesValidated",
      "tentativeRowWritten",
      "beforeRollback",
    ]);
    expect(await o06DurableState(live.evidence.scopeUuid)).toEqual(liveBefore);

    const deleted = await prepareO06Scenario(
      "o06_delete_rollback",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Missing seeded delete document.");
        }
        await expect(runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "unit" },
        });
      },
      true,
    );
    const deleteBefore = await o06DurableState(deleted.evidence.scopeUuid);
    const deleteSteps: string[] = [];
    await runEffect(
      createPointCommitRollbackProofPortV1(resolutionPorts(persistence), {
        afterTransactionStep: (event) => {
          deleteSteps.push(event.step);
          return Promise.resolve();
        },
      }).prove(deleted.command),
    );
    expect(deleteSteps).toContain("tentativeRowWritten");
    expect(await o06DurableState(deleted.evidence.scopeUuid)).toEqual(
      deleteBefore,
    );

    const noMaterial = await prepareO06Scenario(
      "o06_insert_delete_rollback",
      async (current, table) => {
        const inserted = await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "transient" },
        });
        if (
          inserted.kind !== "completed" ||
          inserted.outcome.kind !== "inserted"
        ) {
          throw new Error("Expected transient O06 insert.");
        }
        await runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          documentId: inserted.outcome.documentId,
        });
      },
    );
    const noMaterialSteps: string[] = [];
    await runEffect(
      createPointCommitRollbackProofPortV1(resolutionPorts(persistence), {
        afterTransactionStep: (event) => {
          noMaterialSteps.push(event.step);
          return Promise.resolve();
        },
      }).prove(noMaterial.command),
    );
    expect(noMaterial.command.dependencies).toHaveLength(1);
    expect(noMaterial.command.rowIntent).toBeNull();
    expect(noMaterialSteps).not.toContain("tentativeRowWritten");
    expect(noMaterialSteps.at(-1)).toBe("beforeRollback");
  });

  it("keeps lifecycle, preliminary authority, and target failures typed", async () => {
    const current = await prepareO06Scenario(
      "o06_typed_authority",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "typed" },
        });
      },
    );
    let authorityReads = 0;
    const runningFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeMetadata: {
          getScopeMetadataByDeploymentId: async () => {
            authorityReads += 1;
            throw new Error("Running input must fail before authority I/O.");
          },
        },
      }).prove(Object.freeze({
        ...current.command,
        session: Object.freeze({
          ...current.command.session,
          lifecycle: "running",
        }),
        sealIdentity: Object.freeze({
          ...current.command.sealIdentity,
          lifecycle: "running",
        }),
      })),
    );
    expect(runningFailure).toMatchObject({
      _tag: "PointCommitStaleAuthorityV1Error",
      reason: "lifecycleChanged",
    });
    expect(authorityReads).toBe(0);

    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation_fence = storage_generation_fence + 1
        where scope_uuid = $1
      `,
      [current.evidence.scopeUuid],
    );
    const generationFailure = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(current.command),
    );
    expect(generationFailure).toBeInstanceOf(
      PointCommitStaleAuthorityV1Error,
    );
    expect(generationFailure).toMatchObject({ reason: "generationChanged" });

    const mismatchedScopeId = decodeReplacementScopeIdV1(
      "scope_99000000-0000-4000-8000-000000000001",
    );
    const invalidClockFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (physicalLocator) => {
            const target =
              createPGliteLocatedPointMutationSessionActivationTargetV1(
                persistence,
                physicalLocator,
              );
            return Object.freeze({
              physicalLocator: target.physicalLocator,
              getCurrentClock: async (
                scopeId: Parameters<
                  LocatedScopeClockReader["getCurrentClock"]
                >[0],
              ) => {
                const clock = await target.getCurrentClock(scopeId);
                if (clock === null) return null;
                return Object.freeze({
                  ...clock,
                  scopeId: mismatchedScopeId,
                });
              },
            } satisfies LocatedScopeClockReader);
          },
        },
      }).prove(current.command),
    );
    expect(invalidClockFailure).toBeInstanceOf(
      PointCommitCorruptionV1Error,
    );
    expect(invalidClockFailure).toMatchObject({ reason: "scopeClockInvalid" });

    const targetFailure = Object.assign(new Error("target offline"), {
      code: "57P01",
    });
    const sqlFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async () => {
            throw targetFailure;
          },
        },
      }).prove(current.command),
    );
    expect(sqlFailure).toBeInstanceOf(PointCommitSqlErrorV1);
    expect(sqlFailure).toMatchObject({
      operation: "resolveAuthority",
      sqlState: "57P01",
      retryable: false,
    });
  });

  it("classifies OCC conflicts and commit-sequence exhaustion without writes", async () => {
    const conflict = await prepareO06Scenario(
      "o06_occ_conflict",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "planned" },
        });
      },
    );
    await commitCompetingPointRow(conflict.command);
    const conflictBefore = await o06DurableState(conflict.evidence.scopeUuid);
    const conflictFailure = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(conflict.command),
    );
    expect(conflictFailure).toBeInstanceOf(PointCommitConflictV1Error);
    expect(await o06DurableState(conflict.evidence.scopeUuid)).toEqual(
      conflictBefore,
    );

    const exhausted = await prepareO06Scenario(
      "o06_sequence_exhaustion",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "exhausted" },
        });
      },
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set last_commit_seq = $2
        where scope_uuid = $1
      `,
      [exhausted.evidence.scopeUuid, MAX_PERSISTED_SIGNED_INT64_V1],
    );
    const exhaustedFailure = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(exhausted.command),
    );
    expect(exhaustedFailure).toBeInstanceOf(
      PointCommitResourceExhaustionV1Error,
    );
    expect(exhaustedFailure).toMatchObject({ dimension: "commitSequence" });
  });

  it("does not observe interruption until forced rollback settles", async () => {
    const current = await prepareO06Scenario(
      "o06_interruption",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "interrupt" },
        });
      },
    );
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const port = createPointCommitRollbackProofPortV1(
      resolutionPorts(persistence),
      {
        afterTransactionStep: async (event) => {
          if (event.step !== "beforeRollback") return;
          entered.resolve();
          await release.promise;
        },
      },
    );
    const fiber = Effect.runFork(port.prove(current.command));
    await entered.promise;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(interruptionSettled).toBe(false);
    release.resolve();
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(await o06DurableState(current.evidence.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      last_commit_seq: "0",
    });
  });

  it("fails closed when rollback infrastructure or its sentinel contract fails", async () => {
    const current = await prepareO06Scenario(
      "o06_rollback_contract_failures",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "rollback-contract" },
        });
      },
    );
    const before = await o06DurableState(current.evidence.scopeUuid);
    const rollbackCause = new Error("rollback infrastructure failed");
    const rollbackFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (physicalLocator) => {
            const target =
              createPGliteLocatedPointMutationSessionActivationTargetV1(
                persistence,
                physicalLocator,
              );
            if (!isLocatedReadCommittedAttemptTargetV1(target)) {
              throw new Error("Expected the PGlite READ COMMITTED target.");
            }
            const proxyBase = Object.freeze({
              physicalLocator: target.physicalLocator,
              getCurrentClock: target.getCurrentClock,
            }) satisfies LocatedScopeClockReader;
            return new Proxy(proxyBase, {
              get: (subject, property, receiver) => {
                if (property !== RUN_LOCATED_READ_COMMITTED_V1) {
                  return Reflect.get(subject, property, receiver);
                }
                return async (
                  work: (tx: AppRowTransaction) => Promise<unknown>,
                ) => {
                  try {
                    return await target[RUN_LOCATED_READ_COMMITTED_V1](work);
                  } catch (callbackCause) {
                    throw new LocatedReadCommittedTransactionFailureV1(
                      rollbackCause,
                      callbackCause,
                    );
                  }
                };
              },
            });
          },
        },
      }).prove(current.command),
    );
    expect(rollbackFailure).toBeInstanceOf(PointCommitSqlErrorV1);
    if (!(rollbackFailure instanceof PointCommitSqlErrorV1)) {
      throw new Error("Expected the rollback infrastructure SQL failure.");
    }
    expect(rollbackFailure).toMatchObject({ operation: "beginOrRollback" });
    expect(rollbackFailure.cause).toBeInstanceOf(
      LocatedReadCommittedTransactionFailureV1,
    );
    if (
      !(rollbackFailure.cause instanceof
        LocatedReadCommittedTransactionFailureV1)
    ) {
      throw new Error("Expected the located transaction failure wrapper.");
    }
    expect(rollbackFailure.cause.cause).toBe(rollbackCause);
    expect(rollbackFailure.cause.callbackCause).toMatchObject({
      kind: "pointCommitRollbackSentinel",
    });
    expect(await o06DurableState(current.evidence.scopeUuid)).toEqual(before);

    const missingSentinelFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (physicalLocator) => {
            const target =
              createPGliteLocatedPointMutationSessionActivationTargetV1(
                persistence,
                physicalLocator,
              );
            if (!isLocatedReadCommittedAttemptTargetV1(target)) {
              throw new Error("Expected the PGlite READ COMMITTED target.");
            }
            const proxyBase = Object.freeze({
              physicalLocator: target.physicalLocator,
              getCurrentClock: target.getCurrentClock,
            }) satisfies LocatedScopeClockReader;
            return new Proxy(proxyBase, {
              get: (subject, property, receiver) =>
                property === RUN_LOCATED_READ_COMMITTED_V1
                  ? async () => undefined
                  : Reflect.get(subject, property, receiver),
            });
          },
        },
      }).prove(current.command),
    );
    expect(missingSentinelFailure).toBeInstanceOf(
      PointCommitCorruptionV1Error,
    );
    expect(missingSentinelFailure).toMatchObject({
      reason: "rollbackSentinelMissing",
    });
    expect(await o06DurableState(current.evidence.scopeUuid)).toEqual(before);
  });

  it("decodes malformed schema evidence only after repeatable read closes", async () => {
    const current = await scenario("commit_authority_malformed_schema");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_bytes = convert_to('x', 'UTF8')
        where deployment_id = $1
          and schema_version_id = $2
      `,
      [current.anchor.deploymentId, current.schemaVersionId],
    );

    let transactionClosed = false;
    let decodeObservedAfterClose = false;
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        afterRepeatableRead: () => {
          transactionClosed = true;
        },
        beforeSchemaArtifactDecode: () => {
          decodeObservedAfterClose = transactionClosed;
        },
      },
    );

    await expect(runEffect(loader.loadEffect(authority))).resolves.toMatchObject({
      kind: "corrupt",
      reason: "schemaArtifactInvalid",
    });
    expect(transactionClosed).toBe(true);
    expect(decodeObservedAfterClose).toBe(true);
  });

  it("does not disguise unexpected detached materialization defects as corruption", async () => {
    const current = await scenario("commit_authority_materialization_defect");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const defect = new Error("materialization defect sentinel");
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        beforeSchemaArtifactDecode: () => {
          throw defect;
        },
      },
    );

    const failure = await runFailure(loader.loadEffect(authority));
    expect(failure).toBeInstanceOf(
      StoredCommitAuthorityEvidencePersistenceV1Error,
    );
    expect(failure).toMatchObject({
      operation: "beforeSchemaArtifactDecode",
      cause: defect,
    });
  });

  it("accepts the exact 64 MiB aggregate and skips every payload at +1", async () => {
    const current = await scenario("commit_authority_limit");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const baseAuthority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const measured = await persistence.query<{
      total: string;
      args_bytes: string;
    }>(
      `
        select
          (
            octet_length(session.validated_args_json::text)
            + octet_length(session.validated_args_canonical_bytes)
            + octet_length(session.authorization_grant_json::text)
            + octet_length(session.authorization_grant_canonical_bytes)
            + octet_length(schema_version.manifest_json::text)
            + octet_length(schema_version.manifest_bytes)
          )::bigint::text as total,
          octet_length(session.validated_args_canonical_bytes)::bigint::text
            as args_bytes
        from fx_system_tx_session as session
        join fx_control_schema_version as schema_version
          on schema_version.deployment_id = $2
          and schema_version.schema_version_id = session.schema_version_id
        where session.session_id = $1
      `,
      [current.anchor.sessionId, current.anchor.deploymentId],
    );
    const measurement = measured.rows[0];
    if (measurement === undefined) throw new Error("Missing size measurement.");
    const exactArgsBytes = Number(measurement.args_bytes) +
      MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 -
      Number(measurement.total);
    await persistence.query(
      `
        update fx_system_tx_session
        set validated_args_canonical_bytes =
          convert_to(repeat('x', $2), 'UTF8')
        where session_id = $1
      `,
      [current.anchor.sessionId, exactArgsBytes],
    );
    const exactAuthority = Object.freeze({
      ...baseAuthority,
      session: Object.freeze({
        ...baseAuthority.session,
        validatedArgsCanonicalByteLength: exactArgsBytes,
      }),
    });
    const exactQueries: string[] = [];
    const exactLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      { observeQuery: (query) => exactQueries.push(query.name) },
    );
    await expect(runEffect(exactLoader.loadEffect(exactAuthority))).resolves
      .toMatchObject({
      kind: "loaded",
    });
    expect(exactQueries).toContain("authorityPayload");

    await persistence.query(
      `
        update fx_system_tx_session
        set validated_args_canonical_bytes =
          validated_args_canonical_bytes || decode('00', 'hex')
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    const overflowAuthority = Object.freeze({
      ...baseAuthority,
      session: Object.freeze({
        ...baseAuthority.session,
        validatedArgsCanonicalByteLength: exactArgsBytes + 1,
      }),
    });
    const overflowQueries: string[] = [];
    const overflowLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      { observeQuery: (query) => overflowQueries.push(query.name) },
    );
    await expect(runEffect(overflowLoader.loadEffect(overflowAuthority))).resolves
      .toMatchObject({ kind: "corrupt", reason: "evidenceLimitExceeded" });
    expect(overflowQueries).not.toContain("authorityPayload");
    expect(overflowQueries).not.toContain("schemaPayload");
    expect(overflowQueries).not.toContain("stableBindings");
  }, 120_000);

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
    const attempt = await runEffect(
      store.openAttemptEffect({
        selector: selectorFromAnchor(activation.anchor),
        snapshotToken: activation.anchor.snapshotToken,
        schemaVersionId,
      }),
    );
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

  async function c04b2Scenario(
    label: string,
    loaderOptions: ScenarioOptions = {},
    seedRow = false,
  ) {
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
    const usersTable = appTable("users");
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [usersTable],
      indexes: [],
    });
    const seededDocumentId = seedRow
      ? await seedCommittedUser(scopeId, schemaVersionId)
      : null;
    const target = decodeActivePointMutationTargetMetadataV1({
      format: "flarex.point-mutation-target-metadata",
      version: 1,
      deploymentId,
      scopeId,
      packageId: "package_c04b2_pglite",
      artifactRuntime: "dynamic-worker",
      artifactId: `artifact_${"b".repeat(32)}`,
      sourcePackageHash: "b".repeat(64),
      schemaVersionId,
      functions: [{
        path: "users:create",
        executionModule: "flarex/users.ts",
        kind: "mutation",
        visibility: "public",
        argsValidator: { type: "object", value: {} },
        returnsValidator: {
          type: "object",
          value: {
            ok: { optional: false, fieldType: { type: "boolean" } },
          },
        },
      }],
      schemaManifest: {
        kind: "appSchema",
        manifestVersion: 1,
        tableDefinitions: {
          kind: "tableDefinitions",
          sectionVersion: 1,
          tables: [{
            tableId: 1,
            namespace: "app",
            logicalName: usersTable.logicalName,
            definition: usersTable.definition,
          }],
        },
        indexBindings: {
          kind: "indexBindings",
          sectionVersion: 1,
          indexes: [],
        },
      },
    });
    const requestKey = TransactionRequestKeyV1Schema.make(
      `request:${label}`,
    );
    const revocationEpoch = TransactionAuthorizationRevocationEpochSchema.make(
      0n,
    );
    const prepared = await preparePointMutationStartEvidenceV1(
      target,
      {
        deploymentId,
        functionPath: TransactionFunctionPathV1Schema.make("users:create"),
        args: {},
        requestKey,
      },
      revocationEpoch,
    );
    const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    const issuedAtMilliseconds = Date.now() - 1_000;
    const expiresAtMilliseconds = Date.now() + 60_000;
    const payload = await canonicalizeTransactionGrantPayloadV1({
      format: "flarex.transaction-grant",
      version: 1,
      grantId: `grant_${label}`,
      ...prepared.logicalPins,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicySha256: policy.sha256Hex,
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      auth: { kind: "anonymous" },
      issuedAt: new Date(issuedAtMilliseconds).toISOString(),
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      authorizationRevocationEpoch: revocationEpoch.toString(),
    });
    const kid = TransactionGrantKeyIdV1Schema.make(`key_${label}`);
    const header = canonicalizeTransactionGrantProtectedHeaderV1({
      alg: "Ed25519",
      kid,
      typ: "flarex-transaction-grant+jws",
    });
    const grant = await deriveInertTransactionGrantEvidenceV1({
      protected: header.base64url,
      payload: payload.base64url,
      signature: encodeTransactionGrantEd25519SignatureV1(
        new Uint8Array(64),
      ),
    });
    const ports = resolutionPorts(persistence);
    const activation = await createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: 60_000, randomUuid: nextUuid },
    ).activate(pointMutationSessionActivationFixture(
      deploymentId,
      scopeId,
      {
        evidence: {
          packageId: prepared.logicalPins.packageId,
          artifactRuntime: prepared.logicalPins.artifactRuntime,
          artifactId: prepared.logicalPins.artifactId,
          sourcePackageHash: prepared.logicalPins.sourcePackageHash,
          executionModule: prepared.logicalPins.executionModule,
          functionPath: prepared.logicalPins.functionPath,
          functionKind: prepared.logicalPins.functionKind,
          schemaVersionId: prepared.logicalPins.schemaVersionId,
          policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
          identityAccessPolicySha256:
            transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
              policy.sha256Hex,
            ),
          validatedArgsJson: structuredClone(
            prepared.validatedArguments.valueJson,
          ),
          validatedArgsValueCodecVersion:
            prepared.logicalPins.validatedArgsValueCodecVersion,
          validatedArgsCanonicalBytes: prepared.validatedArguments.canonicalBytes,
          validatedArgsSha256: prepared.validatedArguments.sha256,
          authorizationGrantId: grant.authorizationGrantId,
          authorizationGrantJson: structuredClone(grant.authorizationGrantJson),
          authorizationGrantValueCodecVersion:
            grant.authorizationGrantValueCodecVersion,
          authorizationGrantCanonicalBytes:
            grant.authorizationGrantCanonicalBytes,
          authorizationGrantSha256: grant.authorizationGrantSha256,
          authorizationRevocationEpoch: revocationEpoch,
          authorizationGrantExpiresAt: new Date(expiresAtMilliseconds),
          requestKey,
          requestSha256: prepared.requestEvidence.sha256,
        },
      },
    ));
    const store = createSessionJournalStorePersistenceV1(ports, {
      randomUuid: nextUuid,
    });
    const functionMetadata = target.functions[0];
    if (functionMetadata === undefined) {
      throw new Error("Missing C04B2 function metadata fixture.");
    }
    return Object.freeze({
      persistence,
      anchor: activation.anchor,
      schemaVersionId,
      store,
      attempt: await runEffect(
        store.openAttemptEffect({
          selector: selectorFromAnchor(activation.anchor),
          snapshotToken: activation.anchor.snapshotToken,
          schemaVersionId,
        }),
      ),
      loader: createStoredAttemptEvidenceLoaderV1(ports, loaderOptions),
      authority: authorityFromAnchor(activation.anchor, schemaVersionId),
      loading: createPointMutationSessionAttemptLoadingV1(
        createPointMutationSessionAttemptLoadPersistenceV1(ports),
      ),
      verifier: createTransactionGrantVerifierV1({
        clock: { now: () => new Date(0) },
        verificationKeyNamespace:
          createTransactionGrantVerificationKeyNamespaceV1({
            deploymentId,
            keys: [{
              state: "active",
              kid,
              purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
              issuedAtInclusiveEpochMilliseconds: issuedAtMilliseconds - 1_000,
              verificationEndsAtExclusiveEpochMilliseconds:
                expiresAtMilliseconds + 1_000,
              verify: async () => true,
            }],
          }),
        maximumGrantLifetimeMilliseconds: 120_000,
        maximumFutureIssuedAtSkewMilliseconds: 0,
      }),
      functionSnapshot: Object.freeze({
        deploymentId,
        scopeId,
        packageId: prepared.logicalPins.packageId,
        artifactRuntime: prepared.logicalPins.artifactRuntime,
        artifactId: prepared.logicalPins.artifactId,
        sourcePackageHash: prepared.logicalPins.sourcePackageHash,
        executionModule: prepared.logicalPins.executionModule,
        functionPath: prepared.logicalPins.functionPath,
        functionKind: prepared.logicalPins.functionKind,
        schemaVersionId,
        functionMetadata: structuredClone(functionMetadata),
      }),
      seededDocumentId,
    });
  }

  async function seedCommittedUser(
    scopeId: ReturnType<typeof decodeReplacementScopeIdV1>,
    schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  ) {
    const tableId = decodeCatalogTableId(1);
    const rowId = decodeAppRowIdHexV1("11".repeat(16));
    const creationTime = decodeAppCreationTimeV1(1);
    const clock = await persistence.getScopeClock(scopeId);
    if (clock === null) throw new Error("Missing O06 seed scope clock.");
    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { name: "seeded" },
    });
    await persistence.drizzle.transaction((tx) =>
      appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        schemaVersionId,
        creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      })
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set last_commit_seq = 1
        where scope_id = $1
      `,
      [scopeId],
    );
    return appDocumentIdV1FromRowIdentity({ tableId, rowId });
  }

  async function prepareO06Scenario(
    label: string,
    operation: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    seedRow = false,
  ) {
    const current = await c04b2Scenario(label, {}, seedRow);
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await operation(current, table);
    await seal(current);
    const running = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (running.kind !== "loaded") {
      throw new Error(`Expected running O06 evidence, received ${running.kind}.`);
    }
    await runEffect(
      createPointCommitFinishingTransitionPortV1(
        resolutionPorts(persistence),
      ).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          current.authority,
          running.evidence,
        ),
      ),
    );
    const loaded = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (loaded.kind !== "loaded") {
      throw new Error(`Expected O06 evidence, received ${loaded.kind}.`);
    }
    return Object.freeze({
      current,
      evidence: loaded.evidence,
      command: await pointCommitCommandFromStoredAttemptV1(
        current.authority,
        loaded.evidence,
      ),
    });
  }

  async function prepareO07BScenario(
    label: string,
    operation?: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    options: PointCommitTransactionProofOptionsV1 = {},
  ) {
    const running = await prepareO07BRunningScenario(
      label,
      operation,
      options,
    );
    const plan = await runEffect(
      running.authentication.enterPointCommitFinishing(running.runningPlan),
    );
    return Object.freeze({
      ...running,
      plan,
    });
  }

  async function prepareO07BRunningScenario(
    label: string,
    operation?: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    options: PointCommitTransactionProofOptionsV1 = {},
  ) {
    const current = await c04b2Scenario(label);
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await operation?.(current, table);
    const envelope = await seal(current);
    const loadedAttempt = await current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    });
    const authentication = createO07BAuthentication(current, options);
    const authority = await runEffect(
      authentication.deriveAuthority(loadedAttempt),
    );
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(stored),
    );
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const runningPlan = await runEffect(
      authentication.planPointCommit(verified),
    );
    return Object.freeze({
      current,
      authentication,
      runningPlan,
      scopeUuid: projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
    });
  }

  function createO07BAuthentication(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    options: PointCommitTransactionProofOptionsV1 = {},
  ) {
    return createStoredAttemptAuthenticationV1(
      current.loader,
      {
        evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(
          resolutionPorts(persistence),
        ),
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () =>
            Effect.succeed(structuredClone(current.functionSnapshot)),
        },
        pointCommit: createPointCommitPublisherPortV1(
          resolutionPorts(persistence),
          options,
        ),
        pointCommitFinishing: createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ),
      },
    );
  }

  async function commitCompetingPointRow(
    command: PointCommitTransactionCommandV1,
  ): Promise<void> {
    const intent = command.rowIntent;
    if (intent === null || intent.kind !== "live") {
      throw new Error("O06 conflict fixture requires a live row intent.");
    }
    const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
    if (clock === null) throw new Error("Missing O06 conflict scope clock.");
    const document = await canonicalizeFlarexValueV1(
      intent.value,
      "appDocument",
    );
    await persistence.drizzle.transaction((tx) =>
      appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: command.authorityPins.scopeId,
        tableId: intent.tableId,
        rowId: intent.rowId,
        writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        schemaVersionId: command.authorityPins.schemaVersionId,
        creationTime: intent.creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      })
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set last_commit_seq = 1
        where scope_uuid = $1
      `,
      [command.sealIdentity.scopeUuid],
    );
  }

  async function o06DurableState(scopeUuid: string) {
    const result = await persistence.query<{
      revisions: string;
      current_rows: string;
      commit_headers: string;
      commit_changes: string;
      outcomes: string;
      wakes: string;
      last_commit_seq: string;
      last_outbox_seq: string;
    }>(
      `
        select
          (select count(*)::text from fx_app_row_rev
            where scope_uuid = $1) as revisions,
          (select count(*)::text from fx_app_row_current
            where scope_uuid = $1) as current_rows,
          (select count(*)::text from fx_system_commit
            where scope_uuid = $1) as commit_headers,
          (select count(*)::text from fx_system_commit_app_row_change
            where scope_uuid = $1) as commit_changes,
          (select count(*)::text from fx_system_idempotency
            where scope_uuid = $1) as outcomes,
          (select count(*)::text from fx_system_outbox
            where scope_uuid = $1) as wakes,
          last_commit_seq::text,
          last_outbox_seq::text
        from fx_system_scope_clock
        where scope_uuid = $1
      `,
      [scopeUuid],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing O06 durable state.");
    return row;
  }

  async function o07bTerminalState(
    scopeUuid: string,
    sessionId: string,
  ) {
    const result = await persistence.query<{
      lifecycle: string;
      leases: string;
      journals: string;
      receipts: string;
      points: string;
      write_events: string;
    }>(
      `
        select session.lifecycle,
          (select count(*)::text from fx_system_snapshot_lease
            where scope_uuid = $1 and session_id = $2) as leases,
          (select count(*)::text from fx_system_tx_journal
            where scope_uuid = $1 and session_id = $2) as journals,
          (select count(*)::text from fx_system_tx_journal_latest_receipt
            where scope_uuid = $1 and session_id = $2) as receipts,
          (select count(*)::text from fx_system_tx_journal_point
            where scope_uuid = $1 and session_id = $2) as points,
          (select count(*)::text from fx_system_tx_journal_write_event
            where scope_uuid = $1 and session_id = $2) as write_events
        from fx_system_tx_session as session
        where session.scope_uuid = $1 and session.session_id = $2
      `,
      [scopeUuid, sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing O07-B session state.");
    return row;
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
    const prepared = await prepareSeal(current.store, current.attempt);
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    return completeSeal(current.store, prepared.preparation, journal, result);
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

function commitAuthorityFromStoredEvidence(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: Extract<
    StoredAttemptEvidenceLoadResultV1,
    { readonly kind: "loaded" }
  >["evidence"],
): StoredCommitAuthorityEvidenceAuthorityV1 {
  return Object.freeze({
    ...authority,
    session: Object.freeze(structuredClone(evidence.session)),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: evidence.root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: evidence.root.updatedAtMilliseconds,
      sealedAtMilliseconds: evidence.root.sealedAtMilliseconds,
      finalSyscallSequence: evidence.root.sealedFinalSyscallSequence,
      creationTimeSeed: evidence.root.creationTimeSeed,
      nextCreationTime: evidence.root.nextCreationTime,
      journalFormat: SESSION_JOURNAL_FORMAT_V1,
      journalProtocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      journalValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      journalByteLength: evidence.root.journalBytes.byteLength,
      journalSha256: new Uint8Array(evidence.root.journalSha256),
      resultValueCodecVersion: evidence.root.resultValueCodecVersion,
      resultSemanticBytes: evidence.root.resultSemanticBytes,
      resultByteLength: evidence.root.resultBytes.byteLength,
      resultSha256: new Uint8Array(evidence.root.resultSha256),
      readDocuments: evidence.root.readDocuments,
      readSemanticBytes: evidence.root.readSemanticBytes,
      pointDependencyCount: evidence.root.pointDependencyCount,
      writeOperations: evidence.root.writeOperations,
      writeSemanticBytes: evidence.root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        evidence.root.materialWriteEventEvidenceBytes,
    }),
  });
}

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
