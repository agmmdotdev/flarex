import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "../../../../analysis/src/logicalSchemaCandidate";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "../../../../medusa-adapter/test/support/logical-currency-fixture";
import { structuralCommerceSchema, structuralCommerceProvenance } from "./structuralCommerceSchema";
import { makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges } from "../../../src/database/schema";
import { fxSystemLogicalSourceInitializations } from "../../../src/storage/catalog/logicalStorageInitialization";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../../src/execution/diagnostics/operation";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const kinds = ["main", "refusal", "late", "empty", "raw"] as const;
type SourceKind = typeof kinds[number];
const key = (kind: SourceKind) => "medusa.bootstrapProbe" + (kind === "main" ? "" : "." + kind);
function schemaFor(kind: SourceKind) {
  const neutral = structuralCommerceSchema();
  return Result.getOrThrow(normalizeRelationalSchema({ ...neutral, lineageId: neutral.lineageId + "." + kind,
    tables: neutral.tables.filter(table => kind !== "raw" || table.tableId === "parent").map(table => ({ ...table,
      // The logical relational profile uses indexed FK probes and noAction
      // updates. The retained physical structural-ownership fixture is unchanged.
      constraints: table.constraints.map(constraint => ({ ...constraint, onUpdate: "noAction" })),
      indexes: table.tableId !== "child" ? [] : [{ indexId: "child.parent-equality", kind: "textEquality",
        columns: ["parent_id"], predicate: null, origin: { kind: "authored", sourceId: "test.bootstrap.child-parent" } }],
    })) }));
}
const read = defineCommerceCommand("read-bootstrap-probe", "read", Effect.fn(function* (ctx) {
  const output: Record<string, Json> = {};
  for (const name of ["parent", "child", "independent"])
    output[name] = yield* (yield* ctx.table(name)).find(ctx.manager, { order: { column: "id", direction: "asc" } });
  return output;
}));
let fixture: LogicalCurrencyFixture;
const rows: Json[] = [
  { table: "parent", row: { id: "parent_a" } },
  { table: "parent", row: { id: "parent_b" } },
  { table: "child", row: { id: "child_a", parent_id: "parent_a" } },
  { table: "parent", row: { id: "parent_c" } },
  { table: "child", row: { id: "child_b", parent_id: "parent_c" } },
  { table: "independent", row: { id: "independent_a" } },
];
async function source(kind: SourceKind = "main") {
  const schema = schemaFor(kind);
  return runEffect(captureLogicalSchemaSource({ key: key(kind), owner: "medusa",
    writeProfile: key(kind), evidence: structuralCommerceProvenance, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: schema.coordinate.lineageId + "/" + table.identity.tableId } })) }));
}
async function host(dataset: Json, selected = fixture, stepId = "neutral-multi-table", kind: SourceKind = "main") {
  const captured = await runEffect(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: dataset },
    1_048_576, { invalidInput: () => new Error("Invalid neutral dataset"), hashFailure: cause => new Error("Neutral dataset hash", { cause }) }));
  const prepared = await runEffect(makeCommerceHost({ ...selected.hostInput, commands: [read],
    identityAndAccessPolicy: { profile: "neutral-multi-table-bootstrap" },
    logicalStorage: { ...selected.hostInput.logicalStorage,
      source: { sourceKey: key(kind), writeProfile: key(kind), schema: schemaFor(kind), evidence: structuralCommerceProvenance },
      initialization: { stepId, datasetSha256: captured.sha256Hex, expectedRowCount: Array.isArray(dataset) ? dataset.length : 0 } } }));
  cleanup.push(() => runEffect(prepared.close));
  return { prepared, digest: captured.sha256Hex };
}
async function snapshot(selected = fixture) {
  return { rows: await selected.persistence.drizzle.select().from(fxAppRowCurrent),
    commits: await selected.persistence.drizzle.select().from(fxSystemCommits),
    facts: await selected.persistence.drizzle.select().from(fxSystemCommitAppRowChanges),
    receipts: await selected.persistence.drizzle.select().from(fxSystemLogicalSourceInitializations) };
}

