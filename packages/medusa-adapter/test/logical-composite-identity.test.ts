import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from
  "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { makeSchemaComposer } from "../src/composition/schema";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/application/applicationAnalysisRegistration";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../persistence-postgres/test/support/postgresHelpers";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationFixture } from "../../persistence-postgres/test/application/applicationNativeMutationTestFixture";
import type { PGliteFlarexPersistence } from "../../persistence-postgres/src/database/pglite";
import type { PostgresFlarexPersistence } from "../../persistence-postgres/src/database/postgres";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { logicalSchemaBindingScenario } from "../../persistence-postgres/test/storage/catalog/logicalSchemaBindingScenario";
import type { CatalogControlSessionStarter } from "../../persistence-postgres/src/database/catalogControlSession";
import { makeCatalogControlSessionStarter } from "../../persistence-postgres/src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../persistence-postgres/src/database/postgresCatalogControlSession";
import { compileCurrencyDefinition } from "../src/modules/currency/schema";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { preparedHostTestRuntime, openPreparedHostTestRuntime, closePreparedHostTestRuntime } from
  "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { issueRelationalSession, makePostgresRelationalSession, type RelationalSession } from
  "../../persistence-postgres/src/database/relationalTransaction/session";
import { runEffectTransaction } from "../../persistence-postgres/src/database/effectTransaction";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { relationalTextIdentity } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalRows";

const options = { runtimeHostIdentity: "flarex.test/composite-identity", compatibilityDate: "2026-09-23" };
const origin = (sourceId: string) => ({ kind: "synthetic", sourceId });
const schema = Result.getOrThrow(normalizeRelationalSchema({
  owner: "medusa", lineageId: "commerce.pair-fixture", capabilities: [], tables: [{
    tableId: "pair", origin: origin("pair.table"),
    columns: [
      ...["left_id", "right_id", "label"].map(columnId => ({ columnId, type: "text" as const, nullable: false,
        default: { kind: "none" as const }, origin: origin(`pair.${columnId}`) })),
      { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin: origin("pair.amount") },
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: origin("pair.deleted_at") },
    ],
    keys: [{ keyId: "pair.identity", kind: "unique", columns: ["left_id", "right_id"], origin: origin("pair.identity") }],
    // The composite key itself must supply the ordered first-member prefix.
    // A decimal suffix must not block a text-only prefix lookup.
    indexes: [
      { indexId: "pair.by-right", kind: "btree", columns: ["right_id", "amount"], predicate: null, origin: origin("pair.by-right") },
      { indexId: "pair.active-label", kind: "btree", columns: ["label"], predicate: { kind: "isNull", columnId: "deleted_at" },
        origin: origin("pair.active-label") },
    ],
    constraints: [], relationships: [],
  }],
}));
const table = schema.tables[0];
if (table === undefined) throw new Error("Missing neutral pair table");
const sourceInput = { sourceKey: "medusa.pair-fixture", writeProfile: "medusa.pair-fixture",
  schema, evidence: { kind: "synthetic", sourceId: "pair-fixture" } };
