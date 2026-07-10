import { eq } from "drizzle-orm";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  FlarexPersistence,
  SplitScopePhysicalLocator,
} from "../src";
import { insertDeploymentMetadata } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import {
  getScopeAuthorityProvisioningReceipt,
  InvalidScopeAuthorityProvisioningReceiptInputError,
  publishScopeAuthorityReadyInTransaction,
  reserveScopeAuthorityProvisioningReceiptInTransaction,
  ScopeAuthorityProvisioningReceiptCorruptionError,
} from "../src/scopeAuthorityProvisioningReceipt";
import type {
  ReadySplitScopeAuthorityProvisioningReceipt,
  ReserveSplitScopeAuthorityProvisioningReceiptInput,
  ReserveSplitScopeAuthorityProvisioningReceiptResult,
  ReservedSplitScopeAuthorityProvisioningReceipt,
  SplitScopeAuthorityProvisioningReceiptIdentity,
} from "../src/scopeAuthorityProvisioningReceiptTypes";
import { insertScopeMetadata } from "../src/scopeMetadata";
import { fxControlScopes } from "../src/schema";

const schemaLocator = {
  kind: "schema_per_scope",
  databaseKey: "primary",
  schemaName: "fx_receipt",
} as const satisfies SplitScopePhysicalLocator;

const databaseLocator = {
  kind: "database_per_scope",
  databaseKey: "scope-database",
  schemaName: "public",
} as const satisfies SplitScopePhysicalLocator;

const epochA = ScopeEpochSchema.make("epoch_receipt_a");
const epochB = ScopeEpochSchema.make("epoch_receipt_b");

type ForbiddenRootReceiptMethod = Extract<
  keyof FlarexPersistence,
  | "getScopeAuthorityProvisioningReceipt"
  | "publishScopeAuthorityReady"
  | "reserveScopeAuthorityProvisioningReceipt"
>;

type ForbiddenReservationInputField = Extract<
  keyof ReserveSplitScopeAuthorityProvisioningReceiptInput,
  | "protocolVersion"
  | "state"
  | "reservedAt"
  | "readyAt"
  | "storageGeneration"
  | "storageGenerationFence"
  | "lastCommitSeq"
  | "lastOutboxSeq"
>;

type SharedSplitLocator = Extract<
  SplitScopePhysicalLocator,
  { readonly kind: "shared_database" }
>;

