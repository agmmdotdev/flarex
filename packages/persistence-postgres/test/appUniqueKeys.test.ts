import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  orderedIndexValueFromFlarexValueV1,
  type OrderedIndexComponentV1,
} from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeAppUniqueKeyV1Result,
  decodeAppUniqueConstraintIdV1Result,
  type AppUniqueKeyProjectionV1,
} from "../src/appUniqueKeyContract";
import {
  AppUniqueKeyConflictError,
  AppUniqueKeyParentRevisionError,
  AppUniqueKeyPreviousClaimMismatchError,
  CanonicalAppUniqueKeyHashCollisionError,
  applyAppUniqueKeyMutationInTransactionEffect,
  type ApplyAppUniqueKeyMutationV1Input,
  type AppUniqueKeySha256V1,
} from "../src/appUniqueKeys";
import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
  type AppendPreparedAppRowRevisionV1Input,
} from "../src/appRows";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const scopeId = ScopeIdSchema.make(
  "scope_54000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_54000000-0000-0000-0000-000000000099",
);
const epoch = ScopeEpochSchema.make(
  "epoch_54000000-0000-0000-0000-000000000002",
);
const otherEpoch = ScopeEpochSchema.make(
  "epoch_54000000-0000-0000-0000-000000000098",
);
const tableId = decodeCatalogTableId(1);
const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(1));
const collisionConstraintId = Result.getOrThrow(
  decodeAppUniqueConstraintIdV1Result(2),
);
const schemaVersionId = decodeCatalogSchemaVersionId("schema_unique_rows_v1");
const creationTime = decodeAppCreationTimeV1(1_725_000_000_300.75);
const rowA = decodeAppRowIdHexV1("5400000000000000000000000000000a");
const rowB = decodeAppRowIdHexV1("5400000000000000000000000000000b");
const rowC = decodeAppRowIdHexV1("5400000000000000000000000000000c");
const rowD = decodeAppRowIdHexV1("5400000000000000000000000000000d");
const rowE = decodeAppRowIdHexV1("5400000000000000000000000000000e");
const rowF = decodeAppRowIdHexV1("5400000000000000000000000000000f");
const keyA = projection("alpha");
const keyB = projection("beta");