const ordered = { column: "left_id", direction: "asc" } as const;
const list = defineCommerceCommand("pairList", "read", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).find(ctx.manager, { order: ordered });
}));
const listByRight = defineCommerceCommand("pairListByRight", "read", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).find(ctx.manager, { order: { column: "right_id", direction: "asc" },
    predicate: { kind: "in", column: "right_id", values: ["2"] } });
}));
const listByEither = defineCommerceCommand("pairListByEither", "read", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).find(ctx.manager, { order: { column: "right_id", direction: "asc" },
    predicate: { kind: "or", children: [
      { kind: "in", column: "left_id", values: ["a"] },
      { kind: "in", column: "right_id", values: ["2"] },
    ] } });
}));
const listActiveLabel = defineCommerceCommand("pairListActiveLabel", "read", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).find(ctx.manager, { order: ordered,
    predicate: { kind: "and", children: [
      { kind: "in", column: "label", values: ["updated"] }, { kind: "isNull", column: "deleted_at" },
    ] } });
}));
const listActiveEither = defineCommerceCommand("pairListActiveEither", "read", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).find(ctx.manager, { order: { column: "right_id", direction: "asc" },
    predicate: { kind: "or", children: [
      { kind: "and", children: [{ kind: "in", column: "label", values: ["first"] },
        { kind: "isNull", column: "deleted_at" }] },
      { kind: "in", column: "right_id", values: ["2"] },
    ] } });
}));
const listLabelWithoutActive = defineCommerceCommand("pairListLabelWithoutActive", "read", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).find(ctx.manager, { order: ordered,
    predicate: { kind: "in", column: "label", values: ["updated"] } });
}));
const insertFirst = defineCommerceCommand("pairInsertFirst", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).write(ctx.manager, "insert", [{ left_id: "a", right_id: "1", label: "first", amount: null }]);
}));
const insertSecond = defineCommerceCommand("pairInsertSecond", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).write(ctx.manager, "insert", [{ left_id: "a", right_id: "2", label: "second", amount: null }]);
}));
const upsertFirst = defineCommerceCommand("pairUpsertFirst", "write", ctx => Effect.gen(function* () {
  const store = yield* ctx.table("pair");
  const written = yield* store.write(ctx.manager, "upsert", [{ left_id: "a", right_id: "1", label: "updated", amount: null }]);
  const selected = yield* store.find(ctx.manager, { order: { column: "right_id", direction: "asc" },
    predicate: { kind: "and", children: [
      { kind: "in", column: "right_id", values: ["1"] },
      { kind: "in", column: "left_id", values: ["a"] },
    ] } });
  const active = yield* store.find(ctx.manager, { order: ordered,
    predicate: { kind: "and", children: [{ kind: "in", column: "label", values: ["updated"] },
      { kind: "isNull", column: "deleted_at" }] } });
  return { written, selected, active };
}));
const deactivateFirst = defineCommerceCommand("pairDeactivateFirst", "write", ctx => Effect.gen(function* () {
  const store = yield* ctx.table("pair");
  yield* store.write(ctx.manager, "upsert", [{ left_id: "a", right_id: "1", label: "updated", amount: null,
    deleted_at: "2026-09-24T00:00:00.000Z" }]);
  return yield* store.find(ctx.manager, { order: ordered,
    predicate: { kind: "and", children: [{ kind: "in", column: "label", values: ["updated"] },
      { kind: "isNull", column: "deleted_at" }] } });
}));
const reactivateFirst = defineCommerceCommand("pairReactivateFirst", "write", ctx => Effect.gen(function* () {
  const store = yield* ctx.table("pair");
  yield* store.write(ctx.manager, "upsert", [{ left_id: "a", right_id: "1", label: "updated", amount: null, deleted_at: null }]);
  return yield* store.find(ctx.manager, { order: ordered,
    predicate: { kind: "and", children: [{ kind: "in", column: "label", values: ["updated"] },
      { kind: "isNull", column: "deleted_at" }] } });
}));
const deleteFirst = defineCommerceCommand("pairDeleteFirst", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).delete(ctx.manager, [{ left_id: "a", right_id: "1" }]);
}));
const pageAfterRekey = defineCommerceCommand("pairPageAfterRekey", "write", ctx => Effect.gen(function* () {
  const store = yield* ctx.table("pair");
  yield* store.write(ctx.manager, "update", [{ left_id: "a", right_id: "1", label: "second" }]);
  const query = { fields: ["left_id", "right_id", "label"], order: { column: "label", direction: "asc" },
    predicate: { kind: "isNull", column: "deleted_at" }, take: 1 };
  const first = yield* store.findPage(ctx.manager, query);
  const second = yield* store.findPage(ctx.manager, { ...query, skip: 1 });
  return { first, second };
}));

describe("shared relational composite identity", () => {
  it("executes a neutral composite key on PGlite", async () => {
    const control = await createMigratedPGlitePersistence();
    const target = await createMigratedPGlitePersistence();
    const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence(options, { control, target });
    await Effect.runPromise(witness(fixture, makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter));
  });
  it.skipIf(postgresUrl === null)("executes the same key with an ordinary PostgreSQL role", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const roles = await target.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
        "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
      expect(roles.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
      const schemaName = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
      if (schemaName === undefined) throw new Error("Missing PostgreSQL fixture schema");
      const fixture = await createApplicationNativeMutationPostgresFixture({ ...options,
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName },
      }, { control, target });
      const session = makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.pool) });
      await openPreparedHostTestRuntime(target.drizzle);
      try { await Effect.runPromise(witness(fixture, session, makePostgresRelationalSession(target))); }
      finally { await closePreparedHostTestRuntime(target.drizzle); }
    });
  });
});