describe("split scope authority provisioning receipts", () => {
  it("keeps lifecycle mutation out of the root persistence capability", () => {
    expectTypeOf<ForbiddenRootReceiptMethod>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenReservationInputField>().toEqualTypeOf<never>();
    expectTypeOf<SharedSplitLocator>().toEqualTypeOf<never>();
    expectTypeOf<ReservedSplitScopeAuthorityProvisioningReceipt["readyAt"]>()
      .toEqualTypeOf<null>();
    expectTypeOf<ReadySplitScopeAuthorityProvisioningReceipt["readyAt"]>()
      .toEqualTypeOf<Date>();
  });

  it("atomically composes scope creation and a reserved receipt", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_receipt_atomic");

    const result = await persistence.drizzle.transaction(async (tx) => {
      await insertDeploymentMetadata(tx, {
        deploymentId: "deployment_receipt_atomic",
        projectId: "project_receipt_atomic",
      });
      await insertScopeMetadata(tx, {
        scopeId,
        deploymentId: "deployment_receipt_atomic",
        physicalLocator: schemaLocator,
      });
      return reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
        scopeId,
        physicalLocator: schemaLocator,
        candidateInitialEpoch: epochA,
      });
    });

    expect(result).toMatchObject({
      status: "created_reserved",
      receipt: {
        scopeId,
        protocolVersion: "split_scope_authority_v1",
        state: "reserved",
        physicalLocator: schemaLocator,
        initialEpoch: epochA,
        readyAt: null,
      },
    });
    expect(result.receipt.reservedAt).toBeInstanceOf(Date);
    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).resolves.toEqual(result.receipt);
    await expect(persistence.getScopeClock(scopeId)).resolves.toBeNull();
  });

  it("rolls back deployment, scope, and receipt as one control transaction", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_receipt_rollback");

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await insertDeploymentMetadata(tx, {
          deploymentId: "deployment_receipt_rollback",
          projectId: "project_receipt_rollback",
        });
        await insertScopeMetadata(tx, {
          scopeId,
          deploymentId: "deployment_receipt_rollback",
          physicalLocator: schemaLocator,
        });
        await reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
          scopeId,
          physicalLocator: schemaLocator,
          candidateInitialEpoch: epochA,
        });
        throw new Error("receipt-control-rollback-probe");
      }),
    ).rejects.toThrow("receipt-control-rollback-probe");

    await expect(
      persistence.getDeploymentMetadata("deployment_receipt_rollback"),
    ).resolves.toBeNull();
    await expect(persistence.getScopeMetadata(scopeId)).resolves.toBeNull();
    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).resolves.toBeNull();
  });

  it("adopts the persisted epoch on reservation replay", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "reservation_replay",
      schemaLocator,
    );

    const first = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );
    const replay = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochB,
    );

    expect(first).toMatchObject({
      status: "created_reserved",
      receipt: { initialEpoch: epochA },
    });
    expect(replay).toEqual({
      status: "already_reserved",
      receipt: first.receipt,
    });
  });

  it("rejects missing or conflicting canonical scope placement", async () => {
    const persistence = await migratedPersistence();
    const missingScopeId = ScopeIdSchema.make("scope_receipt_missing");

    await expect(
      reserveReceipt(
        persistence,
        missingScopeId,
        schemaLocator,
        epochA,
      ),
    ).rejects.toMatchObject({
      name: "ScopeAuthorityProvisioningReceiptConflictError",
      conflict: { reason: "scopeMissing", scopeId: missingScopeId },
    });

    const conflictingScopeId = await insertSplitScope(
      persistence,
      "scope_placement_conflict",
      databaseLocator,
    );
    await expect(
      reserveReceipt(
        persistence,
        conflictingScopeId,
        schemaLocator,
        epochA,
      ),
    ).rejects.toMatchObject({
      name: "ScopeAuthorityProvisioningReceiptConflictError",
      conflict: {
        reason: "scopePlacementMismatch",
        scopeId: conflictingScopeId,
      },
    });
    await expect(
      getScopeAuthorityProvisioningReceipt(
        persistence.drizzle,
        conflictingScopeId,
      ),
    ).resolves.toBeNull();
  });

  it("detects drift between routing authority and immutable receipt intent", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "receipt_placement_conflict",
      schemaLocator,
    );
    const reserved = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );
    await persistence.drizzle
      .update(fxControlScopes)
      .set({
        isolationKind: databaseLocator.kind,
        physicalLocator: databaseLocator,
      })
      .where(eq(fxControlScopes.scopeId, scopeId));

    await expect(
      reserveReceipt(
        persistence,
        scopeId,
        databaseLocator,
        epochB,
      ),
    ).rejects.toMatchObject({
      name: "ScopeAuthorityProvisioningReceiptConflictError",
      conflict: {
        reason: "receiptPlacementMismatch",
        scopeId,
      },
    });
    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).resolves.toEqual(reserved.receipt);
  });

  it("publishes readiness by exact identity and replays monotonically", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "ready_cas",
      schemaLocator,
    );
    const reserved = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );
    const expected = receiptIdentity(reserved.receipt);

    const published = await persistence.drizzle.transaction((tx) =>
      publishScopeAuthorityReadyInTransaction(tx, { expected }),
    );
    const replay = await persistence.drizzle.transaction((tx) =>
      publishScopeAuthorityReadyInTransaction(tx, { expected }),
    );

    expect(published).toMatchObject({
      status: "published_ready",
      receipt: {
        state: "ready",
        initialEpoch: epochA,
      },
    });
    expect(published.receipt.readyAt).toBeInstanceOf(Date);
    expect(
      published.receipt.readyAt.getTime(),
    ).toBeGreaterThanOrEqual(published.receipt.reservedAt.getTime());
    expect(replay).toEqual({
      status: "already_ready",
      receipt: published.receipt,
    });

    const reservationReplay = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochB,
    );
    expect(reservationReplay).toEqual({
      status: "already_ready",
      receipt: published.receipt,
    });
  });

  it("rolls back tentative readiness publication", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "ready_rollback",
      schemaLocator,
    );
    const reserved = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await publishScopeAuthorityReadyInTransaction(tx, {
          expected: receiptIdentity(reserved.receipt),
        });
        throw new Error("receipt-ready-rollback-probe");
      }),
    ).rejects.toThrow("receipt-ready-rollback-probe");
    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).resolves.toEqual(reserved.receipt);
  });

  it("rejects a missing receipt or mismatched epoch at ready publication", async () => {
    const persistence = await migratedPersistence();
    const missingReceiptScopeId = await insertSplitScope(
      persistence,
      "ready_missing_receipt",
      schemaLocator,
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        publishScopeAuthorityReadyInTransaction(tx, {
          expected: {
            scopeId: missingReceiptScopeId,
            protocolVersion: "split_scope_authority_v1",
            physicalLocator: schemaLocator,
            initialEpoch: epochA,
          },
        }),
      ),
    ).rejects.toMatchObject({
      name: "ScopeAuthorityProvisioningReceiptConflictError",
      conflict: {
        reason: "receiptMissingForReady",
        scopeId: missingReceiptScopeId,
      },
    });

    const scopeId = await insertSplitScope(
      persistence,
      "ready_epoch_conflict",
      schemaLocator,
    );
    const reserved = await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        publishScopeAuthorityReadyInTransaction(tx, {
          expected: receiptIdentity(reserved.receipt, epochB),
        }),
      ),
    ).rejects.toMatchObject({
      name: "ScopeAuthorityProvisioningReceiptConflictError",
      conflict: {
        reason: "receiptInitialEpochMismatch",
        scopeId,
        expected: epochB,
        actual: epochA,
      },
    });
    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).resolves.toEqual(reserved.receipt);
  });

  it("enforces receipt foreign key, split locator, epoch, and state constraints", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "ddl_constraints",
      schemaLocator,
    );
    const orphanScopeId = ScopeIdSchema.make("scope_receipt_orphan");

    await expect(
      rawInsertReceipt(persistence, {
        scopeId: orphanScopeId,
        state: "reserved",
        locator: schemaLocator,
        initialEpoch: "epoch_orphan",
        readyAt: null,
      }),
    ).rejects.toThrow();
    await expect(
      rawInsertReceipt(persistence, {
        scopeId,
        state: "reserved",
        locator: {
          kind: "shared_database",
          databaseKey: "primary",
          schemaName: "public",
        },
        initialEpoch: "epoch_shared",
        readyAt: null,
      }),
    ).rejects.toThrow();
    await expect(
      rawInsertReceipt(persistence, {
        scopeId,
        state: "reserved",
        locator: schemaLocator,
        initialEpoch: " ",
        readyAt: null,
      }),
    ).rejects.toThrow();
    await expect(
      rawInsertReceipt(persistence, {
        scopeId,
        state: "ready",
        locator: schemaLocator,
        initialEpoch: "epoch_ready_without_timestamp",
        readyAt: null,
      }),
    ).rejects.toThrow();
    await expect(
      rawInsertReceipt(persistence, {
        scopeId,
        state: "reserved",
        locator: schemaLocator,
        initialEpoch: "epoch_reserved_with_timestamp",
        readyAt: new Date("2026-07-10T00:00:00.000Z"),
      }),
    ).rejects.toThrow();
    await expect(
      rawInsertReceipt(persistence, {
        scopeId,
        state: "reserved",
        locator: {
          ...schemaLocator,
          credential: "must-not-be-persisted",
        },
        initialEpoch: "epoch_extra_locator_field",
        readyAt: null,
      }),
    ).rejects.toThrow();
    await expect(
      rawInsertReceipt(persistence, {
        scopeId,
        state: "ready",
        locator: schemaLocator,
        initialEpoch: "epoch_ready_before_reserved",
        readyAt: new Date("2000-01-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow();

    await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );
    await expect(
      persistence.query(`delete from fx_control_scope where id = $1`, [
        scopeId,
      ]),
    ).rejects.toThrow();
  });

  it("fails strict decoding if stored protocol evidence is corrupted", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "decoder_corruption",
      schemaLocator,
    );
    await reserveReceipt(
      persistence,
      scopeId,
      schemaLocator,
      epochA,
    );
    await persistence.query(
      `
        alter table fx_control_scope_provisioning
        drop constraint fx_control_scope_provisioning_protocol_version_check
      `,
    );
    await persistence.query(
      `
        update fx_control_scope_provisioning
        set protocol_version = 'unknown_protocol'
        where scope_id = $1
      `,
      [scopeId],
    );

    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).rejects.toBeInstanceOf(
      ScopeAuthorityProvisioningReceiptCorruptionError,
    );
  });

  it("rejects whitespace-only candidate intent before writing", async () => {
    const persistence = await migratedPersistence();
    const scopeId = await insertSplitScope(
      persistence,
      "invalid_input",
      schemaLocator,
    );

    await expect(
      reserveReceipt(
        persistence,
        scopeId,
        schemaLocator,
        ScopeEpochSchema.make(" "),
      ),
    ).rejects.toBeInstanceOf(
      InvalidScopeAuthorityProvisioningReceiptInputError,
    );
    await expect(
      getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    ).resolves.toBeNull();
  });
});

type TestPersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<TestPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertSplitScope(
  persistence: TestPersistence,
  suffix: string,
  physicalLocator: SplitScopePhysicalLocator,
): Promise<ScopeId> {
  const deploymentId = `deployment_receipt_${suffix}`;
  const scopeId = ScopeIdSchema.make(`scope_receipt_${suffix}`);
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_receipt_${suffix}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator,
  });
  return scopeId;
}

async function reserveReceipt(
  persistence: TestPersistence,
  scopeId: ScopeId,
  physicalLocator: SplitScopePhysicalLocator,
  candidateInitialEpoch: ScopeEpoch,
): Promise<ReserveSplitScopeAuthorityProvisioningReceiptResult> {
  return persistence.drizzle.transaction((tx) =>
    reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
      scopeId,
      physicalLocator,
      candidateInitialEpoch,
    }),
  );
}

function receiptIdentity(
  receipt: SplitScopeAuthorityProvisioningReceiptIdentity,
  initialEpoch: ScopeEpoch = receipt.initialEpoch,
): SplitScopeAuthorityProvisioningReceiptIdentity {
  return {
    scopeId: receipt.scopeId,
    protocolVersion: receipt.protocolVersion,
    physicalLocator: receipt.physicalLocator,
    initialEpoch,
  };
}

async function rawInsertReceipt(
  persistence: Pick<FlarexPersistence, "query">,
  input: {
    readonly scopeId: ScopeId;
    readonly state: string;
    readonly locator: Readonly<Record<string, string>>;
    readonly initialEpoch: string;
    readonly readyAt: Date | null;
  },
): Promise<void> {
  await persistence.query(
    `
      insert into fx_control_scope_provisioning (
        scope_id,
        protocol_version,
        state,
        physical_locator_json,
        initial_epoch,
        ready_at
      ) values ($1, 'split_scope_authority_v1', $2, $3::jsonb, $4, $5)
    `,
    [
      input.scopeId,
      input.state,
      JSON.stringify(input.locator),
      input.initialEpoch,
      input.readyAt,
    ],
  );
}
