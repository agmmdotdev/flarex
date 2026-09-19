import { sql } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
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
  AppUniqueKeyStorageCorruptionError,
  AppUniqueKeyParentRowError,
  AppUniqueKeyPreviousClaimMismatchError,
  CanonicalAppUniqueKeyHashCollisionError,
  applyAppUniqueKeyMutationsInTransactionEffect,
  type ApplyAppUniqueKeyMutationV1Input,
  type AppUniqueKeySha256V1,
  type AppUniqueKeyTransaction,
} from "../src/appUniqueKeys";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
} from "../src/appRows";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { verifyUniqueBatches } from "./uniqueBatchScenario";

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
  it("applies bounded unique sets and rolls back later-batch failures", async () => {
    const persistence = await uniquePersistence();
    await verifyUniqueBatches(persistence, persistence.drizzle, scopeId, epoch);
  }, 60_000);
  it("rejects malformed parents, ownership and returned sets at the driver boundary", async () => {
    const scopeUuid = scopeId.slice("scope_".length);
    const rowId = appRowIdHexV1ToBytes(rowA);
    const key = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result(keyA));
    if (key.kind !== "claim") throw new Error("Expected unique key");
    const validParent = { scopeUuid, tableId, rowId, isTombstone: false };
    const validClaim = { scopeUuid, constraintId, localeKey: "", rowId, tableId,
      encodedKey: key.canonicalKeyBytes, keyCodecVersion: 1, canonicalKeySha256: new Uint8Array(32).fill(7) };
    const cases: readonly { parent: unknown; owners: readonly unknown[]; returned: readonly unknown[]; writes: number }[] = [
      ...[{ ...validParent, tableId: 0 }, { ...validParent, rowId: new Uint8Array(2) }, { ...validParent, isTombstone: "false" }]
        .map(parent => ({ parent, owners: [], returned: [], writes: 0 })),
      ...[{ ...validClaim, constraintId: 0 }, { ...validClaim, canonicalKeySha256: null }, { ...validClaim, scopeUuid: "invalid" }]
        .map(owner => ({ parent: validParent, owners: [owner], returned: [], writes: 0 })),
      ...[[], [validClaim, validClaim], [{ ...validClaim, scopeUuid: "invalid" }],
        [{ ...validClaim, encodedKey: new Uint8Array(2049) }], [{ ...validClaim, rowId: appRowIdHexV1ToBytes(rowB) }],
        [{ ...validClaim, keyCodecVersion: "1" }]]
        .map(returned => ({ parent: validParent, owners: [], returned, writes: 1 })),
    ];
    for (const sample of cases) {
      let writes = 0;
      // Deliberate driver-boundary fault injection; no SQL state is emulated.
      const tx = {
        select() { return { from() { return {
          where() { return {
            limit() { return Promise.resolve([{ scopeUuid, epoch }]); },
            for() { return Promise.resolve(sample.owners); },
          }; },
          innerJoin() { return { where() { return Promise.resolve([sample.parent]); } }; },
        }; } }; },
        insert() { writes += 1; return { values() { return { returning() { return Promise.resolve(sample.returned); } }; } }; },
      } as unknown as AppUniqueKeyTransaction;
      expect(await runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(
        tx, [mutation(scopeId, epoch, rowA, null, keyA)], async () => new Uint8Array(32).fill(7),
      ))).toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
      expect(writes).toBe(sample.writes);
    }
  });
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

  it("decodes a malformed stored slot before comparing canonical bytes", async () => {
    const persistence = await uniquePersistence();
    await appendRow(persistence, await liveRow(scopeId, epoch, rowA, 1n, null, "a"));
    await apply(persistence, mutation(scopeId, epoch, rowA, null, keyA));
    const rollback = new Error("restore deliberately malformed storage");
    await expect(persistence.drizzle.transaction(async tx => {
      await tx.execute(sql`alter table fx_app_unique_key alter column encoded_key drop not null`);
      await tx.execute(sql`update fx_app_unique_key set encoded_key = null`);
      expect(await runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(tx, [mutation(scopeId, epoch, rowA, keyA, keyA)])))
        .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await apply(persistence, mutation(scopeId, epoch, rowA, keyA, keyA))).status).toBe("unchanged");
  });

  it("claims, preserves unchanged owners, rejects overwrite, releases, reuses, and localizes by scope", async () => {
    const persistence = await uniquePersistence();
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 1n, null, "a"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      null,
      keyA,
    ))).status).toBe("claimed");
    const repeatedClaim = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [mutation(scopeId, epoch, rowA, null, keyA)],
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
      keyA,
      keyA,
    ))).status).toBe("unchanged");

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 3n, 2n, "a3"),
    );
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      keyA,
      keyB,
    ))).status).toBe("claimed");
    const contradictoryPrior = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [mutation(scopeId, epoch, rowA, keyA, keyB)],
      ))
    );
    expect(contradictoryPrior).toBeInstanceOf(AppUniqueKeyPreviousClaimMismatchError);

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowB, 4n, null, "b"),
    );
    const conflict = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [mutation(scopeId, epoch, rowB, null, keyB)],
      ))
    );
    expect(conflict).toBeInstanceOf(AppUniqueKeyConflictError);

    await appendRow(persistence, tombstoneRow(scopeId, epoch, rowA, 5n, 3n));
    expect((await apply(persistence, mutation(
      scopeId,
      epoch,
      rowA,
      keyB,
      null,
    ))).status).toBe("released");
    const repeatedRelease = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [mutation(scopeId, epoch, rowA, keyB, null)],
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
      null,
      keyA,
    ))).status).toBe("claimed");

    const rows = await persistence.query<{ scope_id: string; row_id: string }>(`
      select clock.scope_id, encode(claim.row_id, 'hex') as row_id
      from fx_app_unique_key as claim join fx_system_scope_clock as clock on clock.scope_uuid = claim.scope_uuid
      order by clock.scope_id`);
    expect(rows.rows).toEqual([{scope_id: scopeId, row_id: rowB}, {scope_id: otherScopeId, row_id: rowC}]);

    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowD, 7n, null, "english"),
    );
    await apply(persistence, mutation(
      scopeId,
      epoch,
      rowD,
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
      runEffect(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [{ ...mutation(scopeId, epoch, rowA, null, keyA), constraintId: collisionConstraintId }],
        fixedDigest,
      ))
    );
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowB, 2n, null, "b"),
    );
    const collision = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [{ ...mutation(scopeId, epoch, rowB, null, keyB), constraintId: collisionConstraintId }],
        fixedDigest,
      ))
    );
    expect(collision).toBeInstanceOf(CanonicalAppUniqueKeyHashCollisionError);
    const stored = await persistence.query<{ row_id: Uint8Array }>(
      `select row_id from fx_app_unique_key where constraint_id = $1`,
      [collisionConstraintId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(encodeBytesToLowercaseHex(stored.rows[0]!.row_id)).toBe(rowA);
  });

  it("retains stable ownership across body revisions and requires a live current parent", async () => {
    const persistence = await uniquePersistence();
    const missing = await persistence.drizzle.transaction(tx => runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(tx, [mutation(scopeId, epoch, rowA, null, keyA)])));
    expect(missing).toBeInstanceOf(AppUniqueKeyParentRowError);
    expect(missing).toMatchObject({reason: "missing"});
    await appendRow(persistence, await liveRow(scopeId, epoch, rowA, 1n, null, "a"));
    await apply(persistence, mutation(scopeId, epoch, rowA, null, keyA));
    const before = await persistence.query("select *, xmin::text as tuple_version from fx_app_unique_key");
    await appendRow(persistence, await liveRow(scopeId, epoch, rowA, 2n, 1n, "a2"));
    await appendRow(persistence, await liveRow(scopeId, epoch, rowA, 3n, 2n, "a3"));
    expect((await apply(persistence, mutation(scopeId, epoch, rowA, keyA, keyA))).status).toBe("unchanged");
    expect((await persistence.query("select *, xmin::text as tuple_version from fx_app_unique_key")).rows).toEqual(before.rows);
    await expect(persistence.query("delete from fx_app_row_current")).rejects.toMatchObject({code: "23001", constraint: "fx_app_unique_key_row_identity_fk"});
    await appendRow(persistence, tombstoneRow(scopeId, epoch, rowA, 4n, 3n));
    const tombstoned = await persistence.drizzle.transaction(tx => runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(tx, [mutation(scopeId, epoch, rowA, keyA, keyB)])));
    expect(tombstoned).toBeInstanceOf(AppUniqueKeyParentRowError);
    expect(tombstoned).toMatchObject({reason: "tombstonedClaim"});
    expect((await apply(persistence, mutation(scopeId, epoch, rowA, keyA, null))).status).toBe("released");
  });

  it("captures every accessor-backed mutation field once", async () => {
    const persistence = await uniquePersistence();
    await appendRow(
      persistence,
      await liveRow(scopeId, epoch, rowA, 1n, null, "accessor"),
    );
    const reads = {
      previous: 0,
      next: 0,
    };
    const accessorInput: ApplyAppUniqueKeyMutationV1Input = {
      scopeId,
      constraintId,
      tableId,
      rowId: rowA,
      writeEpoch: epoch,
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
      previous: 1,
      next: 1,
    });
  });

  it("keeps row and unique-key publication atomic under caller rollback", async () => {
    const persistence = await uniquePersistence();
    await expect(persistence.drizzle.transaction(async (tx) => {
      await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [await liveRow(scopeId, epoch, rowA, 1n, null, "rollback")]));
      await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(
        tx,
        [mutation(scopeId, epoch, rowA, null, keyA)],
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
    await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [input]));
  });
}

async function apply(
  persistence: PGliteFlarexPersistence,
  input: ApplyAppUniqueKeyMutationV1Input,
) {
  const results = await persistence.drizzle.transaction((tx) =>
    runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [input]))
  );
  expect(results).toHaveLength(1);
  const result = results[0];
  if (result === undefined) throw new Error("Missing unique mutation result");
  return result;
}

function mutation(
  owningScopeId: typeof scopeId,
  writeEpoch: typeof epoch,
  rowId: typeof rowA,
  previous: AppUniqueKeyProjectionV1 | null,
  next: AppUniqueKeyProjectionV1 | null,
): ApplyAppUniqueKeyMutationV1Input {
  return {
    scopeId: owningScopeId,
    constraintId,
    tableId,
    rowId,
    writeEpoch,
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
