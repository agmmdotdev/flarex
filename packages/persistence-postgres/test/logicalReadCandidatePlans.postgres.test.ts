import { sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { isJson, isJsonObject } from "flarex-protocol/json";
import { makeApplicationAnalysisRepository } from "../src/applicationAnalysisRegistration";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../src/postgresCatalogControlSession";
import { makeLogicalSchemaAdmission } from "../src/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../src/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../src/appUniqueConstraintSetClosureV1";
import { logicalIndexReadAccessQuery, logicalUniqueReadAccessQuery, logicalNativeReadAccessQuery,
  logicalPageReadAccessQuery, logicalSearchReadAccessQuery } from "../src/logicalReadAccessQueries";
import { locateAppIndexDefinitionByIdEffect } from "../src/appIndexDefinitions";
import { locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../src/appUniqueConstraintDefinitions";
import { selectLogicalIndex, selectLogicalUniqueConstraint, selectLogicalPageIndex, type LogicalWhere } from "../src/logicalDocuments/query";
import { runEffectTransaction } from "../src/effectTransaction";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { createApplicationNativeMutationPostgresFixture } from "./fixtures/applicationNativeMutationTestFixture";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
const growth = [1, 10, 100] as const;

/** Complete authored sources go through normal admission and projection
 * publication. Irrelevant definitions are never fabricated in projection rows. */
function corpusSchema() {
  const origin = { kind: "authored", sourceId: "fixture.logical-read-candidate-plans" };
  return Result.getOrThrow(normalizeRelationalSchema({ owner: "system", lineageId: "read-candidate-plans",
    capabilities: growth.flatMap(size => Array.from({ length: size }, (_, index) => ["id", "needle"].map(column => ({
      capabilityId: `probe_${size}/search_${column}_${index.toString().padStart(3, "0")}`, kind: "searchableText", origin,
      columns: [{ tableId: `probe_${size}`, columnId: column }, { tableId: `probe_${size}`, columnId: `suffix_${index}` }],
    })))).flat(),
    tables: growth.map(size => ({ tableId: `probe_${size}`, origin,
      columns: [...["id", "needle", "unused", "state", ...Array.from({ length: size }, (_, index) => `suffix_${index}`)].map(columnId => ({
        columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
        { columnId: "retired", type: "timestamptz", nullable: true, default: { kind: "none" }, origin }],
      keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin },
        ...Array.from({ length: size }, (_, index) => ({ keyId: `irrelevant_${index.toString().padStart(3, "0")}`,
          kind: "unique", columns: ["id", `suffix_${index}`], origin }))],
      indexes: [{ indexId: "base_needle", kind: "btree", columns: ["needle"], predicate: null, origin },
        ...Array.from({ length: size }, (_, index) => ({ indexId: `irrelevant_${index.toString().padStart(3, "0")}`,
          kind: "btree", columns: ["id", `suffix_${index}`], predicate: null, origin })),
        { indexId: "zz_state", kind: "btree", columns: ["state"], origin,
          predicate: { value: "active", textColumnId: "state", nullColumnId: "retired", kind: "isNullAndTextEquals" } }],
      constraints: [], relationships: [],
    })) }));
}

describe.skipIf(postgresUrl === null)("logical read candidate production query plans", () => {
  it("records same-leading irrelevant growth and preserves the existing winning selectors", async () => {
    const report: unknown[] = [];
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const namespace = await target.query<{ schemaName: string }>('select current_schema() as "schemaName"');
      const schemaName = namespace.rows[0]?.schemaName;
      if (schemaName === undefined) throw new Error("Missing target fixture namespace");
      const fixture = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: "flarex.test/logical-read-candidate-plans", compatibilityDate: "2026-08-13",
        physicalLocator: { kind: "database_per_scope", databaseKey: "logical_read_candidate_target", schemaName },
      }, { control, target });
      const prepared = await runEffect(Effect.gen(function* () {
        const analysis = yield* makeApplicationAnalysisRepository(target.drizzle).inspect(fixture.authority, fixture.active.basis.candidateId);
        if (analysis.status !== "analyzed") throw new Error("Missing authenticated fixture analysis");
        const schema = corpusSchema();
        const source = yield* captureLogicalSchemaSource({ key: "system.query-probes", owner: "system", writeProfile: "system.query-probes",
          evidence: { kind: "synthetic-query-plan-fixture" }, definition: { kind: "relational", schema },
          bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
            table: { namespace: "system", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
        return yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
          deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
          applicationAnalysis: { candidateId: analysis.candidateId, analysisId: analysis.analysisId,
            manifestSha256: analysis.manifestSha256, sourceArtifactRootSha256: analysis.sourceArtifactRootSha256 },
          sources: [source], extensions: [] });
      }));
      const schemaVersionId = decodeCatalogSchemaVersionId("logical-read-candidate-plans");
      const session = makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.pool) });
      await runEffect(Effect.gen(function* () {
        yield* makeLogicalSchemaAdmission({ controlDb: control.drizzle, session, deploymentId: fixture.deploymentId,
          scopeId: fixture.authority.scopeId }).admit(prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
          initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
      }));
      const arrangeCatalog = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
          const catalog = yield* ensureLogicalStorageDefinitions(tx, fixture.deploymentId, schemaVersionId);
          const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle,
            { deploymentId: fixture.deploymentId, schemaVersionId }, tx);
          yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
          return catalog;
        });
      const catalog = await runEffect(runEffectTransaction<Effect.Success<ReturnType<typeof arrangeCatalog>>,
        Effect.Error<ReturnType<typeof arrangeCatalog>>, Error, FlarexMetadataTransaction>(
        callback => control.drizzle.transaction(callback), "Arrange candidate plan catalog",
        arrangeCatalog, cause => failure("Arrange candidate plan catalog", cause)));
      await control.query("analyze fx_control_logical_read_access");
      for (const size of growth) await runEffect(runEffectTransaction(callback => control.drizzle.transaction(callback), "Inspect exact production candidate query",
        (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
          const localName = `probe_${size}`;
          const binding = catalog.requirements.evidence.tableBindings.find(member => member.table.logicalName === `read-candidate-plans/${localName}`);
          if (binding === undefined) throw new Error("Missing admitted corpus table");
          const definitions = yield* Effect.forEach(catalog.ordered.filter(member => member.definition.access.tableId === binding.tableId), member =>
            locateAppIndexDefinitionByIdEffect(tx, fixture.authority.scopeId, member.definition.indexDefinitionId));
          const indexes = definitions.filter(member => member !== null);
          const unique = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(tx, fixture.deploymentId, fixture.authority.scopeId,
            schemaVersionId, [binding.tableId], catalog.unique.length);
          if (unique === null) throw new Error("Missing admitted unique corpus");
          const input = { deploymentId: fixture.deploymentId, schemaVersionId, sourceKey: "system.query-probes", localName };
          const where = { id: "sample_id", needle: "sample_needle" };
          const originalIndex = yield* Effect.fromResult(selectLogicalIndex(indexes, binding.tableId, where, failure));
          const originalUnique = selectLogicalUniqueConstraint(unique, binding.tableId, where);
          if (Option.isNone(originalIndex) || originalUnique === undefined) throw new Error("Corpus must contain a real winning path");
          const indexQuery = logicalIndexReadAccessQuery(tx, input, where), uniqueQuery = logicalUniqueReadAccessQuery(tx, input, where);
          const indexRows = yield* Effect.tryPromise({ try: async () => await indexQuery, catch: cause => failure("Index probe", cause) });
          const uniqueRows = yield* Effect.tryPromise({ try: async () => await uniqueQuery, catch: cause => failure("Unique probe", cause) });
          const index = indexRows[0]?.projectionJson, constraint = uniqueRows[0]?.projectionJson;
          if (!isJson(index) || !isJsonObject(index) || !isJson(constraint) || !isJsonObject(constraint)) throw new Error("Malformed winning projection");
          expect(index.indexDefinitionId).toBe(originalIndex.value.definition.indexDefinitionId);
          expect(constraint.uniqueConstraintDefinitionId).toBe(originalUnique.uniqueConstraintDefinitionId);
          // The size-two demand has no declared matching size-two prefix.
          // Its winner is size one, so the plan must account for negative
          // evidence across the same-leading irrelevant suffix candidates.
          expect(index.fields).toHaveLength(1);
          expect(constraint.fields).toHaveLength(1);
          const suffix = `suffix_${size - 1}`;
          const parityCases: readonly Readonly<{ where: LogicalWhere; exactPoint?: Readonly<{ columns: readonly string[] }> }>[] = [
            { where: { id: "sample_id", [suffix]: "sample_suffix" } },
            { where: { id: "sample_id", [suffix]: { gte: "sample_suffix" } } },
            { where: { id: { gte: "sample_id" }, [suffix]: "sample_suffix" } },
            { where: { id: "sample_id", [suffix]: "sample_suffix" }, exactPoint: { columns: ["id"] } },
            { where: { id: { gte: "sample_id" } }, exactPoint: { columns: ["id"] } },
            { where: { id: null } },
            { where: { unused: "unused" } },
            { where: { retired: null, state: "active" } },
            { where: { retired: null, state: "draft" } },
          ];
          for (const candidate of parityCases) {
            const expectedIndex = yield* Effect.fromResult(selectLogicalIndex(indexes, binding.tableId, candidate.where, failure, candidate.exactPoint));
            const actualIndex = yield* Effect.tryPromise({
              try: async () => await logicalIndexReadAccessQuery(tx, input, candidate.where, candidate.exactPoint), catch: cause => failure("Index parity", cause) });
            expect(actualIndex).toHaveLength(Option.isSome(expectedIndex) ? 1 : 0);
            if (Option.isSome(expectedIndex)) {
              const projection = actualIndex[0]?.projectionJson;
              if (!isJson(projection) || !isJsonObject(projection)) throw new Error("Malformed index parity projection");
              expect(projection.indexDefinitionId).toBe(expectedIndex.value.definition.indexDefinitionId);
            }
            const expectedUnique = selectLogicalUniqueConstraint(unique, binding.tableId, candidate.where);
            const actualUnique = yield* Effect.tryPromise({ try: async () => await logicalUniqueReadAccessQuery(tx, input, candidate.where),
              catch: cause => failure("Unique parity", cause) });
            expect(actualUnique).toHaveLength(expectedUnique === undefined ? 0 : 1);
            if (expectedUnique !== undefined) {
              const projection = actualUnique[0]?.projectionJson;
              if (!isJson(projection) || !isJsonObject(projection)) throw new Error("Malformed unique parity projection");
              expect(projection.uniqueConstraintDefinitionId).toBe(expectedUnique.uniqueConstraintDefinitionId);
            }
          }
          const pageExpected = yield* Effect.fromResult(selectLogicalPageIndex(indexes, binding.tableId, "state",
            { column: "state", value: "active" }, ["retired"], failure));
          if (Option.isNone(pageExpected)) throw new Error("Missing admitted conditional page winner");
          const pageConditional = yield* Effect.tryPromise({ try: async () => await logicalPageReadAccessQuery(tx, input,
            ["state"], { column: "state", value: "active" }, ["retired"]), catch: cause => failure("Conditional page parity", cause) });
          expect(pageConditional).toHaveLength(1);
          const persistedConditional = pageConditional[0]?.projectionJson;
          if (!isJson(persistedConditional) || !isJsonObject(persistedConditional) ||
            !isJson(persistedConditional.predicate) || !isJsonObject(persistedConditional.predicate)) throw new Error("Malformed conditional page projection");
          expect(persistedConditional.indexDefinitionId).toBe(pageExpected.value.definition.indexDefinitionId);
          // JSONB reorders these authored/lookup properties. Exact facet keys
          // must depend on canonical predicate values, never insertion order.
          expect(Object.keys(persistedConditional.predicate)).not.toEqual(["kind", "nullField", "textField", "value"]);
          const pageConditionalMissing = yield* Effect.tryPromise({ try: async () => await logicalPageReadAccessQuery(tx, input,
            ["state"], { column: "state", value: "draft" }, ["retired"]), catch: cause => failure("Conditional page miss", cause) });
          expect(pageConditionalMissing).toHaveLength(0);
          const nativeQuery = logicalNativeReadAccessQuery(tx, input, { fields: ["id", "needle"], nulls: [], points: [] });
          const nativeNegative = logicalNativeReadAccessQuery(tx, input, { fields: ["unused"], nulls: [], points: [] });
          const pageQuery = logicalPageReadAccessQuery(tx, input, ["needle"], undefined, []);
          const pageNegative = logicalPageReadAccessQuery(tx, input, ["id", "needle"], { column: "id", value: "sample_id" }, []);
          const searchQuery = logicalSearchReadAccessQuery(tx, input, ["suffix_0"], [], "text");
          // Both fields independently occur in size declarations; none contains
          // both. This measures genuine negative posting-list intersection.
          const searchNegative = logicalSearchReadAccessQuery(tx, input, ["id", "needle"], [], "text");
          const nativeRows = yield* Effect.tryPromise({ try: async () => await nativeQuery, catch: cause => failure("Native probe", cause) });
          const nativeMissing = yield* Effect.tryPromise({ try: async () => await nativeNegative, catch: cause => failure("Native negative probe", cause) });
          const pageRows = yield* Effect.tryPromise({ try: async () => await pageQuery, catch: cause => failure("Page probe", cause) });
          const pageMissing = yield* Effect.tryPromise({ try: async () => await pageNegative, catch: cause => failure("Page negative probe", cause) });
          const searchRows = yield* Effect.tryPromise({ try: async () => await searchQuery, catch: cause => failure("Search probe", cause) });
          const searchMissing = yield* Effect.tryPromise({ try: async () => await searchNegative, catch: cause => failure("Search negative probe", cause) });
          expect(nativeRows).toHaveLength(4);
          expect(nativeMissing).toHaveLength(0);
          expect(pageRows).toHaveLength(1);
          expect(pageMissing).toHaveLength(0);
          expect(searchRows).toHaveLength(1);
          expect(searchMissing).toHaveLength(0);
          const firstSearch = catalog.search.find(candidate => candidate.tableId === binding.tableId && candidate.kind === "text" && candidate.columns.includes("suffix_0"));
          if (firstSearch === undefined) throw new Error("Missing real search winner");
          const search = searchRows[0]?.projectionJson;
          if (!isJson(search) || !isJsonObject(search)) throw new Error("Malformed selected search projection");
          expect(search.logicalIndexId).toBe(firstSearch.logicalIndexId);
          for (const [kind, query] of [["index", indexQuery], ["unique", uniqueQuery], ["native", nativeQuery],
            ["nativeNegative", nativeNegative], ["page", pageQuery], ["pageNegative", pageNegative],
            ["search", searchQuery], ["searchNegative", searchNegative]] as const) {
            const explained = yield* Effect.tryPromise({ try: () => tx.execute(sql`explain (analyze, buffers, format json) ${query.getSQL()}`),
              catch: cause => failure("Explain actual candidate probe", cause) });
            const result = yield* Schema.decodeUnknownEffect(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }))(explained);
            report.push({ size, kind, statement: query.toSQL(), plan: result.rows });
          }
        }), cause => failure("Inspect exact production candidate query", cause)));
    });
    expect(report).toHaveLength(growth.length * 8);
    const path = process.env.FLAREX_LOGICAL_READ_PLAN_REPORT_PATH;
    if (path !== undefined) await writeFile(path, JSON.stringify({ records: report }, null, 2), "utf8");
  }, 240_000);
});
