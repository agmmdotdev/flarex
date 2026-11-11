import { Effect, Result } from "effect";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1 } from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import type { DocumentObject } from "flarex-protocol/document-value";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
  isSourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { invokeApplicationMutation } from "@flarex/standard-application-invocation/internal/application-mutation-system";
import type { CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { ApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { createCoreApplicationDefinition } from "./applicationCoreDefinition";
import { makeApplicationNativeMutationTestLayer } from "./applicationNativeMutationHarness";
import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";
import { sourceBundleFromProduced } from "./standardApplicationCurrentAnalysisHarness";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

/** Execute SDK authoring in the real cold analyzer, without precomputed metadata. */
export async function createSourceValidatorApplicationDefinition() {
  const execution = [
    'import { mutation } from "flarex/server";',
    'import { v } from "flarex/values";',
    'import { write, badReturn } from "../functions/source.js";',
    'const handle = v.function({ fnType: "query", args: { _input: v.number() }, returns: v.string() });',
    'export default { source: {',
    '  write: mutation({ args: { handle, clock: v.commitTs(), kind: v.union(v.literal("one"), v.literal("two")) },',
    '    returns: v.object({ id: v.id("variantDocs"), handle: v.function({ fnType: "action", args: {} }), clock: v.commitTs(), refused: v.boolean(), emptyRefused: v.boolean() }), handler: write }),',
    '  badReturn: mutation({ args: {}, returns: v.function(), handler: badReturn }),',
    '} };',
  ].join("\n");
  const schema = [
    'import { defineGlobalTable, defineSchema } from "flarex/server";',
    'import { v } from "flarex/values";',
    'const common = { scores: v.record(v.string(), v.number()), handle: v.function(), clock: v.commitTs(), tag: v.literal("literal\\u0000é"), nested: v.object({ _kept: v.string() }) };',
    'const wide = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => ["field" + index, v.optional(v.string())]));',
    'export default defineSchema({',
    '  users: defineGlobalTable({ name: v.string() }).index("by_name", ["name"]),',
    '  variantDocs: defineGlobalTable(v.union(v.object({ ...common, kind: v.literal("one"), _removed: v.literal(NaN) }), v.object({ ...common, kind: v.literal("two") }))).index("by_kind", ["kind"]),',
    '  openDocs: defineGlobalTable(v.any()),',
    '  emptyDocs: defineGlobalTable(v.union()),',
    '  singletonDocs: defineGlobalTable(v.union(v.object({ label: v.string() }))),',
    '  wideDocs: defineGlobalTable(v.object(wide)),',
    '});',
  ].join("\n");
  const handler = [
    'export async function write(ctx, args) {',
    '  const value = { kind: args.kind, scores: { Ada: 42 }, handle: args.handle, clock: args.clock, tag: "literal\\u0000é", nested: { _kept: "nested" } };',
    '  let refused = false, emptyRefused = false;',
    '  try { await ctx.db.insert("variantDocs", { ...value, kind: "neither" }); } catch (error) { if (error.name !== ' + JSON.stringify(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1) + ') throw error; refused = true; }',
    '  try { await ctx.db.insert("emptyDocs", {}); } catch (error) { if (error.name !== ' + JSON.stringify(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1) + ') throw error; emptyRefused = true; }',
    '  const id = await ctx.db.insert("variantDocs", value);',
    '  await ctx.db.insert("openDocs", { arbitrary: "open" });',
    '  await ctx.db.insert("singletonDocs", { label: args.kind });',
    '  await ctx.db.insert("wideDocs", {});',
    '  const indexed = await ctx.db.query("variantDocs").withIndex("by_kind", q => q.eq("kind", args.kind)).collect();',
    '  if (!indexed.some(row => row._id === id)) throw new Error("Union table index lost its pending member.");',
    '  return { id, handle: args.handle, clock: args.clock, refused, emptyRefused };',
    '}',
    'export async function badReturn(ctx) { await ctx.db.insert("openDocs", { arbitrary: "rollback" }); return "not a function handle"; }',
  ].join("\n");
  const text = new TextEncoder();
  const source = await sourceBundleFromProduced({
    executionPath: "_flarex/application.js", schemaPath: "_flarex/schema.js", authPath: null,
    modules: [
      { path: "_flarex/application.js", roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION, sourceBytes: text.encode(execution), sourceMapBytes: null },
      { path: "_flarex/schema.js", roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA, sourceBytes: text.encode(schema), sourceMapBytes: null },
      { path: "functions/source.js", roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION, sourceBytes: text.encode(handler), sourceMapBytes: null },
    ].map(module => {
      if (!isSourceArtifactV2ModuleRolesV1(module.roles)) throw new Error("Source fixture has an invalid module role.");
      return { ...module, roles: module.roles };
    }),
  });
  return createCoreApplicationDefinition(source);
}

export async function proveSourceValidatorTranslation(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  const handle = "function://" + Result.getOrThrow(encodeDocumentId(999, new Uint8Array(16).fill(7))) + "#ignored\u0000fragment";
  const minimum = -9223372036854775808n;
  const readRows = async (database: CoreDatabase, table: string) => {
    const read = await runSystemTestEffectV1(database.begin());
    try { return await runSystemTestEffectV1(read.scan(table, "by_id")); }
    finally { await runSystemTestEffectV1(read.abort()); }
  };
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const invoke = (path: string, args: DocumentObject, key: string) => Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make(path), args, TransactionRequestKeyV1Schema.make("source-wire:" + key),
    ).pipe(Effect.provide(layer)));
    const first = await runSystemTestEffectV1(invoke("source:write", { handle, clock: minimum, kind: "one" }, "one"));
    const second = await runSystemTestEffectV1(invoke("source:write", { handle, clock: 42n, kind: "two" }, "two"));
    const loadsBeforeInvalidArguments = loader.loads;
    const invalidHandle = await runSystemTestEffectV1(Effect.exit(invoke("source:write", { handle: "FUNCTION://bad", clock: 1n, kind: "one" }, "bad-handle")));
    const invalidClock = await runSystemTestEffectV1(Effect.exit(invoke("source:write", { handle, clock: 1, kind: "one" }, "bad-clock")));
    const invalidArgumentLoads = loader.loads - loadsBeforeInvalidArguments;
    const beforeInvalidReturn = await readRows(fixture.database, "openDocs");
    const invalidReturn = await runSystemTestEffectV1(Effect.exit(invoke("source:badReturn", {}, "bad-return")));
    const afterInvalidReturn = await readRows(fixture.database, "openDocs");
    const warm = await readRows(fixture.database, "variantDocs");
    const reopened = await fixture.reopen();
    const cold = await readRows(reopened, "variantDocs");
    const coldLayer = await makeApplicationNativeMutationTestLayer({ ...fixture, database: reopened }, loader);
    const coldInvoke = (args: DocumentObject, key: string) => Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("source:write"), args, TransactionRequestKeyV1Schema.make("source-wire:" + key),
    ).pipe(Effect.provide(coldLayer)));
    const loadsBeforeReplay = loader.loads;
    const replay = await runSystemTestEffectV1(coldInvoke({ handle, clock: minimum, kind: "one" }, "one"));
    const replayWorkerLoads = loader.loads - loadsBeforeReplay;
    const fresh = await runSystemTestEffectV1(coldInvoke({ handle, clock: 42n, kind: "two" }, "cold-fresh"));
    return { handle, first, second, invalidHandle, invalidClock, invalidArgumentLoads, invalidReturn,
      beforeInvalidReturn, afterInvalidReturn, warm, cold, replay, replayWorkerLoads, fresh,
      final: await readRows(reopened, "variantDocs"), wideRows: await readRows(reopened, "wideDocs"),
      manifest: fixture.manifest, coldAnalysisLoads: fixture.coldAnalysisLoads, storageTables: await fixture.storageTables() };
  } finally { await loader.dispose(); }
}
