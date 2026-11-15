import { readFile, writeFile } from "node:fs/promises";
import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { CoreSqlParameter } from "../../src/database/corePersistence/driver";
import { issuePostgresSnapshotFilter } from "../../src/values/postgresRelationalPredicate";
import { prepareRelationalRead } from "../../src/values/relationalQuery";
import { createCorePostgresFixture } from "./fixture";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));
const origin = { kind: "synthetic", sourceId: "snapshot-page-plan" } as const;
const table = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, tables: [{ tableId: "entry", origin, columns: [
  { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
  { columnId: "title", type: "text", nullable: true, default: { kind: "none" }, origin },
  { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
  { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
], constraints: [], relationships: [] }], capabilities: [] })).tables[0];
class TestFailure extends Error {}
const failure = (reason: string) => new TestFailure(reason);
const identity = (value: number) => { const id = new Uint8Array(16); new DataView(id.buffer).setUint32(12, value, false); return id; };
const PlanNode: Schema.Codec<PlanNodeShape> = Schema.Struct({ "Node Type": Schema.String, "Actual Rows": Schema.Number,
  "Sort Method": Schema.optionalKey(Schema.String), Plans: Schema.optionalKey(Schema.Array(Schema.suspend((): Schema.Codec<PlanNodeShape> => PlanNode))) });
interface PlanNodeShape { readonly "Node Type": string; readonly "Actual Rows": number; readonly "Sort Method"?: string; readonly Plans?: readonly PlanNodeShape[] }
const decodePlan = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ "QUERY PLAN": Schema.Tuple([Schema.Struct({
  Plan: PlanNode, "Execution Time": Schema.Number })]) })]));
const nodes = (node: PlanNodeShape): PlanNodeShape[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const ROWS = 28_000;

describe.runIf(endpoints !== undefined)("ordinary-role snapshot page statement plan", () => {
  it("walks a number of entries proportional to the page's end, in either direction, never the table", async () => {
    if (endpoints === undefined || table === undefined) throw new Error("Missing owned PostgreSQL endpoints");
    let captured: Readonly<{ statement: string; parameters: readonly CoreSqlParameter[] }> | undefined;
    const fixture = await createCorePostgresFixture({ ...endpoints, wrapRuntimeDriver: driver => ({ ...driver,
      query: (statement, parameters) => {
        if (statement.includes("AS walked")) captured = { statement, parameters: parameters ?? [] };
        return driver.query(statement, parameters);
      } }) });
    const report: string[] = [];
    try {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const tableId = identity(1), indexId = identity(2), otherIndexId = identity(3);
      const utf8 = new TextEncoder();
      // Two revisions of every row, one row in seven soft-deleted, and a second index of the same size beside the paged one.
      for (const ts of [1n, 2n]) for (let start = 0; start < ROWS; start += 3000) {
        const batch = Array.from({ length: Math.min(3000, ROWS - start) }, (_, offset) => {
          const ordinal = start + offset, publicId = Result.getOrThrow(encodeDocumentId(100, identity(1000 + ordinal)));
          const id = `p${String(ordinal).padStart(6, "0")}`;
          return { ordinal, publicId, id, body: { _creationTime: ordinal, _id: publicId, id, title: `Product ${ordinal} ${"x".repeat(600)}`,
            deleted_at: ordinal % 7 === 3 ? "2024-02-02T00:00:00.000Z" : null } };
        });
        await Effect.runPromise(persistence.write(lease, {
          documents: batch.map(row => ({ ts, tableId, id: identity(1000 + row.ordinal), deleted: false, prevTs: ts === 1n ? null : 1n,
            jsonValue: utf8.encode(JSON.stringify(row.body)) })),
          indexes: batch.flatMap(row => [indexId, otherIndexId].map(index => ({ ts, index: { id: index }, mode: "scanComplete" as const, prev: null,
            key: Result.getOrThrow(encodeIndexKey([row.id], row.publicId)), value: { tableId, documentId: identity(1000 + row.ordinal) } }))) }));
      }
      await fixture.query(`ANALYZE "${fixture.namespace}".indexes`);
      await fixture.query(`ANALYZE "${fixture.namespace}".documents`);
      const snapshot = await Effect.runPromise(persistence.readSnapshot(2n));
      const filterPage = snapshot.filterPage;
      if (filterPage === undefined) throw new Error("Missing page statement");
      const active = Array.from({ length: ROWS }, (_, ordinal) => ordinal).filter(ordinal => ordinal % 7 !== 3);
      for (const order of ["asc", "desc"] as const) {
        const prepared = Result.getOrThrow(prepareRelationalRead(table, { order: { column: "id", direction: order },
          predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }] } }, 100, failure));
        if (prepared.snapshotPredicate === undefined) throw new Error("Missing stored-document predicate");
        const predicate = Result.getOrThrow(issuePostgresSnapshotFilter(table, prepared.snapshotPredicate, failure));
        const ordered = order === "asc" ? active : active.toReversed();
        for (const offset of [0, 1000, 19_000]) {
          const page = await Effect.runPromise(filterPage({ index: { id: indexId }, tableId, order, predicate, offset, limit: 20, maxExamined: 32_000, maxBytes: 1 << 30 }));
          if (Option.isNone(page) || captured === undefined) throw new Error("Expected a decided page");
          expect(page.value.hasMore).toBe(true);
          expect(page.value.entries.map(entry => new DataView(entry.document.id.buffer, entry.document.id.byteOffset).getUint32(12, false) - 1000))
            .toEqual(ordered.slice(offset, offset + 20));
          const plan = decodePlan(await fixture.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${captured.statement}`, captured.parameters))[0]["QUERY PLAN"][0];
          const all = nodes(plan.Plan), walked = Math.max(...all.map(node => node["Actual Rows"]));
          report.push(`${order} offset=${offset} execution=${plan["Execution Time"].toFixed(1)}ms walked=${walked} nodes=${all.map(node =>
            `${node["Node Type"]}${node["Sort Method"] === undefined ? "" : `[${node["Sort Method"]}]`}(${node["Actual Rows"]})`).join(" > ")}`);
          // The table holds 56,000 index rows for this index. A page ending at 19,021 walks 32,001 live entries, which
          // is the whole table: only its result and timing are recorded, since any plan may read everything there.
          if (offset > 1000) continue;
          // No node, scan or sort, handles more than the bounded walk: twice the window's end in live
          // entries, each with two revisions.
          expect(walked, `${order} ${offset}`).toBeLessThanOrEqual(Math.max(64, (offset + 21) * 2) * 2 + 64);
          expect(all.some(node => node["Node Type"] === "Seq Scan"), `${order} ${offset}`).toBe(false);
        }
      }
    } finally {
      if (process.env.FLAREX_PLAN_REPORT !== undefined) await writeFile(process.env.FLAREX_PLAN_REPORT, `${report.join("\n")}\n`);
      await fixture.close();
    }
  }, 600_000);
});
