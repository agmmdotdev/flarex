import { runEffect } from "./effectTestRuntime";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { PoolClient } from "pg";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  ScopeIdSchema,
  ScopeEpochSchema,
  CommitSeqSchema,
  projectScopeIdUuidV1,
  projectScopeEpochUuidV1,
  FlarexDbV1StorageGenerationSchema,
} from "flarex-protocol/storage-authority";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  AppRowRevisionAlreadyExistsError,
  AppRowRevisionChainConflictError,
  AppRowStorageCorruptionError,
  AppRowScopeAuthorityUnavailableError,
  type AppendPreparedLiveAppRowRevisionV1Input,
} from "../src/appRows";
import { createPostgresLocatedReadCommittedTransactionRunnerV1 } from "../src/postgresLocatedReadCommitted";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { fxSystemScopeClocks } from "../src/schema";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { insertCe0ReferenceRows } from "./ce0RowInsertReference";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import { readCe0Environment } from "./ce0Environment";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPersistence = useFileScopedPostgresPersistence();
type Candidate = "core" | "reference";
type Insert = AppendPreparedLiveAppRowRevisionV1Input & {
  readonly prevCommitSeq: null;
};
const decodeBlockingRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ blocked: Schema.Boolean })),
);
const decodeBackendPidRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ pid: Schema.Int })),
);
const decodeRowState = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      table_id: Schema.Int,
      row_id: Schema.String,
      commit_seq: Schema.String,
      prev_commit_seq: Schema.NullOr(Schema.String),
      write_epoch_uuid: Schema.String,
      schema_version_id: Schema.String,
      creation_time: Schema.Number,
      value_codec_version: Schema.Int,
      is_tombstone: Schema.Boolean,
      value_bytes: Schema.String,
      value_sha256: Schema.String,
      current_commit_seq: Schema.NullOr(Schema.String),
    }),
  ),
);