const witness = Effect.fn("CompositeIdentity.witness")(function* <Persistence extends PGliteFlarexPersistence | PostgresFlarexPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, session: CatalogControlSessionStarter, suppliedDataSession?: RelationalSession,
) {
  expect(Result.getOrThrow(relationalTextIdentity(table, reason => new Error(reason)))).toEqual(["left_id", "right_id"]);
  const compose = makeSchemaComposer({ deploymentId: fixture.deploymentId, authority: fixture.authority,
    applicationAnalyses: makeApplicationAnalysisRepository(fixture.target.drizzle), medusaModules: ["currency"] });
  const base = yield* compose({ applicationCandidateId: fixture.active.basis.candidateId,
    payloadCollections: [{ slug: "news", fields: [{ name: "title", type: "text", required: true }] }],
    payloadViews: [], extensions: [] });
  const candidate = yield* readPreparedLogicalSchemaCandidate(base);
  const source = yield* captureLogicalSchemaSource({ key: sourceInput.sourceKey, owner: "medusa",
    writeProfile: sourceInput.writeProfile, evidence: sourceInput.evidence, definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "pair", table: { namespace: "medusa", logicalName: "commerce.pair-fixture/pair" } }],
  });
  const prepared = yield* prepareLogicalSchemaCandidate({ ...candidate, sources: [...candidate.sources, source] });
  const currency = yield* compileCurrencyDefinition();
  yield* logicalSchemaBindingScenario(fixture, session, prepared, {
    source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: currency.schema, evidence: currency.provenance },
    rows: [], reads: [], execute: () => Effect.void, verify: () => Effect.void,
    concurrentExecute: () => Effect.void,
    hostProof: (bindingTarget, schemaVersionId) => Effect.gen(function* () {
      const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
        1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
      const dataSession = suppliedDataSession ?? issueRelationalSession(fixture.target.drizzle, (_profile, work) => runEffectTransaction(
        callback => fixture.target.drizzle.transaction(callback), "Composite identity transaction", work,
        cause => new RelationalSessionError({ reason: "resourceFailure", cause })));
      yield* Effect.acquireUseRelease(makeCommerceHost({ hostRuntime: preparedHostTestRuntime(fixture.target.drizzle),
        database: fixture.target.drizzle, session: dataSession, target: bindingTarget, deploymentId: fixture.deploymentId,
        scopeId: fixture.authority.scopeId,
        authority: fixture.authorityPorts, application: fixture.activation,
        identityAndAccessPolicy: { profile: "composite-identity-test" },
        logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
          unique: fixture.uniqueConstraintEligibility, schemaVersionId, source: sourceInput,
          initialization: { stepId: "pair.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } },
        commands: [list, listByRight, listByEither, listActiveLabel, listActiveEither, listLabelWithoutActive,
          insertFirst, insertSecond, upsertFirst, deactivateFirst, reactivateFirst, deleteFirst, pageAfterRekey],
      }), host => Effect.gen(function* () {
        expect(yield* host.initialize([])).toEqual({ rowCount: 0 });
        expect(yield* host.run(host.newRequestKey(), insertFirst, {})).toMatchObject([{ left_id: "a", right_id: "1" }]);
        expect(yield* host.run(host.newRequestKey(), insertSecond, {})).toMatchObject([{ left_id: "a", right_id: "2" }]);
        const listed = yield* host.read(list, {});
        expect(listed).toHaveLength(2);
        expect(listed).toEqual(expect.arrayContaining([
          expect.objectContaining({ right_id: "1", label: "first" }),
          expect.objectContaining({ right_id: "2", label: "second" }),
        ]));
        expect(yield* host.read(listByRight, {})).toMatchObject([{ right_id: "2", label: "second" }]);
        expect(yield* host.read(listByEither, {})).toMatchObject([{ right_id: "1" }, { right_id: "2" }]);
        expect(yield* host.read(listActiveEither, {})).toMatchObject([{ right_id: "1" }, { right_id: "2" }]);
        expect(yield* Effect.result(host.run(host.newRequestKey(), insertFirst, {})))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
        const pageKey = host.newRequestKey();
        const paged = yield* host.run(pageKey, pageAfterRekey, null);
        expect(paged).toEqual({ first: { rows: [{ left_id: "a", right_id: "1", label: "second" }], hasMore: true },
          second: { rows: [{ left_id: "a", right_id: "2", label: "second" }], hasMore: false } });
        expect(yield* host.run(pageKey, pageAfterRekey, null)).toEqual(paged);
        expect(yield* host.run(host.newRequestKey(), upsertFirst, {})).toMatchObject({
          written: [{ label: "updated" }], selected: [{ right_id: "1", label: "updated" }], active: [{ label: "updated" }],
        });
        expect(yield* host.read(listActiveLabel, {})).toMatchObject([{ label: "updated" }]);
        expect(yield* Effect.result(host.read(listLabelWithoutActive, {})))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
        expect(yield* host.run(host.newRequestKey(), deactivateFirst, {})).toEqual([]);
        expect(yield* host.read(listActiveLabel, {})).toEqual([]);
        expect(yield* host.run(host.newRequestKey(), reactivateFirst, {})).toMatchObject([{ label: "updated" }]);
        expect(yield* host.run(host.newRequestKey(), deleteFirst, {})).toMatchObject([{ label: "updated" }]);
        expect(yield* host.read(list, {})).toMatchObject([{ left_id: "a", right_id: "2", label: "second" }]);
      }), host => host.close);
    }),
  });
});