beforeAll(async () => { fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
  additionalSources: await Promise.all(kinds.map(kind => source(kind))),
}); }, 180_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

it("initializes an ordered neutral parent/child dataset through the canonical multi-table host", async () => {
  const { prepared, digest } = await host(rows);
  const before = await snapshot();
  expect(await runEffect(prepared.initialize(rows))).toEqual({ rowCount: rows.length });
  expect(await runEffect(prepared.read(read, {}))).toEqual({
    parent: [{ id: "parent_a" }, { id: "parent_b" }, { id: "parent_c" }],
    child: [{ id: "child_a", parent_id: "parent_a" }, { id: "child_b", parent_id: "parent_c" }],
    independent: [{ id: "independent_a" }],
  });
  const after = await snapshot();
  expect(after.rows.length - before.rows.length).toBe(rows.length);
  expect(after.facts.length - before.facts.length).toBe(rows.length);
  expect(after.commits.length - before.commits.length).toBe(1);
  expect(after.receipts.length - before.receipts.length).toBe(1);
  expect(after.receipts.find(receipt => receipt.sourceKey === "medusa.bootstrapProbe")).toMatchObject({
    stepId: "neutral-multi-table", datasetSha256: digest, rowCount: rows.length,
  });
  expect(await runEffect(prepared.initialize(rows))).toEqual({ rowCount: rows.length });
  expect(await snapshot()).toEqual(after);
}, 120_000);

it("refuses flat multi-table rows, malformed envelopes and targets outside the admitted source before publication", async () => {
  const before = await snapshot();
  const cases: readonly { readonly dataset: Json; readonly reason: string }[] = [
    { dataset: [{ id: "unadmitted-seed" }], reason: "unsupportedProfile" },
    { dataset: [{ table: "parent", row: { id: "parent_a" }, extra: true }], reason: "unsupportedProfile" },
    { dataset: [{ table: "parent" }], reason: "unsupportedProfile" },
    { dataset: [{ table: "parent", row: [] }], reason: "unsupportedProfile" },
    { dataset: [{ table: "currency", row: { code: "foreign" } }], reason: "invalidAuthority" },
    { dataset: [{ table: "medusa.bootstrapProbe.refusal/parent", row: { id: "wrong-name" } }], reason: "invalidAuthority" },
  ];
  for (const sample of cases) {
    const { prepared } = await host(sample.dataset, fixture, "neutral-refusals", "refusal");
    expect(await runEffectFailure(prepared.initialize(sample.dataset))).toMatchObject({ reason: sample.reason });
    expect(await snapshot()).toEqual(before);
  }
}, 120_000);

it("rolls back earlier table writes and the initialization receipt when final FK validation fails", async () => {
  const bad: Json[] = [{ table: "parent", row: { id: "pending-parent" } },
    { table: "child", row: { id: "pending-child", parent_id: "missing-parent" } }];
  const { prepared } = await host(bad, fixture, "neutral-late-constraint", "late");
  const before = await snapshot(), reached: string[] = [];
  const diagnostics: ExecutionDiagnosticPolicy = { observe(name, work) {
    return Effect.andThen(Effect.sync(() => { reached.push(name); }), work);
  } };
  expect(await runEffectFailure(prepared.initialize(bad).pipe(Effect.provideService(ExecutionDiagnostics, diagnostics))))
    .toMatchObject({ reason: "invalidInput" });
  // Observe the real operation owner without replacing storage, constraints or
  // the atomic host. Both pending writes must execute before the FK refusal.
  expect(reached.filter(name => name === "LogicalDocuments.relationalChange")).toHaveLength(2);
  expect(await snapshot()).toEqual(before);
}, 120_000);

