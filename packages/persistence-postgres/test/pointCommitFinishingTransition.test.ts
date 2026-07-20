import {
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { Cause, Effect, Exit } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

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
import { TransactionExecutionClaimOwnerV1Schema } from
  "../src/transactionExecutionClaimModel";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../src/transactionExecutionClaimLiveness";
import {
  createSessionJournalStorePersistenceV1,
  type SessionJournalAttemptV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  PointCommitCorruptionV1Error,
  PointCommitSqlErrorV1,
  PointCommitStaleAuthorityV1Error,
  createPointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  createPointMutationSessionActivationPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import { pointCommitFinishingCommandFromStoredAttemptV1 } from
  "./pointCommitTransactionTestSupport";
import { runEffect, runEffectFailure as runFailure } from
  "./effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  executionClaimForAnchor,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "point-commit-finishing-pglite",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

interface Scenario {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly attempt: SessionJournalAttemptV1;
  readonly store: SessionJournalStorePersistenceV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly command: PointCommitFinishingTransitionCommandV1;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
}

describe("C05-A point-commit finishing transition", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  it("changes lifecycle and updatedAt while atomically consuming the execution claim", async () => {
    const current = await scenario("transition");
    const before = await sessionFingerprint(current.anchor.sessionId);
    const queries: Array<Readonly<{ name: string; sql: string }>> = [];
    const port = createPointCommitFinishingTransitionPortV1(current.ports, {
      observeQuery: (query) => queries.push(query),
    });

    const transitioned = await runEffect(
      port.enterFinishing(current.command),
    );
    expect(transitioned).toMatchObject({
      kind: "transitioned",
      scopeUuid: current.command.sealIdentity.scopeUuid,
      sessionId: current.command.authorityPins.sessionId,
      attemptFence: current.command.authorityPins.attemptFence,
      priorSessionUpdatedAtMilliseconds:
        current.command.session.updatedAtMilliseconds,
    });
    expect(transitioned.finishingSessionUpdatedAtMilliseconds).toBeGreaterThanOrEqual(
      transitioned.priorSessionUpdatedAtMilliseconds,
    );
    const after = await sessionFingerprint(current.anchor.sessionId);
    expect(after.lifecycle).toBe("finishing");
    expect(after.updatedAtMilliseconds).toBe(
      transitioned.finishingSessionUpdatedAtMilliseconds,
    );
    expect(after.immutable).toBe(before.immutable);
    expect(after.related).toBe(before.related);
    expect(before.executionClaims).toBe(1);
    expect(after.executionClaims).toBe(0);
    expect(queries.map((query) => query.name)).toEqual([
      "lockScopeClock",
      "lockSession",
      "lockLease",
      "lockJournalRoot",
      "readDatabaseTime",
      "deleteExecutionClaim",
      "enterFinishing",
    ]);
    const sessionQuery = queries.find((query) => query.name === "lockSession");
    expect(sessionQuery?.sql).not.toContain("validated_args_json");
    expect(sessionQuery?.sql).not.toContain("authorization_grant_json");
    const rootQuery = queries.find(
      (query) => query.name === "lockJournalRoot",
    );
    expect(rootQuery?.sql).toContain("octet_length");

    const liveness = createPointMutationExecutionClaimLivenessV1(
      current.ports,
      {
        claimDurationMilliseconds: 120_000,
        leaseRenewalDurationMilliseconds: 180_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      },
    );
    await expect(runEffect(liveness.renewEffect({
      selector: {
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      },
      executionClaim: current.command.executionClaim,
    }))).resolves.toEqual({ kind: "consumedByFinishing" });

    queries.length = 0;
    const observed = await runEffect(port.enterFinishing(current.command));
    expect(observed).toEqual({
      ...transitioned,
      kind: "observed",
    });
    expect(queries.map((query) => query.name)).toEqual([
      "lockScopeClock",
      "lockSession",
      "lockLease",
      "lockJournalRoot",
      "readDatabaseTime",
    ]);

    await persistence.query(
      `
        update fx_system_tx_session
        set updated_at = clock_timestamp() + interval '1 day'
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    expect(await runFailure(port.enterFinishing(current.command))).toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "finishingTransitionInvalid",
    });
  });

  it("fails closed across authority, fence, session, lease, and root mismatches", async () => {
    const current = await scenario("mismatches");
    const base = current.command;
    const changedIdentity = new Uint8Array(
      base.session.identityAccessPolicySha256,
    );
    changedIdentity[0] = (changedIdentity[0] ?? 0) ^ 0xff;
    const changedRequest = new Uint8Array(base.session.requestSha256);
    changedRequest[0] = (changedRequest[0] ?? 0) ^ 0xff;
    const variants: ReadonlyArray<Readonly<{
      label: string;
      command: PointCommitFinishingTransitionCommandV1;
      error: typeof PointCommitStaleAuthorityV1Error | typeof PointCommitCorruptionV1Error;
      reason: string;
    }>> = [
      {
        label: "generation fence",
        command: Object.freeze({
          ...base,
          authorityPins: Object.freeze({
            ...base.authorityPins,
            storageGenerationFence: StorageGenerationFenceSchema.make(
              base.authorityPins.storageGenerationFence + 1n,
            ),
          }),
          session: Object.freeze({
            ...base.session,
            storageGenerationFence: base.session.storageGenerationFence + 1n,
          }),
        }),
        error: PointCommitStaleAuthorityV1Error,
        reason: "generationChanged",
      },
      {
        label: "epoch",
        command: Object.freeze({
          ...base,
          authorityPins: Object.freeze({
            ...base.authorityPins,
            snapshotToken: Object.freeze({
              ...base.authorityPins.snapshotToken,
              epoch: ScopeEpochSchema.make("epoch_c05a_mismatch"),
            }),
          }),
        }),
        error: PointCommitStaleAuthorityV1Error,
        reason: "epochChanged",
      },
      {
        label: "revocation",
        command: Object.freeze({
          ...base,
          authorityPins: Object.freeze({
            ...base.authorityPins,
            authorizationRevocationEpoch:
              TransactionAuthorizationRevocationEpochSchema.make(1n),
          }),
          session: Object.freeze({
            ...base.session,
            authorizationRevocationEpoch: 1n,
          }),
        }),
        error: PointCommitStaleAuthorityV1Error,
        reason: "revocationEpochChanged",
      },
      {
        label: "execution claim owner",
        command: Object.freeze({
          ...base,
          executionClaim: Object.freeze({
            ...base.executionClaim,
            claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
              "85000000-0000-4000-8000-000000009991",
            ),
          }),
        }),
        error: PointCommitStaleAuthorityV1Error,
        reason: "lifecycleChanged",
      },
      {
        label: "attempt fence",
        command: Object.freeze({
          ...base,
          authorityPins: Object.freeze({
            ...base.authorityPins,
            attemptFence: TransactionAttemptFenceSchema.make(
              base.authorityPins.attemptFence + 1n,
            ),
          }),
        }),
        error: PointCommitStaleAuthorityV1Error,
        reason: "attemptReplaced",
      },
      {
        label: "package pin",
        command: Object.freeze({
          ...base,
          authorityPins: Object.freeze({
            ...base.authorityPins,
            packageId: TransactionPackageIdV1Schema.make("package_changed"),
          }),
          session: Object.freeze({
            ...base.session,
            packageId: "package_changed",
          }),
        }),
        error: PointCommitCorruptionV1Error,
        reason: "sessionInvalid",
      },
      {
        label: "identity digest",
        command: Object.freeze({
          ...base,
          session: Object.freeze({
            ...base.session,
            identityAccessPolicySha256: changedIdentity,
          }),
        }),
        error: PointCommitCorruptionV1Error,
        reason: "sessionInvalid",
      },
      {
        label: "request evidence",
        command: Object.freeze({
          ...base,
          authorityPins: Object.freeze({
            ...base.authorityPins,
            requestKey: TransactionRequestKeyV1Schema.make("request:changed"),
          }),
          session: Object.freeze({
            ...base.session,
            requestKey: "request:changed",
            requestSha256: changedRequest,
          }),
        }),
        error: PointCommitCorruptionV1Error,
        reason: "sessionInvalid",
      },
      {
        label: "session timestamp",
        command: Object.freeze({
          ...base,
          session: Object.freeze({
            ...base.session,
            updatedAtMilliseconds: base.session.updatedAtMilliseconds + 1,
          }),
          sealIdentity: Object.freeze({
            ...base.sealIdentity,
            sessionUpdatedAtMilliseconds:
              base.sealIdentity.sessionUpdatedAtMilliseconds + 1,
          }),
        }),
        error: PointCommitCorruptionV1Error,
        reason: "sessionInvalid",
      },
      {
        label: "lease identity",
        command: Object.freeze({
          ...base,
          sealIdentity: Object.freeze({
            ...base.sealIdentity,
            leaseExpiresAtMilliseconds:
              base.sealIdentity.leaseExpiresAtMilliseconds - 1,
          }),
        }),
        error: PointCommitCorruptionV1Error,
        reason: "leaseInvalid",
      },
      {
        label: "sealed root counter",
        command: Object.freeze({
          ...base,
          sealIdentity: Object.freeze({
            ...base.sealIdentity,
            writeOperations: base.sealIdentity.writeOperations + 1,
          }),
        }),
        error: PointCommitCorruptionV1Error,
        reason: "journalRootInvalid",
      },
    ];

    const port = createPointCommitFinishingTransitionPortV1(current.ports);
    for (const variant of variants) {
      const failure = await runFailure(port.enterFinishing(variant.command));
      expect(failure, variant.label).toBeInstanceOf(variant.error);
      expect(failure, variant.label).toMatchObject({ reason: variant.reason });
    }
    expect((await sessionFingerprint(current.anchor.sessionId)).lifecycle).toBe(
      "running",
    );
  });

  it("maps authority-port SQL rejection and preserves an unexpected cause as a defect", async () => {
    const current = await scenario("authority_port_failures");
    const sqlCause = Object.assign(new Error("authority SQL unavailable"), {
      code: "08006",
    });
    const sqlPorts = Object.freeze({
      ...current.ports,
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          throw sqlCause;
        },
      },
    }) satisfies PointMutationSessionAuthorityResolutionPortsV1;

    const sqlFailure = await runFailure(
      createPointCommitFinishingTransitionPortV1(sqlPorts)
        .enterFinishing(current.command),
    );
    expect(sqlFailure).toMatchObject({
      _tag: "PointCommitSqlErrorV1",
      operation: "resolveAuthority",
      sqlState: "08006",
      cause: sqlCause,
    });

    const defect = new Error("unexpected authority adapter defect");
    const defectPorts = Object.freeze({
      ...current.ports,
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          throw defect;
        },
      },
    }) satisfies PointMutationSessionAuthorityResolutionPortsV1;
    const exit = await Effect.runPromiseExit(
      createPointCommitFinishingTransitionPortV1(defectPorts)
        .enterFinishing(current.command),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1);
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isDieReason(reason)) {
        expect(reason.defect).toBe(defect);
      }
    }
  });

  it("uses database time for expiry and rolls back an injected post-update failure", async () => {
    const expired = await scenario("expired");
    const pastMilliseconds = expired.command.session.createdAtMilliseconds + 1;
    await persistence.query(
      `
        update fx_system_tx_session
        set authorization_grant_expires_at = $2,
            hard_expires_at = $2
        where session_id = $1
      `,
      [expired.anchor.sessionId, new Date(pastMilliseconds)],
    );
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = $2
        where session_id = $1
      `,
      [expired.anchor.sessionId, new Date(pastMilliseconds)],
    );
    const expiredCommand = Object.freeze({
      ...expired.command,
      session: Object.freeze({
        ...expired.command.session,
        authorizationGrantExpiresAtMilliseconds: pastMilliseconds,
        hardExpiresAtMilliseconds: pastMilliseconds,
      }),
      sealIdentity: Object.freeze({
        ...expired.command.sealIdentity,
        leaseExpiresAtMilliseconds: pastMilliseconds,
      }),
    });
    expect(await runFailure(
      createPointCommitFinishingTransitionPortV1(expired.ports)
        .enterFinishing(expiredCommand),
    )).toMatchObject({
      _tag: "PointCommitStaleAuthorityV1Error",
      reason: "expired",
    });

    const rollback = await scenario("rollback");
    const injected = Object.assign(new Error("post-update rollback"), {
      code: "40001",
    });
    const options: PointCommitTransactionProofOptionsV1 = {
      afterTransactionStep: async (event) => {
        if (event.step === "sessionEnteredFinishing") throw injected;
      },
    };
    const failure = await runFailure(
      createPointCommitFinishingTransitionPortV1(rollback.ports, options)
        .enterFinishing(rollback.command),
    );
    expect(failure).toBeInstanceOf(PointCommitSqlErrorV1);
    expect(failure).toMatchObject({ sqlState: "40001" });
    expect((await sessionFingerprint(rollback.anchor.sessionId)).lifecycle).toBe(
      "running",
    );
  });

  async function scenario(label: string): Promise<Scenario> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_c05a_${label}`,
    );
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      `schema_c05a_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator: sharedLocator, randomUuid: nextUuid },
    ).ensure({ deploymentId, projectId: `project_c05a_${label}` });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [appTable("users")],
      indexes: [],
    });
    const ports = resolutionPorts();
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ports,
        { leaseDurationMilliseconds: 60_000, randomUuid: nextUuid },
      ),
      pointMutationSessionActivationFixture(
        deploymentId,
        scopeId,
        { evidence: { schemaVersionId } },
      ),
    );
    const store = createSessionJournalStorePersistenceV1(ports, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      randomUuid: nextUuid,
    });
    const attempt = await runEffect(store.openAttemptEffect({
      selector: {
        deploymentId,
        scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      executionClaim: executionClaimForAnchor(activation.anchor),
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }));
    const prepared = await runEffect(store.prepareSealEffect(attempt));
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await runEffect(store.completeSealEffect(
      prepared.preparation,
      journal,
      result,
    ));
    const authority = authorityFromAnchor(
      activation.anchor,
      schemaVersionId,
      executionClaimForAnchor(activation.anchor),
    );
    const loaded = await runEffect(
      createStoredAttemptEvidenceLoaderV1(ports).loadEffect(authority),
    );
    if (loaded.kind !== "loaded") {
      throw new Error(`Expected running C05-A evidence, received ${loaded.kind}.`);
    }
    return Object.freeze({
      anchor: activation.anchor,
      attempt,
      store,
      authority,
      command: await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        loaded.evidence,
      ),
      ports,
    });
  }

  function resolutionPorts(): PointMutationSessionAuthorityResolutionPortsV1 {
    return {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared placement must not read split receipts.");
        },
      },
      scopeSessionTargets: {
        resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            persistence,
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

  async function sessionFingerprint(sessionId: string): Promise<Readonly<{
    lifecycle: string;
    updatedAtMilliseconds: number;
    immutable: string;
    related: string;
    executionClaims: number;
  }>> {
    const result = await persistence.query<Readonly<{
      lifecycle: string;
      updated_at_milliseconds: string;
      immutable: string;
      related: string;
      execution_claims: number;
    }>>(
      `
        select
          session.lifecycle,
          floor(extract(epoch from session.updated_at) * 1000)::bigint::text
            as updated_at_milliseconds,
          (to_jsonb(session) - 'lifecycle' - 'updated_at')::text as immutable,
          jsonb_build_object(
            'clock', (select to_jsonb(clock) from fx_system_scope_clock clock
              where clock.scope_uuid = session.scope_uuid),
            'lease', (select to_jsonb(lease) from fx_system_snapshot_lease lease
              where lease.scope_uuid = session.scope_uuid
                and lease.session_id = session.session_id),
            'root', (select to_jsonb(root) from fx_system_tx_journal root
              where root.scope_uuid = session.scope_uuid
                and root.session_id = session.session_id)
          )::text as related
          , (select count(*)::int from fx_system_tx_execution_claim claim
              where claim.scope_uuid = session.scope_uuid
                and claim.session_id = session.session_id
                and claim.attempt_fence = session.attempt_fence)
              as execution_claims
        from fx_system_tx_session session
        where session.session_id = $1
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing C05-A session row.");
    return Object.freeze({
      lifecycle: row.lifecycle,
      updatedAtMilliseconds: Number(row.updated_at_milliseconds),
      immutable: row.immutable,
      related: row.related,
      executionClaims: row.execution_claims,
    });
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
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}
