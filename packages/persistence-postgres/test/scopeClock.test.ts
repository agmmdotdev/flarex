import { eq } from "drizzle-orm";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type OutboxSeq,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ScopeClockCorruptionError,
  type FlarexPersistence,
  type ScopeClockRecord,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import {
  lockScopeClockForUpdateInTransaction,
  ScopeClockNotFoundError,
} from "../src/scopeClock";
import { fxSystemScopeClocks } from "../src/schema";

type ForbiddenScopeClockMethod = Extract<
  keyof FlarexPersistence,
  | "advanceScopeClock"
  | "allocateCommitSeq"
  | "lockScopeClock"
  | "nextCommitSeq"
  | "setScopeClock"
  | "updateScopeClock"
>;

describe("scope clock", () => {
  it("keeps authority values branded and exposes no production allocator", () => {
    expectTypeOf<ScopeClockRecord["scopeId"]>().toEqualTypeOf<ScopeId>();
    expectTypeOf<ScopeClockRecord["epoch"]>().toEqualTypeOf<ScopeEpoch>();
    expectTypeOf<ScopeClockRecord["storageGeneration"]>()
      .toEqualTypeOf<StorageGeneration>();
    expectTypeOf<ScopeClockRecord["storageGenerationFence"]>()
      .toEqualTypeOf<StorageGenerationFence>();
    expectTypeOf<ScopeClockRecord["lastCommitSeq"]>()
      .toEqualTypeOf<CommitSeq>();
    expectTypeOf<ScopeClockRecord["lastOutboxSeq"]>()
      .toEqualTypeOf<OutboxSeq>();
    expectTypeOf<ForbiddenScopeClockMethod>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof lockScopeClockForUpdateInTransaction>[0]
      >();
  });

  it("reads independent scope clocks with exact bigint values", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const emptyScopeId = ScopeIdSchema.make("scope_clock_empty");
    const largeScopeId = ScopeIdSchema.make("scope_clock_large");

    await insertDefaultScopeClock(persistence, {
      scopeId: emptyScopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-empty"),
    });
    await insertScopeClockFixture(persistence, {
      scopeId: largeScopeId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(
        9_007_199_254_740_993n,
      ),
      lastCommitSeq: CommitSeqSchema.make(9_007_199_254_740_993n),
      lastOutboxSeq: OutboxSeqSchema.make(9_007_199_254_740_994n),
      epoch: ScopeEpochSchema.make("epoch-large"),
      updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });

    await expect(persistence.getScopeClock(emptyScopeId)).resolves.toMatchObject({
      scopeId: emptyScopeId,
      storageGeneration: "legacy_v1",
      storageGenerationFence: 1n,
      lastCommitSeq: 0n,
      lastOutboxSeq: 0n,
      epoch: "epoch-empty",
    });
    const largeClock = await persistence.getScopeClock(largeScopeId);
    expect(largeClock).toEqual({
      scopeId: largeScopeId,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9_007_199_254_740_993n,
      lastCommitSeq: 9_007_199_254_740_993n,
      lastOutboxSeq: 9_007_199_254_740_994n,
      epoch: "epoch-large",
      updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(largeClock?.updatedAt).toBeInstanceOf(Date);
    await expect(
      persistence.getScopeClock(ScopeIdSchema.make("scope_clock_missing")),
    ).resolves.toBeNull();
  });

  it("requires explicit generation and enforces clock constraints", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.query(
        `insert into fx_system_scope_clock (scope_id, epoch) values ($1, $2)`,
        ["scope_missing_generation", "epoch-a"],
      ),
    ).rejects.toThrow();

    const invalidRows = [
      {
        suffix: "scope",
        scopeId: "\t\n",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "generation",
        scopeId: "scope_invalid_generation",
        storageGeneration: "unknown_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "fence",
        scopeId: "scope_invalid_fence",
        storageGeneration: "legacy_v1",
        fence: "0",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "commit",
        scopeId: "scope_invalid_commit",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "-1",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "outbox",
        scopeId: "scope_invalid_outbox",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "-1",
        epoch: "epoch-a",
      },
      {
        suffix: "epoch",
        scopeId: "scope_invalid_epoch",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "\u00a0\ufeff",
      },
    ] as const;

    for (const row of invalidRows) {
      await expect(
        persistence.query(
          `
            insert into fx_system_scope_clock (
              scope_id,
              storage_generation,
              storage_generation_fence,
              last_commit_seq,
              last_outbox_seq,
              epoch
            ) values ($1, $2, $3, $4, $5, $6)
          `,
          [
            row.scopeId,
            row.storageGeneration,
            row.fence,
            row.commitSeq,
            row.outboxSeq,
            row.epoch,
          ],
        ),
      ).rejects.toThrow();
    }

    const scopeId = ScopeIdSchema.make("scope_clock_unique");
    await insertDefaultScopeClock(persistence, {
      scopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-unique"),
    });
    await expect(
      insertDefaultScopeClock(persistence, {
        scopeId,
        storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
        epoch: ScopeEpochSchema.make("epoch-duplicate"),
      }),
    ).rejects.toThrow();
  });

  it("fails closed when persisted authority is corrupt", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.exec(`
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_storage_generation_check,
        drop constraint fx_system_scope_clock_storage_generation_fence_positive_check,
        drop constraint fx_system_scope_clock_last_commit_seq_non_negative_check,
        drop constraint fx_system_scope_clock_last_outbox_seq_non_negative_check,
        drop constraint fx_system_scope_clock_epoch_non_empty_check
    `);

    const corruptRows = [
      {
        suffix: "generation",
        storageGeneration: "unknown_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "fence",
        storageGeneration: "legacy_v1",
        fence: "0",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "commit",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "-1",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "outbox",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "-1",
        epoch: "epoch-a",
      },
      {
        suffix: "epoch",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "\t\n",
      },
    ] as const;

    for (const row of corruptRows) {
      const scopeId = ScopeIdSchema.make(`scope_corrupt_clock_${row.suffix}`);
      await persistence.query(
        `
          insert into fx_system_scope_clock (
            scope_id,
            storage_generation,
            storage_generation_fence,
            last_commit_seq,
            last_outbox_seq,
            epoch
          ) values ($1, $2, $3, $4, $5, $6)
        `,
        [
          scopeId,
          row.storageGeneration,
          row.fence,
          row.commitSeq,
          row.outboxSeq,
          row.epoch,
        ],
      );
      await expect(persistence.getScopeClock(scopeId)).rejects.toMatchObject({
        name: "ScopeClockCorruptionError",
        scopeId,
      });
      await expect(persistence.getScopeClock(scopeId)).rejects.toBeInstanceOf(
        ScopeClockCorruptionError,
      );
    }
  });

  it("locks only inside a transaction and rolls test mutations back", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_clock_rollback");
    await insertDefaultScopeClock(persistence, {
      scopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-before"),
    });
    const before = await persistence.getScopeClock(scopeId);

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const locked = await lockScopeClockForUpdateInTransaction(tx, scopeId);
        expect(locked).toEqual(before);
        await tx
          .update(fxSystemScopeClocks)
          .set({
            storageGeneration:
              FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
            storageGenerationFence: StorageGenerationFenceSchema.make(2n),
            lastCommitSeq: CommitSeqSchema.make(1n),
            lastOutboxSeq: OutboxSeqSchema.make(1n),
            epoch: ScopeEpochSchema.make("epoch-after"),
            updatedAt: new Date("2026-07-11T00:00:00.000Z"),
          })
          .where(eq(fxSystemScopeClocks.scopeId, scopeId));
        throw new Error("scope-clock-rollback-probe");
      }),
    ).rejects.toThrow("scope-clock-rollback-probe");

    await expect(persistence.getScopeClock(scopeId)).resolves.toEqual(before);
    await expect(
      persistence.drizzle.transaction((tx) =>
        lockScopeClockForUpdateInTransaction(
          tx,
          ScopeIdSchema.make("scope_clock_missing"),
        ),
      ),
    ).rejects.toBeInstanceOf(ScopeClockNotFoundError);
  });
});

interface DefaultScopeClockFixture {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly epoch: ScopeEpoch;
}

async function insertDefaultScopeClock(
  persistence: Pick<FlarexPersistence, "query">,
  input: DefaultScopeClockFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        epoch
      ) values ($1, $2, $3)
    `,
    [input.scopeId, input.storageGeneration, input.epoch],
  );
}

interface ScopeClockFixture extends DefaultScopeClockFixture {
  readonly storageGenerationFence: StorageGenerationFence;
  readonly lastCommitSeq: CommitSeq;
  readonly lastOutboxSeq: OutboxSeq;
  readonly updatedAt: Date;
}

async function insertScopeClockFixture(
  persistence: Pick<FlarexPersistence, "query">,
  input: ScopeClockFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        storage_generation_fence,
        last_commit_seq,
        last_outbox_seq,
        epoch,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
    `,
    [
      input.scopeId,
      input.storageGeneration,
      input.storageGenerationFence.toString(),
      input.lastCommitSeq.toString(),
      input.lastOutboxSeq.toString(),
      input.epoch,
      input.updatedAt.toISOString(),
    ],
  );
}
