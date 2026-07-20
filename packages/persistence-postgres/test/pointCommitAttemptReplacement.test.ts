import { Effect, Fiber } from "effect";
import { and, eq } from "drizzle-orm";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
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
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  MAX_TRANSACTION_ATTEMPT_FENCE,
  TransactionAttemptFenceSchema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { beforeAll, describe, expect, it } from "vitest";

import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../src/schema";
import { createSessionJournalStorePersistenceV1 } from
  "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointMutationAttemptReplacementPortV1,
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementConflictNoLongerPresentV1Error,
  PointMutationAttemptReplacementCorruptionV1Error,
  PointMutationAttemptReplacementRequestKeyReuseV1Error,
  PointMutationAttemptReplacementResourceExhaustionV1Error,
  PointMutationAttemptReplacementStaleAuthorityV1Error,
  type PointCommitPublicationCommandV1,
  type PointCommitTransactionCommandV1,
  type PointMutationAttemptReplacementCommandV1,
  type PointMutationAttemptReplacementProofStepV1,
} from "../src/pointCommitTransaction";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
  pointMutationAttemptReplacementCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  completeSessionJournalSeal,
  prepareSessionJournalSeal,
  runEffect,
  runEffectFailure,
  runSessionJournalPointOperation,
} from "./effectTestRuntime";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const LEASE_DURATION_MILLISECONDS = 60_000;
const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "point-commit-attempt-replacement-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

interface PreparedReplacementAttemptV1 {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly command: PointMutationAttemptReplacementCommandV1;
  readonly transactionCommand: PointCommitTransactionCommandV1;
  readonly publicationCommand: PointCommitPublicationCommandV1;
  readonly scopeUuid: string;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
}

