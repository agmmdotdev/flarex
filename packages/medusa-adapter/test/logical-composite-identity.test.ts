import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from
  "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { makeSchemaComposer } from "../src/schemaComposition";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/applicationAnalysisRegistration";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../persistence-postgres/test/postgresHelpers";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationFixture } from "../../persistence-postgres/test/fixtures/applicationNativeMutationTestFixture";
import type { PGliteFlarexPersistence } from "../../persistence-postgres/src/pglite";
import type { PostgresFlarexPersistence } from "../../persistence-postgres/src/postgres";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/frameworkSchemaArtifactAdmissionTestSupport";
import { logicalSchemaBindingScenario } from "../../persistence-postgres/test/logicalSchemaBindingScenario";
import type { CatalogControlSessionStarter } from "../../persistence-postgres/src/catalogControlSession";
import { makeCatalogControlSessionStarter } from "../../persistence-postgres/src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../persistence-postgres/src/postgresCatalogControlSession";
import { compileCurrencyDefinition } from "../src/currency-schema";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { preparedHostTestRuntime, openPreparedHostTestRuntime, closePreparedHostTestRuntime } from
  "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { issueRelationalSession, makePostgresRelationalSession, type RelationalSession } from
  "../../persistence-postgres/src/relationalTransaction/session";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { relationalTextIdentity } from "../../persistence-postgres/src/logicalDocuments/relationalRows";

const options = { runtimeHostIdentity: "flarex.test/composite-identity", compatibilityDate: "2026-09-23" };
const origin = (sourceId: string) => ({ kind: "synthetic", sourceId });
const schema = Result.getOrThrow(normalizeRelationalSchema({
  owner: "medusa", lineageId: "commerce.pair-fixture", capabilities: [], tables: [{
    tableId: "pair", origin: origin("pair.table"),
    columns: ["left_id", "right_id", "label"].map(columnId => ({ columnId, type: "text", nullable: false,
      default: { kind: "none" }, origin: origin(`pair.${columnId}`) })),
    keys: [{ keyId: "pair.identity", kind: "unique", columns: ["left_id", "right_id"], origin: origin("pair.identity") }],
    // The composite key itself must supply the ordered first-member prefix.
    indexes: [{ indexId: "pair.by-right", kind: "btree", columns: ["right_id"], predicate: null, origin: origin("pair.by-right") }],
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
const insertFirst = defineCommerceCommand("pairInsertFirst", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).write(ctx.manager, "insert", [{ left_id: "a", right_id: "1", label: "first" }]);
}));
const insertSecond = defineCommerceCommand("pairInsertSecond", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).write(ctx.manager, "insert", [{ left_id: "a", right_id: "2", label: "second" }]);
}));
const upsertFirst = defineCommerceCommand("pairUpsertFirst", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).write(ctx.manager, "upsert", [{ left_id: "a", right_id: "1", label: "updated" }]);
}));
const deleteFirst = defineCommerceCommand("pairDeleteFirst", "write", ctx => Effect.gen(function* () {
  return yield* (yield* ctx.table("pair")).delete(ctx.manager, [{ left_id: "a", right_id: "1" }]);
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
        authority: fixture.authorityPorts, application: fixture.activation,
        identityAndAccessPolicy: { profile: "composite-identity-test" },
        logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
          unique: fixture.uniqueConstraintEligibility, schemaVersionId, source: sourceInput,
          initialization: { stepId: "pair.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } },
        commands: [list, insertFirst, insertSecond, upsertFirst, deleteFirst],
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
        expect(yield* Effect.result(host.run(host.newRequestKey(), insertFirst, {})))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
        expect(yield* host.run(host.newRequestKey(), upsertFirst, {})).toMatchObject([{ label: "updated" }]);
        expect(yield* host.run(host.newRequestKey(), deleteFirst, {})).toMatchObject([{ label: "updated" }]);
        expect(yield* host.read(list, {})).toMatchObject([{ left_id: "a", right_id: "2", label: "second" }]);
      }), host => host.close);
    }),
  });
});