describe("S11 app unique-key storage", () => {
  it("freezes sparse, missing, null, and localized canonical semantics", () => {
    const sparseMissing = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result({
      sparse: true,
      localeKey: null,
      values: [missing()],
    }));
    expect(sparseMissing).toEqual({
      kind: "omitted",
      reason: "sparseMissing",
      localeKey: "",
    });

    const missingClaim = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result({
      sparse: false,
      localeKey: null,
      values: [missing()],
    }));
    const nullClaim = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result({
      sparse: true,
      localeKey: null,
      values: [orderedIndexValueFromFlarexValueV1(null)],
    }));
    expect(missingClaim.kind).toBe("claim");
    expect(nullClaim.kind).toBe("claim");
    if (missingClaim.kind === "claim" && nullClaim.kind === "claim") {
      expect(missingClaim.encodedKey).not.toBe(nullClaim.encodedKey);
    }

    const english = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result(
      projection("alpha", "en"),
    ));
    const french = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result(
      projection("alpha", "fr"),
    ));
    expect(english.kind).toBe("claim");
    expect(french.kind).toBe("claim");
    if (english.kind === "claim" && french.kind === "claim") {
      expect(english.encodedKey).not.toBe(french.encodedKey);
    }
    expect(Result.isFailure(canonicalizeAppUniqueKeyV1Result(
      projection("alpha", "EN"),
    ))).toBe(true);

    let sparseReads = 0;
    const accessorBacked = {
      get sparse() {
        sparseReads += 1;
        return sparseReads === 1;
      },
      localeKey: null,
      values: [missing()],
    };
    expect(Result.getOrThrow(canonicalizeAppUniqueKeyV1Result(accessorBacked)))
      .toMatchObject({ kind: "omitted", reason: "sparseMissing" });
    expect(sparseReads).toBe(1);
  });

  it("claims, advances, rejects overwrite, releases, reuses, and localizes by scope", async () => {
    const persistence = await uniquePersistence();
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 1n, null, "a"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      1n,
      null,
      null,
      keyA,
    ))).status).toBe("claimed");
    const repeatedClaim = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        mutation(scopeId, epoch, rowA, 1n, null, null, keyA),
      ))
    );
    expect(repeatedClaim).toBeInstanceOf(AppUniqueKeyConflictError);

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 2n, 1n, "a2"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      2n,
      1n,
      keyA,
      keyA,
    ))).status).toBe("advanced");

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 3n, 2n, "a3"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      3n,
      2n,
      keyA,
      keyB,
    ))).status).toBe("advanced");
    const contradictoryPrior = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        mutation(scopeId, epoch, rowA, 3n, 2n, keyB, keyB),
      ))
    );
    expect(contradictoryPrior).toBeInstanceOf(AppUniqueKeyConflictError);

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowB, 4n, null, "b"),
    );
    const conflict = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        mutation(scopeId, epoch, rowB, 4n, null, null, keyB),
      ))
    );
    expect(conflict).toBeInstanceOf(AppUniqueKeyConflictError);

    await appendRow(persistence, tombstoneRow(scopeId, epoch, rowA, 5n, 3n));
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      5n,
      3n,
      keyB,
      null,
    ))).status).toBe("released");
    const repeatedRelease = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        mutation(scopeId, epoch, rowA, 5n, 3n, keyB, null),
      ))
    );
    expect(repeatedRelease).toBeInstanceOf(
      AppUniqueKeyPreviousClaimMismatchError,
    );

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowB, 6n, 4n, "b2"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowB,
      6n,
      4n,
      null,
      keyB,
    ))).status).toBe("claimed");

    await appendRow(
      persistence,
      await liveRow(otherScopeId, otherEpoch, rowC, 1n, null, "other"),
    );
    expect((await apply(persistence, mutation(
      otherScopeId,
      otherEpoch,
      rowC,
      1n,
      null,
      null,
      keyA,
    ))).status).toBe("claimed");

    const rows = await persistence.query<{
      scope_id: string;
      schema_version_id: string;
      commit_seq: string;
    }>(`
      select clock.scope_id, claim.schema_version_id,
             claim.commit_seq::text as commit_seq
      from fx_app_unique_key as claim
      join fx_system_scope_clock as clock
        on clock.scope_uuid = claim.scope_uuid
      order by clock.scope_id
    `);
    expect(rows.rows).toEqual([
      { scope_id: scopeId, schema_version_id: schemaVersionId, commit_seq: "6" },
      { scope_id: otherScopeId, schema_version_id: schemaVersionId, commit_seq: "1" },
    ]);

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowD, 7n, null, "english"),
    );
    await apply(persistence, mutation(
      scopeId,
      epoch,
      rowD,
      7n,
      null,
      null,
      projection("localized", "en"),
    ));
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowE, 8n, null, "french"),
    );
    await apply(persistence, mutation(
      scopeId,
      epoch,
      rowE,
      8n,
      null,
      null,
      projection("localized", "fr"),
    ));
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowF, 9n, null, "sparse"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowF,
      9n,
      null,
      null,
      { sparse: true, localeKey: null, values: [missing()] },
    ))).status).toBe("omitted");
    const locales = await persistence.query<{ locale_key: string }>(`
      select locale_key
      from fx_app_unique_key
      where locale_key <> ''
      order by locale_key
    `);
    expect(locales.rows).toEqual([
      { locale_key: "en" },
      { locale_key: "fr" },
    ]);
  });

  it("detects equal-digest unequal-key collisions without overwriting", async () => {
    const persistence = await uniquePersistence();
    const fixedDigest: AppUniqueKeySha256V1 = async () => new Uint8Array(32).fill(7);
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 1n, null, "a"),
    );
    await persistence.drizzle.transaction((tx) =>
      runEffect(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        { ...mutation(scopeId, epoch, rowA, 1n, null, null, keyA), constraintId: collisionConstraintId },
        fixedDigest,
      ))
    );
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowB, 2n, null, "b"),
    );
    const collision = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        { ...mutation(scopeId, epoch, rowB, 2n, null, null, keyB), constraintId: collisionConstraintId },
        fixedDigest,
      ))
    );
    expect(collision).toBeInstanceOf(CanonicalAppUniqueKeyHashCollisionError);
    const stored = await persistence.query<{ row_id: Uint8Array }>(
      `select row_id from fx_app_unique_key where constraint_id = $1`,
      [collisionConstraintId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(Buffer.from(stored.rows[0]!.row_id).toString("hex")).toBe(rowA);
  });

  it("rejects a unique mutation that skips authoritative row lineage", async () => {
    const persistence = await uniquePersistence();
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 1n, null, "a"),
    );
    await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      1n,
      null,
      null,
      keyA,
    ));
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 2n, 1n, "a2"),
    );
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 3n, 2n, "a3"),
    );
    const skipped = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        mutation(scopeId, epoch, rowA, 3n, 1n, keyA, keyB),
      ))
    );
    expect(skipped).toBeInstanceOf(AppUniqueKeyParentRevisionError);
    expect(skipped).toMatchObject({ reason: "lineageMismatch" });
  });

  it("captures every accessor-backed mutation field once", async () => {
    const persistence = await uniquePersistence();
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 1n, null, "accessor"),
    );
    const reads = {
      rowPrevCommitSeq: 0,
      previousClaimCommitSeq: 0,
      previous: 0,
      next: 0,
    };
    const accessorInput: ApplyAppUniqueKeyMutationV1Input = {
      scopeId,
      constraintId,
      tableId,
      rowId: rowA,
      writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(1n),
      get rowPrevCommitSeq() {
        reads.rowPrevCommitSeq += 1;
        return reads.rowPrevCommitSeq === 1
          ? null
          : CommitSeqSchema.make(99n);
      },
      get previousClaimCommitSeq() {
        reads.previousClaimCommitSeq += 1;
        return reads.previousClaimCommitSeq === 1
          ? null
          : CommitSeqSchema.make(99n);
      },
      get previous() {
        reads.previous += 1;
        return reads.previous === 1 ? null : keyB;
      },
      get next() {
        reads.next += 1;
        return reads.next === 1 ? keyA : null;
      },
    };
    expect((await apply(persistence, accessorInput)).status).toBe("claimed");
    expect(reads).toEqual({
      rowPrevCommitSeq: 1,
      previousClaimCommitSeq: 1,
      previous: 1,
      next: 1,
    });
  });

  it("keeps row and unique-key publication atomic under caller rollback", async () => {
    const persistence = await uniquePersistence();
    await expect(persistence.drizzle.transaction(async (tx) => {
      Result.getOrThrow(
        await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
          tx,
          await liveRow(scopeId, epoch, rowA, 1n, null, "rollback"),
        ),
      );
      await runEffect(applyAppUniqueKeyMutationInTransactionEffect(
        tx,
        mutation(scopeId, epoch, rowA, 1n, null, null, keyA),
      ));
      throw new Error("injected S11 rollback");
    })).rejects.toThrow("injected S11 rollback");
    const counts = await persistence.query<{ rows_count: string; keys_count: string }>(`
      select
        (select count(*)::text from fx_app_row_rev) as rows_count,
        (select count(*)::text from fx_app_unique_key) as keys_count
    `);
    expect(counts.rows).toEqual([{ rows_count: "0", keys_count: "0" }]);
  });
});

