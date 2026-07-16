import { Effect, Schema } from "effect";
import {
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
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
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
  type StoredCommitAuthorityEvidenceLoaderPortV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "../../executor/src/transactionGrant";
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
  createStoredCommitAuthorityEvidenceLoaderV1,
  MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceQueryV1,
} from "../src/storedCommitAuthorityEvidence";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
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
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

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

  it("size-projects C04B1 authority evidence before bounded payload transfer", async () => {
    const current = await scenario("commit_authority_capture");
    await seal(current);
    const authenticatedEvidence = await current.loader.load(current.authority);
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
    const executorPort: StoredCommitAuthorityEvidenceLoaderPortV1 = loader;
    const result = await executorPort.load(authority);

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
    const second = await executorPort.load(authority);
    if (second.kind !== "loaded") throw new Error("Expected detached reload.");
    expect(
      second.evidence.session.validatedArgsCanonicalBytes.some(
        (byte) => byte !== 0,
      ),
    ).toBe(true);
  });

  it("composes C03 through private C04C1 after both SQL captures close", async () => {
    let storedSqlClosed = false;
    const current = await c04b2Scenario("commit_input_composition", {
      afterRepeatableRead: () => {
        storedSqlClosed = true;
      },
    });
    const envelope = await seal(current);
    const loadedAttempt = await current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    });
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

    expect(storedSqlClosed).toBe(true);
    expect(authoritySqlClosed).toBe(true);
    expect(schemaDecodeAfterSqlClose).toBe(true);
    expect(metadataAfterSqlClose).toBe(true);
    expect(authentication.isCommitInputVerified(verified)).toBe(true);
    expect(authentication.isPointCommitPrepared(prepared)).toBe(true);
    expect({ authorityQueries, metadataLoads }).toEqual(beforeVerification);
  });

  it("decodes malformed schema evidence only after repeatable read closes", async () => {
    const current = await scenario("commit_authority_malformed_schema");
    await seal(current);
    const authenticatedEvidence = await current.loader.load(current.authority);
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

    await expect(loader.load(authority)).resolves.toMatchObject({
      kind: "corrupt",
      reason: "schemaArtifactInvalid",
    });
    expect(transactionClosed).toBe(true);
    expect(decodeObservedAfterClose).toBe(true);
  });

  it("does not disguise unexpected detached materialization defects as corruption", async () => {
    const current = await scenario("commit_authority_materialization_defect");
    await seal(current);
    const authenticatedEvidence = await current.loader.load(current.authority);
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

    await expect(loader.load(authority)).rejects.toBe(defect);
  });

  it("accepts the exact 64 MiB aggregate and skips every payload at +1", async () => {
    const current = await scenario("commit_authority_limit");
    await seal(current);
    const authenticatedEvidence = await current.loader.load(current.authority);
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
    await expect(exactLoader.load(exactAuthority)).resolves.toMatchObject({
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
    await expect(overflowLoader.load(overflowAuthority)).resolves
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

  async function c04b2Scenario(
    label: string,
    loaderOptions: ScenarioOptions = {},
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
      attempt: store.openAttempt({
        selector: selectorFromAnchor(activation.anchor),
        snapshotToken: activation.anchor.snapshotToken,
        schemaVersionId,
      }),
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

function commitAuthorityFromStoredEvidence(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: Extract<
    Awaited<ReturnType<StoredAttemptEvidenceLoaderV1["load"]>>,
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

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}