it("binds target tables into the dataset digest and preserves the source-wide first-data gate", async () => {
  const dataset = [{ table: "parent", row: { id: "bound-target" } }];
  const { prepared } = await host(dataset, fixture, "neutral-target-digest", "refusal");
  const before = await snapshot();
  expect(await runEffectFailure(prepared.initialize([{ table: "independent", row: { id: "bound-target" } }])))
    .toMatchObject({ reason: "seedMismatch" });
  expect(await snapshot()).toEqual(before);
  expect(await runEffect(prepared.initialize(dataset))).toEqual({ rowCount: 1 });
  const after = await snapshot();
  const changed = await host([{ table: "child", row: { id: "late-seed", parent_id: "bound-target" } }],
    fixture, "neutral-second-seed", "refusal");
  expect(await runEffectFailure(changed.prepared.initialize([{ table: "child", row: { id: "late-seed", parent_id: "bound-target" } }])))
    .toMatchObject({ reason: "seedMismatch" });
  expect(await snapshot()).toEqual(after);
}, 120_000);

it("retains empty multi-table initialization and flat single-table initialization", async () => {
  const before = await snapshot();
  const empty = await host([], fixture, "neutral-empty", "empty");
  expect(await runEffect(empty.prepared.initialize([]))).toEqual({ rowCount: 0 });
  expect(await runEffect(empty.prepared.read(read, {}))).toEqual({ parent: [], child: [], independent: [] });
  expect(await runEffect(empty.prepared.initialize([]))).toEqual({ rowCount: 0 });
  const afterEmpty = await snapshot();
  expect(afterEmpty.rows).toEqual(before.rows);
  expect(afterEmpty.facts).toEqual(before.facts);
  expect(afterEmpty.receipts.length - before.receipts.length).toBe(1);
  expect(afterEmpty.commits.length - before.commits.length).toBe(1);
  const flat = await host([{ id: "flat-single-table" }], fixture, "neutral-flat", "raw");
  expect(await runEffect(flat.prepared.initialize([{ id: "flat-single-table" }]))).toEqual({ rowCount: 1 });
  const afterFlat = await snapshot();
  expect(afterFlat.rows.length - afterEmpty.rows.length).toBe(1);
  expect(afterFlat.facts.length - afterEmpty.facts.length).toBe(1);
  expect(afterFlat.receipts.length - afterEmpty.receipts.length).toBe(1);
  expect(await runEffect(flat.prepared.initialize([{ id: "flat-single-table" }]))).toEqual({ rowCount: 1 });
  expect(await snapshot()).toEqual(afterFlat);
}, 120_000);

it("keeps identical seeded keys and initialization receipts isolated between authenticated scopes on the same storage", async () => {
  const primary = await host(rows);
  expect(await runEffect(primary.prepared.initialize(rows))).toEqual({ rowCount: rows.length });
  const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
    resource: fixture.resource, additionalSources: [await source()],
    fixtureIdentity: { deploymentId: "deployment_neutral_seed_scope_b", projectId: "project_neutral_seed_scope_b", uuidOffset: 290_000 },
  });
  const before = await snapshot();
  expect(await runEffectFailure((await host(rows, other)).prepared.read(read, {}))).toMatchObject({ reason: "seedRequired" });
  expect(await snapshot()).toEqual(before);
  const secondary = await host(rows, other);
  expect(await runEffect(secondary.prepared.initialize(rows))).toEqual({ rowCount: rows.length });
  expect(await runEffect(secondary.prepared.read(read, {}))).toEqual(await runEffect(primary.prepared.read(read, {})));
  const after = await snapshot();
  const receipts = after.receipts.filter(receipt => receipt.sourceKey === key("main"));
  expect(receipts).toHaveLength(2);
  expect(new Set(receipts.map(receipt => receipt.scopeUuid)).size).toBe(2);
  const seeded = await snapshot();
  expect(await runEffect(primary.prepared.initialize(rows))).toEqual({ rowCount: rows.length });
  expect(await runEffect(secondary.prepared.initialize(rows))).toEqual({ rowCount: rows.length });
  expect(await snapshot()).toEqual(seeded);
}, 180_000);