describe("O08-A exact-attempt replacement", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  it("reproduces the conflict and atomically installs one pristine attempt", async () => {
    const current = await prepareAttempt("replace", true);
    const steps: PointMutationAttemptReplacementProofStepV1[] = [];
    const port = createPointMutationAttemptReplacementPortV1(
      current.ports,
      {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
        afterReplacementStep: (event) => {
          steps.push(event.step);
          return Promise.resolve();
        },
      },
    );

    const replaced = await runEffect(port.replace(current.command));
    expect(replaced).toMatchObject({
      kind: "replaced",
      scopeUuid: current.scopeUuid,
      sessionId: current.anchor.sessionId,
      previousAttemptFence: 1n,
      attemptFence: 2n,
    });
    if (replaced.kind !== "replaced") {
      throw new Error("Expected O08-A to replace the exact attempt.");
    }
    expect(replaced.executionClaim).toMatchObject({
      claimFence: 1n,
    });
    expect(steps).toEqual([
      "clockLocked",
      "outcomeRechecked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
      "dependenciesValidated",
      "sessionEnteredRetrying",
      "journalDeleted",
      "leaseDeleted",
      "attemptFenceAdvanced",
      "leaseInserted",
      "journalRootInserted",
      "executionClaimInserted",
      "sessionRunning",
      "beforeCommit",
    ]);
    expect(await durableAttemptState(current)).toMatchObject({
      lifecycle: "running",
      session_fence: "2",
      lease_fence: "2",
      lease_snapshot_seq: "1",
      root_fence: "2",
      root_state: "open",
      last_sequence: "0",
      read_documents: 0,
      read_bytes: 0,
      point_count: 0,
      write_operations: 0,
      write_bytes: 0,
      event_bytes: 0,
      receipt_count: "0",
      point_row_count: "0",
      event_count: "0",
      execution_claim_count: "1",
      execution_claim_fence: "1",
      commit_headers: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "1",
      last_outbox_seq: "0",
    });

    await expect(runEffect(port.replace(current.command))).resolves.toMatchObject({
      kind: "alreadyReplaced",
      scopeUuid: current.scopeUuid,
      sessionId: current.anchor.sessionId,
      previousAttemptFence: 1n,
      attemptFence: 2n,
    });
  });

  it("rolls every mutation phase back to the exact old attempt", async () => {
    const phases = [
      "sessionEnteredRetrying",
      "journalDeleted",
      "leaseDeleted",
      "attemptFenceAdvanced",
      "leaseInserted",
      "journalRootInserted",
      "executionClaimInserted",
      "sessionRunning",
      "beforeCommit",
    ] as const;
    for (const phase of phases) {
      const current = await prepareAttempt(`rollback_${phase}`, true);
      const before = await durableAttemptState(current);
      const failure = await runEffectFailure(
        createPointMutationAttemptReplacementPortV1(current.ports, {
          leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
          afterReplacementStep: (event) => {
            if (event.step === phase) {
              throw new PointMutationAttemptReplacementCorruptionV1Error({
                reason: "replacementMutationInvalid",
              });
            }
            return Promise.resolve();
          },
        }).replace(current.command),
      );
      expect(failure).toBeInstanceOf(
        PointMutationAttemptReplacementCorruptionV1Error,
      );
      expect(await durableAttemptState(current)).toEqual(before);
    }
  }, 120_000);

  it("fails closed when the conflict disappears or the replacement is dirty", async () => {
    const noConflict = await prepareAttempt("no_conflict", false);
    const noConflictFailure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(noConflict.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(noConflict.command),
    );
    expect(noConflictFailure).toBeInstanceOf(
      PointMutationAttemptReplacementConflictNoLongerPresentV1Error,
    );
    expect(noConflictFailure).toMatchObject({
      reason: "conflictNoLongerPresent",
    });

    const dirty = await prepareAttempt("dirty_convergence", true);
    const port = createPointMutationAttemptReplacementPortV1(dirty.ports, {
      leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
    });
    await runEffect(port.replace(dirty.command));
    await persistence.query(
      `update fx_system_tx_journal set read_documents = 1
       where scope_uuid = $1 and session_id = $2`,
      [dirty.scopeUuid, dirty.anchor.sessionId],
    );
    const dirtyFailure = await runEffectFailure(port.replace(dirty.command));
    expect(dirtyFailure).toBeInstanceOf(
      PointMutationAttemptReplacementCorruptionV1Error,
    );
    expect(dirtyFailure).toMatchObject({
      reason: "replacementConvergenceInvalid",
    });
  });

  it("validates every dependency before accepting a reproducible conflict", async () => {
    for (const invalidFirst of [false, true]) {
      const current = await prepareAttempt(
        invalidFirst ? "invalid_first" : "invalid_last",
        true,
      );
      const existing = current.command.dependencies[0];
      if (existing === undefined) throw new Error("Missing conflict dependency.");
      const invalidRowId = decodeAppRowIdHexV1(
        invalidFirst ? "00000000000000000000000000000001" : "ffffffffffffffffffffffffffffffff",
      );
      const invalidDocumentId = appDocumentIdV1FromRowIdentity({
        tableId: existing.tableId,
        rowId: invalidRowId,
      });
      const invalidDependency = Object.freeze({
        documentId: invalidDocumentId,
        tableId: existing.tableId,
        rowId: invalidRowId,
        dependency: Object.freeze({
          kind: "appRowPoint" as const,
          documentId: invalidDocumentId,
          observed: Object.freeze({
            kind: "present" as const,
            revisionCommitSeq: CommitSeqSchema.make(1n),
          }),
        }),
      });
      await persistence.query(
        `update fx_system_tx_journal set point_dependency_count = 2
         where scope_uuid = $1 and session_id = $2`,
        [current.scopeUuid, current.anchor.sessionId],
      );
      const command = Object.freeze({
        ...current.command,
        dependencies: Object.freeze(
          invalidFirst
            ? [invalidDependency, existing]
            : [existing, invalidDependency],
        ),
        sealIdentity: Object.freeze({
          ...current.command.sealIdentity,
          pointDependencyCount: 2,
        }),
      });
      const before = await durableAttemptState(current);
      const failure = await runEffectFailure(
        createPointMutationAttemptReplacementPortV1(current.ports, {
          leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
        }).replace(command),
      );
      expect(failure).toBeInstanceOf(
        PointMutationAttemptReplacementCorruptionV1Error,
      );
      expect(failure).toMatchObject({ reason: "occEvidenceInvalid" });
      expect(await durableAttemptState(current)).toEqual(before);
    }
  });

  it("keeps malformed authoritative row-head scalars as corruption without replacement", async () => {
    const current = await prepareAttempt("invalid_row_head", true);
    const intent = current.transactionCommand.rowIntent;
    if (intent === null || intent.kind !== "live") {
      throw new Error("Expected one live row intent.");
    }
    await persistence.exec(`
      alter table fx_app_row_rev
        drop constraint fx_app_row_rev_creation_time_check
    `);
    try {
      await persistence.query(
        `
          update fx_app_row_rev
          set creation_time = 'NaN'::double precision
          where scope_uuid = $1
        `,
        [current.scopeUuid],
      );
      const before = await durableAttemptState(current);
      const failure = await runEffectFailure(
        createPointMutationAttemptReplacementPortV1(current.ports, {
          leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
        }).replace(current.command),
      );
      expect(failure).toBeInstanceOf(
        PointMutationAttemptReplacementCorruptionV1Error,
      );
      expect(failure).toMatchObject({ reason: "rowHeadInvalid" });
      expect(await durableAttemptState(current)).toEqual(before);
    } finally {
      await persistence.query(
        `
          update fx_app_row_rev
          set creation_time = $2
          where scope_uuid = $1
        `,
        [current.scopeUuid, intent.creationTime],
      );
      await persistence.exec(`
        alter table fx_app_row_rev
          add constraint fx_app_row_rev_creation_time_check
          check (creation_time > 0 and creation_time < 9007199254740992)
      `);
    }
  });

  it("checks exact committed-outcome evidence under the scope lock", async () => {
    const available = await prepareAttempt("outcome_available", true);
    await insertOutcomeFixture(available, "available");
    const availableFailure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(available.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(available.command),
    );
    expect(availableFailure).toBeInstanceOf(
      PointMutationAttemptReplacementCommittedOutcomeV1Error,
    );
    expect(availableFailure).toMatchObject({
      reason: "committedOutcomeAvailable",
      commitSeq: 1n,
    });
    expect(await durableAttemptState(available)).toMatchObject({
      lifecycle: "finishing",
      session_fence: "1",
      root_state: "sealed",
      outcomes: "1",
    });

    const expired = await prepareAttempt("outcome_expired", true);
    await insertOutcomeFixture(expired, "expired");
    const expiredFailure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(expired.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(expired.command),
    );
    expect(expiredFailure).toMatchObject({
      _tag: "PointMutationAttemptReplacementCommittedOutcomeV1Error",
      reason: "committedOutcomeExpired",
      commitSeq: 1n,
    });

    const mismatch = await prepareAttempt("outcome_mismatch", true);
    await insertOutcomeFixture(mismatch, "requestMismatch");
    const mismatchFailure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(mismatch.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(mismatch.command),
    );
    expect(mismatchFailure).toBeInstanceOf(
      PointMutationAttemptReplacementRequestKeyReuseV1Error,
    );
    expect(mismatchFailure).toMatchObject({ mismatches: ["requestSha256"] });

    const corrupt = await prepareAttempt("outcome_corrupt", true);
    await insertOutcomeFixture(corrupt, "headerEpochMismatch");
    const corruptFailure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(corrupt.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(corrupt.command),
    );
    expect(corruptFailure).toBeInstanceOf(
      PointMutationAttemptReplacementCorruptionV1Error,
    );
    expect(corruptFailure).toMatchObject({ reason: "committedOutcomeInvalid" });
  });

  it("fails closed for authority, lifecycle, lease, and seal drift", async () => {
    const revoked = await prepareAttempt("revoked", true);
    await persistence.query(
      `update fx_system_scope_clock
       set authorization_revocation_epoch = authorization_revocation_epoch + 1
       where scope_uuid = $1`,
      [revoked.scopeUuid],
    );
    await expect(expectReplacementFailure(revoked)).resolves.toMatchObject({
      _tag: "PointMutationAttemptReplacementStaleAuthorityV1Error",
      reason: "revocationEpochChanged",
    });

    const sessionMismatch = await prepareAttempt("session_mismatch", true);
    await persistence.query(
      `update fx_system_tx_session set policy_version = 'policy_corrupt'
       where scope_uuid = $1 and session_id = $2`,
      [sessionMismatch.scopeUuid, sessionMismatch.anchor.sessionId],
    );
    await expect(expectReplacementFailure(sessionMismatch)).resolves
      .toMatchObject({
      _tag: "PointMutationAttemptReplacementCorruptionV1Error",
      reason: "sessionInvalid",
    });

    const wrongLifecycle = await prepareAttempt("wrong_lifecycle", true);
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'running'
       where scope_uuid = $1 and session_id = $2`,
      [wrongLifecycle.scopeUuid, wrongLifecycle.anchor.sessionId],
    );
    await expect(expectReplacementFailure(wrongLifecycle)).resolves
      .toMatchObject({
      _tag: "PointMutationAttemptReplacementStaleAuthorityV1Error",
      reason: "lifecycleChanged",
    });

    const missingLease = await prepareAttempt("missing_lease", true);
    await persistence.query(
      `delete from fx_system_snapshot_lease
       where scope_uuid = $1 and session_id = $2`,
      [missingLease.scopeUuid, missingLease.anchor.sessionId],
    );
    await expect(expectReplacementFailure(missingLease)).resolves
      .toMatchObject({
      _tag: "PointMutationAttemptReplacementStaleAuthorityV1Error",
      reason: "leaseMissing",
    });

    const missingRoot = await prepareAttempt("missing_root", true);
    await persistence.query(
      `delete from fx_system_tx_journal
       where scope_uuid = $1 and session_id = $2`,
      [missingRoot.scopeUuid, missingRoot.anchor.sessionId],
    );
    await expect(expectReplacementFailure(missingRoot)).resolves.toMatchObject({
      _tag: "PointMutationAttemptReplacementCorruptionV1Error",
      reason: "journalRootMissingOrDuplicate",
    });

    const sealMismatch = await prepareAttempt("seal_mismatch", true);
    await persistence.query(
      `update fx_system_tx_journal
       set read_documents = read_documents + 1
       where scope_uuid = $1 and session_id = $2`,
      [sealMismatch.scopeUuid, sealMismatch.anchor.sessionId],
    );
    await expect(expectReplacementFailure(sealMismatch)).resolves.toMatchObject({
      _tag: "PointMutationAttemptReplacementCorruptionV1Error",
      reason: "journalRootInvalid",
    });

    const expiredLease = await prepareAttempt("expired_lease", true);
    const expired = await persistence.query<{ expires_at: Date }>(
      `update fx_system_snapshot_lease
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where scope_uuid = $1 and session_id = $2
       returning lease_expires_at as expires_at`,
      [expiredLease.scopeUuid, expiredLease.anchor.sessionId],
    );
    const expiresAt = expired.rows[0]?.expires_at;
    if (!(expiresAt instanceof Date)) throw new Error("Missing expired lease.");
    const expiredCommand = Object.freeze({
      ...expiredLease.command,
      sealIdentity: Object.freeze({
        ...expiredLease.command.sealIdentity,
        leaseExpiresAtMilliseconds: expiresAt.getTime(),
      }),
    });
    const expiredFailure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(expiredLease.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(expiredCommand),
    );
    expect(expiredFailure).toBeInstanceOf(
      PointMutationAttemptReplacementStaleAuthorityV1Error,
    );
    expect(expiredFailure).toMatchObject({ reason: "expired" });
  }, 120_000);

  it("rejects attempt-fence exhaustion before any replacement mutation", async () => {
    const current = await prepareAttempt("fence_exhaustion", true);
    const maximumFence = TransactionAttemptFenceSchema.make(
      MAX_TRANSACTION_ATTEMPT_FENCE,
    );
    await rewriteAttemptFence(current, maximumFence);
    const command = Object.freeze({
      ...current.command,
      authorityPins: Object.freeze({
        ...current.command.authorityPins,
        attemptFence: maximumFence,
      }),
    });
    const before = await durableAttemptState(current);
    const failure = await runEffectFailure(
      createPointMutationAttemptReplacementPortV1(current.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(command),
    );
    expect(failure).toBeInstanceOf(
      PointMutationAttemptReplacementResourceExhaustionV1Error,
    );
    expect(failure).toMatchObject({
      dimension: "attemptFence",
      maximum: MAX_TRANSACTION_ATTEMPT_FENCE,
    });
    expect(await durableAttemptState(current)).toEqual(before);
  });

  it("masks interruption until the replacement transaction settles", async () => {
    const current = await prepareAttempt("interruption", true);
    const entered = deferredSignal();
    const release = deferredSignal();
    const port = createPointMutationAttemptReplacementPortV1(current.ports, {
      leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      afterReplacementStep: async (event) => {
        if (event.step !== "beforeCommit") return;
        entered.resolve();
        await release.promise;
      },
    });
    const fiber = Effect.runFork(port.replace(current.command));
    await entered.promise;
    let settled = false;
    const interrupted = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      settled = true;
      return exit;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve();
    await interrupted;
    expect(await durableAttemptState(current)).toMatchObject({
      lifecycle: "running",
      session_fence: "2",
      root_state: "open",
    });
    await expect(runEffect(port.replace(current.command))).resolves
      .toMatchObject({ kind: "alreadyReplaced", attemptFence: 2n });
  });

  async function prepareAttempt(
    label: string,
    installConflict: boolean,
  ): Promise<PreparedReplacementAttemptV1> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_o08a_${label}`,
    );
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      `schema_o08a_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator: sharedLocator, randomUuid: nextUuid },
    ).ensure({
      deploymentId,
      projectId: `project_o08a_${label}`,
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
    const activationPort = createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS, randomUuid: nextUuid },
    );
    const activation = await runEffect(activationPort.activateEffect(
      pointMutationSessionActivationFixture(deploymentId, scopeId, {
        evidence: {
          schemaVersionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:o08a:${label}`,
          ),
        },
      }),
    ));
    if (activation.status !== "created") {
      throw new Error("Expected a newly created replacement attempt.");
    }
    const store = createSessionJournalStorePersistenceV1(ports, {
      randomUuid: nextUuid,
    });
    const attempt = await runEffect(store.openAttemptEffect({
      selector: {
        deploymentId,
        scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }));
    const table = await runEffect(
      store.resolvePointTableEffect(attempt, "users"),
    );
    await runSessionJournalPointOperation(store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: label },
    });
    const prepared = await prepareSessionJournalSeal(store, attempt);
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await completeSessionJournalSeal(
      store,
      prepared.preparation,
      journal,
      result,
    );
    const authority = authorityFromAnchor(
      activation.anchor,
      schemaVersionId,
      activation.executionClaim,
    );
    const loader = createStoredAttemptEvidenceLoaderV1(ports);
    const running = await runEffect(loader.loadEffect(authority));
    if (running.kind !== "loaded") throw new Error("Expected running evidence.");
    await runEffect(
      createPointCommitFinishingTransitionPortV1(ports).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          authority,
          running.evidence,
        ),
      ),
    );
    const finishing = await runEffect(loader.loadFinishingEffect({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    }));
    if (finishing.kind !== "loaded") {
      throw new Error("Expected finishing evidence.");
    }
    const transactionCommand = await pointCommitCommandFromStoredAttemptV1(
      authority,
      finishing.evidence,
    );
    if (installConflict) await commitCompetingPointRow(transactionCommand);
    return Object.freeze({
      anchor: activation.anchor,
      authority,
      command: await pointMutationAttemptReplacementCommandFromStoredAttemptV1(
        authority,
        finishing.evidence,
      ),
      transactionCommand,
      publicationCommand: Object.freeze({
        ...transactionCommand,
        successfulResult: Object.freeze({
          valueCodecVersion: result.evidence.valueCodecVersion,
          value: Object.freeze({ ok: true }),
          canonicalBytes: result.canonicalBytes,
          semanticSizeBytes: result.semanticSizeBytes,
          sha256Hex: result.evidence.sha256Hex,
        }),
      }),
      scopeUuid: projectScopeIdUuidV1(scopeId).scopeUuid,
      ports,
    });
  }

  async function commitCompetingPointRow(
    command: PointCommitTransactionCommandV1,
  ): Promise<void> {
    const intent = command.rowIntent;
    if (intent === null || intent.kind !== "live") {
      throw new Error("O08-A conflict fixture requires one live intent.");
    }
    const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
    if (clock === null) throw new Error("Missing O08-A scope clock.");
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
      `update fx_system_scope_clock set last_commit_seq = 1
       where scope_uuid = $1`,
      [command.sealIdentity.scopeUuid],
    );
  }

  async function durableAttemptState(current: PreparedReplacementAttemptV1) {
    const result = await persistence.query<Record<string, unknown>>(
      `select session.lifecycle,
        session.attempt_fence::text as session_fence,
        lease.attempt_fence::text as lease_fence,
        lease.snapshot_commit_seq::text as lease_snapshot_seq,
        root.attempt_fence::text as root_fence,
        root.state as root_state,
        root.last_syscall_sequence::text as last_sequence,
        root.read_documents, root.read_semantic_bytes as read_bytes,
        root.point_dependency_count as point_count,
        root.write_operations, root.write_semantic_bytes as write_bytes,
        root.material_write_event_evidence_bytes as event_bytes,
        (select count(*)::text from fx_system_tx_journal_latest_receipt r
          where r.scope_uuid = session.scope_uuid
            and r.session_id = session.session_id) as receipt_count,
        (select count(*)::text from fx_system_tx_journal_point p
          where p.scope_uuid = session.scope_uuid
            and p.session_id = session.session_id) as point_row_count,
        (select count(*)::text from fx_system_tx_journal_write_event e
          where e.scope_uuid = session.scope_uuid
            and e.session_id = session.session_id) as event_count,
        (select count(*)::text from fx_system_tx_execution_claim claim
          where claim.scope_uuid = session.scope_uuid
            and claim.session_id = session.session_id) as execution_claim_count,
        (select claim.claim_fence::text
          from fx_system_tx_execution_claim claim
          where claim.scope_uuid = session.scope_uuid
            and claim.session_id = session.session_id) as execution_claim_fence,
        (select count(*)::text from fx_system_commit c
          where c.scope_uuid = session.scope_uuid) as commit_headers,
        (select count(*)::text from fx_system_idempotency i
          where i.scope_uuid = session.scope_uuid) as outcomes,
        (select count(*)::text from fx_system_outbox o
          where o.scope_uuid = session.scope_uuid) as wakes,
        clock.last_commit_seq::text, clock.last_outbox_seq::text
      from fx_system_tx_session session
      join fx_system_scope_clock clock on clock.scope_uuid = session.scope_uuid
      left join fx_system_snapshot_lease lease
        on lease.scope_uuid = session.scope_uuid
        and lease.session_id = session.session_id
      left join fx_system_tx_journal root
        on root.scope_uuid = session.scope_uuid
        and root.session_id = session.session_id
      where session.scope_uuid = $1 and session.session_id = $2`,
      [current.scopeUuid, current.anchor.sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing O08-A durable state.");
    return row;
  }

  async function expectReplacementFailure(
    current: PreparedReplacementAttemptV1,
  ): Promise<unknown> {
    return runEffectFailure(
      createPointMutationAttemptReplacementPortV1(current.ports, {
        leaseDurationMilliseconds: LEASE_DURATION_MILLISECONDS,
      }).replace(current.command),
    );
  }

  async function rewriteAttemptFence(
    current: PreparedReplacementAttemptV1,
    attemptFence: ReturnType<typeof TransactionAttemptFenceSchema.make>,
  ): Promise<void> {
    await persistence.drizzle.transaction(async (tx) => {
      const leases = await tx.select().from(fxSystemSnapshotLeases).where(and(
        eq(
          fxSystemSnapshotLeases.scopeUuid,
          current.command.sealIdentity.scopeUuid,
        ),
        eq(fxSystemSnapshotLeases.sessionId, current.anchor.sessionId),
      ));
      const roots = await tx.select().from(fxSystemTransactionJournals)
        .where(and(
          eq(
            fxSystemTransactionJournals.scopeUuid,
            current.command.sealIdentity.scopeUuid,
          ),
          eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId),
        ));
      const receipts = await tx.select()
        .from(fxSystemTransactionJournalLatestReceipts).where(and(
          eq(
            fxSystemTransactionJournalLatestReceipts.scopeUuid,
            current.command.sealIdentity.scopeUuid,
          ),
          eq(
            fxSystemTransactionJournalLatestReceipts.sessionId,
            current.anchor.sessionId,
          ),
        ));
      const points = await tx.select().from(fxSystemTransactionJournalPoints)
        .where(and(
          eq(
            fxSystemTransactionJournalPoints.scopeUuid,
            current.command.sealIdentity.scopeUuid,
          ),
          eq(
            fxSystemTransactionJournalPoints.sessionId,
            current.anchor.sessionId,
          ),
        ));
      const events = await tx.select()
        .from(fxSystemTransactionJournalWriteEvents).where(and(
          eq(
            fxSystemTransactionJournalWriteEvents.scopeUuid,
            current.command.sealIdentity.scopeUuid,
          ),
          eq(
            fxSystemTransactionJournalWriteEvents.sessionId,
            current.anchor.sessionId,
          ),
        ));
      const lease = leases[0];
      const root = roots[0];
      if (leases.length !== 1 || roots.length !== 1 || lease === undefined ||
        root === undefined) {
        throw new Error("Expected one lease and sealed root for fence fixture.");
      }
      await tx.delete(fxSystemTransactionJournals).where(and(
        eq(
          fxSystemTransactionJournals.scopeUuid,
          current.command.sealIdentity.scopeUuid,
        ),
        eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId),
      ));
      await tx.delete(fxSystemSnapshotLeases).where(and(
        eq(
          fxSystemSnapshotLeases.scopeUuid,
          current.command.sealIdentity.scopeUuid,
        ),
        eq(fxSystemSnapshotLeases.sessionId, current.anchor.sessionId),
      ));
      await tx.update(fxSystemTransactionSessions).set({ attemptFence }).where(
        and(
          eq(
            fxSystemTransactionSessions.scopeUuid,
            current.command.sealIdentity.scopeUuid,
          ),
          eq(fxSystemTransactionSessions.sessionId, current.anchor.sessionId),
        ),
      );
      await tx.insert(fxSystemSnapshotLeases).values({
        ...lease,
        attemptFence,
      });
      await tx.insert(fxSystemTransactionJournals).values({
        ...root,
        attemptFence,
      });
      if (receipts.length > 0) {
        await tx.insert(fxSystemTransactionJournalLatestReceipts).values(
          receipts.map((receipt) => ({ ...receipt, attemptFence })),
        );
      }
      if (points.length > 0) {
        await tx.insert(fxSystemTransactionJournalPoints).values(
          points.map((point) => ({ ...point, attemptFence })),
        );
      }
      if (events.length > 0) {
        await tx.insert(fxSystemTransactionJournalWriteEvents).values(
          events.map((event) => ({ ...event, attemptFence })),
        );
      }
    });
  }

  async function insertOutcomeFixture(
    current: PreparedReplacementAttemptV1,
    kind:
      | "available"
      | "expired"
      | "requestMismatch"
      | "headerEpochMismatch",
  ): Promise<void> {
    const clock = await persistence.query<{ epoch_uuid: string }>(
      `select epoch_uuid::text from fx_system_scope_clock
       where scope_uuid = $1`,
      [current.scopeUuid],
    );
    const epochUuid = clock.rows[0]?.epoch_uuid;
    if (epochUuid === undefined) throw new Error("Missing O08-A epoch UUID.");
    const headerEpoch = kind === "headerEpochMismatch"
      ? "97000000-0000-4000-9000-000000000000"
      : epochUuid;
    await persistence.query(
      `insert into fx_system_commit(
        scope_uuid, epoch_uuid, commit_seq, change_count, committed_at
      ) values ($1, $2, 1, 0, clock_timestamp())`,
      [current.scopeUuid, headerEpoch],
    );
    const requestSha256 = kind === "requestMismatch"
      ? new Uint8Array(32).fill(9)
      : current.command.session.requestSha256;
    const availableState = kind !== "expired";
    await persistence.query(
      `insert into fx_system_idempotency(
        scope_uuid, request_key, identity_access_policy_sha256,
        function_path, request_sha256, epoch_uuid, commit_seq,
        result_state, result_value_codec_version, result_semantic_bytes,
        result_bytes, result_sha256, result_expired_at, created_at
      ) values (
        $1, $2, $3, $4, $5, $6, 1,
        $7, $8, $9, $10, $11,
        case when $7 = 'expired' then transaction_timestamp() else null end,
        transaction_timestamp()
      )`,
      [
        current.scopeUuid,
        current.command.authorityPins.requestKey,
        current.command.session.identityAccessPolicySha256,
        current.command.authorityPins.functionPath,
        requestSha256,
        epochUuid,
        availableState ? "available" : "expired",
        availableState ? 1 : null,
        availableState
          ? current.publicationCommand.successfulResult.semanticSizeBytes
          : null,
        availableState
          ? current.publicationCommand.successfulResult.canonicalBytes
          : null,
        availableState ? current.command.sealIdentity.resultSha256 : null,
      ],
    );
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
    return `97000000-0000-4000-8000-${suffix}`;
  }
});

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  executionClaim: NonNullable<
    StoredAttemptEvidenceAuthorityV1["executionClaim"]
  >,
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
    executionClaim,
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
          name: { fieldType: { type: "string" }, optional: true },
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