describePostgres("CE0 same-layout first-row insertion reference", () => {
  it("matches scope refusal, first-identity conflicts, rollback and concurrent insertion before timing", async () => {
    await withPersistence(async (persistence) => {
      for (const candidate of ["core", "reference"] as const) {
        const input = await prepareRows(persistence, 2);
        const first = input[0];
        if (first === undefined)
          throw new Error("Missing reference fixture row.");
        const inserted = await runCandidate(persistence, candidate, [first]);
        expect(inserted[0]).toMatchObject({
          kind: "live",
          commitSeq: 1n,
          prevCommitSeq: null,
          document: first.document,
        });
        const before = await rowState(persistence, first.scopeId);
        for (const commitSeq of [1n, 2n]) {
          await expect(
            runCandidate(persistence, candidate, [
              { ...first, commitSeq: CommitSeqSchema.make(commitSeq) },
            ]),
          ).rejects.toMatchObject({
            issue: {
              kind: "callbackRolledBack",
              callbackCause: expect.any(AppRowRevisionAlreadyExistsError),
            },
          });
          expect(await rowState(persistence, first.scopeId)).toEqual(before);
        }
        await expect(
          runCandidate(persistence, candidate, [
            { ...first, scopeId: ScopeIdSchema.make(`scope_${randomUUID()}`) },
          ]),
        ).rejects.toMatchObject({
          issue: {
            kind: "callbackRolledBack",
            callbackCause: expect.any(AppRowScopeAuthorityUnavailableError),
          },
        });
        for (const [badRows, reason] of [
          [[first, first], "duplicateIdentity"],
          [[first, { ...first, commitSeq: CommitSeqSchema.make(2n) }], "mixedPublication"],
        ] as const) {
          await expect(runCandidate(persistence, candidate, badRows)).rejects.toMatchObject({
            issue: { kind: "callbackRolledBack", callbackCause: { reason } },
          });
          expect(await rowState(persistence, first.scopeId)).toEqual(before);
        }
        const rollbackRows = await prepareRows(persistence, 2);
        const failure = new Error("CE0 late row-store failure");
        await expect(
          runCandidate(persistence, candidate, rollbackRows, failure),
        ).rejects.toMatchObject({
          issue: { kind: "callbackRolledBack", callbackCause: failure },
        });
        const rollbackRow = rollbackRows[0];
        if (rollbackRow === undefined) throw new Error("Missing rollback row.");
        expect(await rowState(persistence, rollbackRow.scopeId)).toEqual([]);
        const concurrent = await prepareRows(persistence, 1);
        const row = concurrent[0];
        if (row === undefined) throw new Error("Missing concurrent row.");
        let firstPid: number | undefined;
        let secondPid: number | undefined;
        let releaseFirst: () => void = () => {
          throw new Error("Missing concurrent insertion release.");
        };
        const held = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        // Attach settlement handlers immediately, including on failed setup.
        const firstSettled = Promise.allSettled([
          runCandidate(persistence, candidate, [row], undefined, {
            afterRows: async (client) => {
              firstPid = await backendPid(client);
              await held;
            },
          }),
        ]);
        let secondSettled: typeof firstSettled | undefined;
        try {
          await expect.poll(() => firstPid, { timeout: 5_000 }).toBeDefined();
          secondSettled = Promise.allSettled([
            runCandidate(
              persistence,
              candidate,
              [{ ...row, commitSeq: CommitSeqSchema.make(2n) }],
              undefined,
              {
                beforeRows: async (client) => {
                  secondPid = await backendPid(client);
                },
              },
            ),
          ]);
          await expect.poll(async () => {
            if (secondPid === undefined) return false;
            const result = await persistence.query(
              "select $1::int = any(pg_blocking_pids($2::int)) as blocked",
              [firstPid, secondPid],
            );
            return decodeBlockingRows(result.rows)[0]?.blocked;
          }, { timeout: 5_000 }).toBe(true);
          expect(secondPid).not.toBe(firstPid);
        } finally {
          releaseFirst();
          await firstSettled;
          await secondSettled;
        }
        if (secondSettled === undefined)
          throw new Error("Second concurrent insertion was not started.");
        const results = [...await firstSettled, ...await secondSettled];
        expect(results[0]?.status).toBe("fulfilled");
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(
          rejected?.status === "rejected" ? rejected.reason : undefined,
        ).toMatchObject({
          issue: {
            kind: "callbackRolledBack",
            callbackCause: expect.any(AppRowRevisionAlreadyExistsError),
          },
        });
        const concurrentState = await rowState(persistence, row.scopeId);
        expect(concurrentState).toHaveLength(1);
        expect(concurrentState[0]).toMatchObject({
          commit_seq: "1",
          current_commit_seq: "1",
        });
      }
    });
  }, 120_000);

  it("matches row and byte batch boundaries with complete state and statement scaling", async () => {
    await withPersistence(async persistence => {
      for (const [count, padding, batches] of [[0, 0, 0], [1, 0, 1], [31, 0, 1], [32, 0, 1],
        [33, 0, 2], [64, 0, 2], [65, 0, 3], [3, 100_000, 2], [2, 300_000, 2]] as const) {
        let expected: Awaited<ReturnType<typeof rowState>> | undefined;
        for (const candidate of ["core", "reference"] as const) {
          const rows = await prepareRows(persistence, count, padding);
          const measured = await withPostgresExecutionObservation(persistence.pool, () => runCandidate(persistence, candidate, rows));
          expect(measured.value).toEqual(rows.map(({ writeEpoch, ...row }) => ({ ...row,
            scopeUuid: projectScopeIdUuidV1(row.scopeId).scopeUuid,
            writeEpochUuid: projectScopeEpochUuidV1(writeEpoch).epochUuid,
          })));
          for (const family of ["fx_app_row_rev", "fx_app_row_current"])
            expect(measured.observation.familyCommands[family]?.insert ?? 0).toBe(batches);
          expect(measured.observation.familyCommands.fx_system_scope_clock?.select ?? 0).toBe(count === 0 ? 0 : 1);
          if (rows[0] !== undefined) {
            const state = await rowState(persistence, rows[0].scopeId);
            expect(state).toHaveLength(count);
            if (expected === undefined) expected = state;
            else expect(state).toEqual(expected);
          }
        }
      }
    });
  }, 120_000);

  it("rolls back earlier batches when a later first identity already exists", async () => {
    await withPersistence(async persistence => {
      for (const candidate of ["core", "reference"] as const) {
        const rows = await prepareRows(persistence, 65);
        const last = rows.at(-1);
        if (last === undefined) throw new Error("Missing last batch identity");
        await runCandidate(persistence, candidate, [last]);
        const before = await rowState(persistence, last.scopeId);
        await expect(runCandidate(persistence, candidate, rows)).rejects.toMatchObject({
          issue: { kind: "callbackRolledBack", callbackCause: expect.any(AppRowRevisionAlreadyExistsError) },
        });
        expect(await rowState(persistence, last.scopeId)).toEqual(before);
      }
    });
  }, 120_000);

  it("refuses suppressed or altered RETURNING identities and rolls back every batch", async () => {
    await withPersistence(async persistence => {
      for (const candidate of ["core", "reference"] as const) {
        for (const [table, action] of [["fx_app_row_rev", "suppress"], ["fx_app_row_rev", "alter"], ["fx_app_row_current", "suppress"]] as const) {
          const rows = await prepareRows(persistence, 33);
          const first = rows[0];
          if (first === undefined) throw new Error("Missing trigger fixture row");
          // Trusted constant SQL, local to this fixture's private search_path.
          await persistence.query(`create function ce0_reference_fault() returns trigger language plpgsql as $$
            begin
              if encode(new.row_id, 'hex') = '00000000000000000000000000000021' then
                ${action === "suppress" ? "return null;" : "new.row_id := decode('ffffffffffffffffffffffffffffffff', 'hex');"}
              end if;
              return new;
            end $$`);
          await persistence.query(`create trigger ce0_reference_fault before insert on ${table} for each row execute function ce0_reference_fault()`);
          try {
            const callbackCause = table === "fx_app_row_rev"
              ? action === "suppress" ? expect.any(AppRowRevisionAlreadyExistsError)
                : candidate === "core" ? expect.any(AppRowStorageCorruptionError)
                : { message: "Unexpected or duplicate CE0 revision RETURNING identity" }
              : candidate === "core" ? expect.any(AppRowRevisionChainConflictError)
                : { message: "Incomplete CE0 pointer writes; transaction must roll back" };
            const observed = await withPostgresExecutionObservation(persistence.pool, async () => {
              await expect(runCandidate(persistence, candidate, rows)).rejects.toMatchObject({
                issue: { kind: "callbackRolledBack", callbackCause },
              });
            });
            expect(observed.observation.familyCommands.fx_app_row_current?.insert).toBe(table === "fx_app_row_rev" ? 1 : 2);
            expect(await rowState(persistence, first.scopeId)).toEqual([]);
          } finally {
            await persistence.query(`drop trigger ce0_reference_fault on ${table}`);
            await persistence.query("drop function ce0_reference_fault()");
          }
        }
      }
    });
  }, 120_000);

  it("compares identical row histories and pointers with the same physical transaction owner", async () => {
    await withPersistence(async (persistence) => {
      const environment = await readCe0Environment(persistence, [
        "./ce0RowInsertReference.postgres.test.ts",
        "./ce0RowInsertReference.ts",
      ]);
      const samples = [];
      for (const rowCount of [1, 8, 32, 128]) {
        for (let pair = -1; pair < 5; pair += 1) {
          let expectedState: Awaited<ReturnType<typeof rowState>> | undefined;
          for (const candidate of (pair % 2 === 0
            ? ["core", "reference"]
            : ["reference", "core"]) as readonly Candidate[]) {
            const rows = await prepareRows(persistence, rowCount);
            const started = performance.now();
            const measured = await withPostgresExecutionObservation(
              persistence.pool,
              () => runCandidate(persistence, candidate, rows),
            );
            const elapsedMilliseconds = performance.now() - started;
            expect(
              measured.value.map((row) => {
                if (row.kind !== "live")
                  throw new Error("Unexpected tombstone from insert.");
                return row.document;
              }),
            ).toEqual(rows.map((row) => row.document));
            const first = rows[0];
            if (first === undefined) throw new Error("Missing measured row.");
            const state = await rowState(persistence, first.scopeId);
            expect(state).toHaveLength(rowCount);
            expect(
              state.every(
                (row) =>
                  row.current_commit_seq === row.commit_seq &&
                  row.prev_commit_seq === null &&
                  !row.is_tombstone,
              ),
            ).toBe(true);
            if (expectedState === undefined) expectedState = state;
            else expect(state).toEqual(expectedState);
            expect(measured.observation.commands.begin).toBe(1);
            expect(measured.observation.commands.commit).toBe(1);
            if (pair >= 0)
              samples.push({
                rowCount,
                pair,
                candidate,
                elapsedMilliseconds,
                observation: measured.observation,
              });
          }
        }
      }
      const report = {
        ...environment,
        workload:
          "prepared first live row revisions only; same generic tables and physical runner; excludes admission, earlier-read OCC, indexes, publication, replay and hosted execution",
        comparison:
          "bounded batch core versus bounded batch explicit SQL reference; both candidates instrumented; driver/validation/SQL construction differ; no full-request overhead ratio",
        warmupPairs: 1,
        measuredPairs: 5,
        samples,
      };
      if (process.env.FLAREX_CE0_ROW_REFERENCE_REPORT_PATH !== undefined)
        await writeFile(
          process.env.FLAREX_CE0_ROW_REFERENCE_REPORT_PATH,
          JSON.stringify(report, null, 2) + "\n",
        );
      console.info("CE0 row-store reference", JSON.stringify(report));
    });
  }, 480_000);
});