async function uniquePersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, last_commit_seq, epoch)
     values ($1, 'flarexdb_v1', 100, $2),
            ($3, 'flarexdb_v1', 100, $4)`,
    [scopeId, epoch, otherScopeId, otherEpoch],
  );
  return persistence;
}

async function appendRow(
  persistence: PGliteFlarexPersistence,
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<void> {
  await persistence.drizzle.transaction(async (tx) => {
    Result.getOrThrow(
      await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        input,
      ),
    );
  });
}

async function apply(
  persistence: PGliteFlarexPersistence,
  input: ApplyAppUniqueKeyMutationV1Input,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(applyAppUniqueKeyMutationInTransactionEffect(tx, input))
  );
}

function mutation(
  owningScopeId: typeof scopeId,
  writeEpoch: typeof epoch,
  rowId: typeof rowA,
  commitSeq: bigint,
  rowPrevCommitSeq: bigint | null,
  previous: AppUniqueKeyProjectionV1 | null,
  next: AppUniqueKeyProjectionV1 | null,
): ApplyAppUniqueKeyMutationV1Input {
  return {
    scopeId: owningScopeId,
    constraintId,
    tableId,
    rowId,
    writeEpoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    rowPrevCommitSeq: rowPrevCommitSeq === null
      ? null
      : CommitSeqSchema.make(rowPrevCommitSeq),
    previousClaimCommitSeq: previous === null
      ? null
      : CommitSeqSchema.make(rowPrevCommitSeq!),
    previous,
    next,
  };
}

function liveRow(
  owningScopeId: typeof scopeId,
  writeEpoch: typeof epoch,
  rowId: typeof rowA,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  title: string,
): Promise<AppendPreparedAppRowRevisionV1Input> {
  return canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { title },
  }).then((document) => ({
    kind: "live" as const,
    scopeId: owningScopeId,
    tableId,
    rowId,
    writeEpoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    prevCommitSeq: prevCommitSeq === null
      ? null
      : CommitSeqSchema.make(prevCommitSeq),
    schemaVersionId,
    creationTime,
    document,
  }));
}

function tombstoneRow(
  owningScopeId: typeof scopeId,
  writeEpoch: typeof epoch,
  rowId: typeof rowA,
  commitSeq: bigint,
  prevCommitSeq: bigint,
): AppendPreparedAppRowRevisionV1Input {
  return {
    kind: "tombstone",
    scopeId: owningScopeId,
    tableId,
    rowId,
    writeEpoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    prevCommitSeq: CommitSeqSchema.make(prevCommitSeq),
    schemaVersionId,
    creationTime,
  };
}

function projection(value: string, localeKey: string | null = null): AppUniqueKeyProjectionV1 {
  return Object.freeze({
    sparse: true,
    localeKey,
    values: Object.freeze([orderedIndexValueFromFlarexValueV1(value)]),
  });
}

function missing(): OrderedIndexComponentV1 {
  return Object.freeze({ kind: "missing" });
}