async function prepareRows(
  persistence: PostgresFlarexPersistence,
  rowCount: number,
  padding = 0,
): Promise<readonly Insert[]> {
  const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
  const epoch = ScopeEpochSchema.make(
    "epoch_97460000-0000-4000-8000-000000000001",
  );
  await persistence.drizzle
    .insert(fxSystemScopeClocks)
    .values({
      scopeId,
      epoch,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      lastCommitSeq: CommitSeqSchema.make(128n),
    });
  const rows: Insert[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const tableId = decodeCatalogTableId(1);
    const rowId = decodeAppRowIdHexV1(
      (index + 1).toString(16).padStart(32, "0"),
    );
    const creationTime = decodeAppCreationTimeV1(1_725_000_000_000.5);
    rows.push({
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId: decodeCatalogSchemaVersionId("ce0_row_reference"),
      creationTime,
      document: await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: {
          title: `row_${index}`,
          ...(padding === 0 ? {} : { padding: "x".repeat(padding) }),
          count: 9_007_199_254_740_993n,
          bytes: new Uint8Array([0, 127, 255]).buffer,
        },
      }),
    });
  }
  return rows;
}

function runCandidate(
  persistence: PostgresFlarexPersistence,
  candidate: Candidate,
  rows: readonly Insert[],
  lateFailure?: Error,
  hooks?: {
    readonly beforeRows?: (client: PoolClient) => Promise<void>;
    readonly afterRows?: (client: PoolClient) => Promise<void>;
  },
) {
  let acquired: PoolClient | undefined;
  const run = createPostgresLocatedReadCommittedTransactionRunnerV1(
    persistence.pool,
    {
      afterAcquire: (client) => {
        acquired = client;
      },
    },
  );
  return run(async (tx) => {
    if (acquired === undefined)
      throw new Error("Missing row-reference connection.");
    if (hooks?.beforeRows !== undefined) await hooks.beforeRows(acquired);
    const output = candidate === "core"
      ? [...await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows))]
      : await insertCe0ReferenceRows(acquired, rows);
    if (lateFailure !== undefined) throw lateFailure;
    if (hooks?.afterRows !== undefined) await hooks.afterRows(acquired);
    return output;
  });
}

async function backendPid(client: PoolClient): Promise<number> {
  const rows = decodeBackendPidRows(
    (await client.query("select pg_backend_pid() as pid")).rows,
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Missing backend PID.");
  return row.pid;
}

async function rowState(
  persistence: PostgresFlarexPersistence,
  scopeId: Insert["scopeId"],
) {
  return decodeRowState(
    (
      await persistence.query(
        `select revision.table_id, encode(revision.row_id, 'hex') as row_id,
    revision.commit_seq::text, revision.prev_commit_seq::text, revision.write_epoch_uuid::text,
    revision.schema_version_id, revision.creation_time, revision.value_codec_version,
    revision.is_tombstone, encode(revision.value_bytes, 'hex') as value_bytes,
    encode(revision.value_sha256, 'hex') as value_sha256, current_row.commit_seq::text as current_commit_seq
    from fx_app_row_rev as revision left join fx_app_row_current as current_row
    using (scope_uuid, table_id, row_id)
    where revision.scope_uuid = $1 order by revision.table_id, revision.row_id, revision.commit_seq`,
        [projectScopeIdUuidV1(scopeId).scopeUuid],
      )
    ).rows,
  );
}
