import type { ApplicationCoreMutationFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-mutation-fixture";
import { CORE_TRANSACTION_REFERENCE_LIMITS } from "@flarex/persistence-postgres/internal/core";
import { Effect, Option, Result, Schema } from "effect";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { invokeApplicationMutation, makeApplicationMutationSystemLayer } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { makeApplicationMutationTestLive, makeApplicationNativeMutationTestLayer } from "./applicationNativeMutationHarness";
import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const rows = (count: number) => Array.from({ length: count }, (_, ordinal) => ({ name: `row${ordinal.toString().padStart(3, "0")}` }));
const range = [{ op: "gte", field: "name", value: "row000" }];
const pageSchema = Schema.Struct({ page: Schema.Array(Schema.Struct({ _id: Schema.String, name: Schema.String })),
  isDone: Schema.Boolean, continueCursor: Schema.String });
const decodePage = Schema.decodeUnknownSync(pageSchema);

async function seed(fixture: ApplicationCoreMutationFixture, values: readonly DocumentObject[]) {
  const transaction = await runSystemTestEffectV1(fixture.database.begin());
  try {
    const ids: string[] = [];
    for (const value of values) ids.push(await runSystemTestEffectV1(transaction.insert("users", value)));
    await runSystemTestEffectV1(fixture.database.commit(await runSystemTestEffectV1(transaction.finalize())));
    return ids;
  } finally { await runSystemTestEffectV1(transaction.abort()); }
}

function invoke(layer: Awaited<ReturnType<typeof makeApplicationNativeMutationTestLayer>>, key: string, args: unknown) {
  return runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
    TransactionFunctionPathV1Schema.make("users:queryProbe"), args, TransactionRequestKeyV1Schema.make(key),
  ).pipe(Effect.provide(layer))));
}

export async function proveCoreApplicationQueryTerminals(fixture: ApplicationCoreMutationFixture) {
  const expected = rows(260).map(row => row.name);
  await seed(fixture, rows(260));
  const calls: Array<{ method: string; arguments: readonly unknown[] }> = [];
  const loader = new MiniflareApplicationWorkerLoader((method, args) => { calls.push({ method, arguments: structuredClone(args) }); });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const orders = [];
    for (const order of ["asc", "desc"] as const) {
      const collect = await invoke(layer, `query-terminals:${order}:collect`, { expressions: range, order, namesOnly: true });
      const take = await invoke(layer, `query-terminals:${order}:take`, { expressions: range, order, terminal: "take", count: 200, namesOnly: true });
      const page = decodePage((await invoke(layer, `query-terminals:${order}:page`, {
        expressions: range, order, terminal: "paginate", count: 200,
      })).value);
      const first = await invoke(layer, `query-terminals:${order}:first`, { expressions: range, order, terminal: "first" });
      const unique = await invoke(layer, `query-terminals:${order}:unique`, { expressions: [{ op: "eq", field: "name", value: "row117" }], order, terminal: "unique" });
      const nonunique = await invoke(layer, `query-terminals:${order}:nonunique`, { expressions: range, order, terminal: "unique", catch: true, id: fixture.documentId });
      orders.push({ order, collect: collect.value, take: take.value, page, first: first.value, unique: unique.value, nonunique: nonunique.value });
    }
    const fullScan = await invoke(layer, "query-terminals:full-scan", { index: null, terminal: "take", count: 2 });
    const zero = await invoke(layer, "query-terminals:zero", { terminal: "take", count: 0 });
    const largeTake = await invoke(layer, "query-terminals:large-take", { expressions: range, terminal: "take",
      count: CORE_TRANSACTION_REFERENCE_LIMITS.documentsRead + 1, namesOnly: true });
    const transaction = await runSystemTestEffectV1(fixture.database.begin());
    let creationTime;
    try {
      const document = Option.getOrNull(await runSystemTestEffectV1(transaction.get(fixture.documentId)));
      creationTime = Schema.decodeUnknownSync(Schema.Number)(document?._creationTime);
    } finally { await runSystemTestEffectV1(transaction.abort()); }
    const creation = await invoke(layer, "query-terminals:creation-time", { index: "by_creation_time", terminal: "unique",
      expressions: [{ op: "eq", field: "_creationTime", value: creationTime }] });
    return { expected, orders, fullScan: fullScan.value, zero: zero.value, largeTake: largeTake.value, creation: creation.value,
      documentId: fixture.documentId, calls, workerLoads: loader.loads,
      coldAnalysisLoads: fixture.coldAnalysisLoads, manifestFunctions: fixture.manifest.functions.map(fn => fn.path) };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationQueryPagination(fixture: ApplicationCoreMutationFixture) {
  const ids = await seed(fixture, rows(5));
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const first = decodePage((await invoke(layer, "query-pages:first", { expressions: range, terminal: "paginate", count: 2 })).value);
    const firstCursor = Result.getOrThrow(fixture.queryCursor.broker.decode(first.continueCursor));
    const foreign = Result.getOrThrow(createQueryCursorBroker({ instanceName: "another-signed-scope",
      deploymentSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }));
    const refusals = [];
    for (const [name, args] of [
      ["tamper", { cursor: first.continueCursor.slice(0, -1) + (first.continueCursor.endsWith("0") ? "1" : "0") }],
      ["order", { cursor: first.continueCursor, order: "desc" }],
      ["fingerprint", { cursor: first.continueCursor, expressions: [{ op: "gte", field: "name", value: "row001" }] }],
      ["instance", { cursor: foreign.encode(firstCursor) }],
      ["malformed", { expressions: [{ op: "eq", field: "name", value: "row000" }, { op: "eq", field: "name", value: "row001" }] }],
      ["missingIndex", { index: "does_not_exist" }],
      ["pageSize", { count: CORE_TRANSACTION_REFERENCE_LIMITS.documentsRead + 1 }],
    ] as const) refusals.push({ name, outcome: (await invoke(layer, `query-pages:refusal:${name}`, {
      expressions: range, terminal: "paginate", count: 2, catch: true, id: fixture.documentId, ...args,
    })).value });
    // A public cursor contains no row lookup or retained snapshot. Delete its
    // last yielded document and continue from the signed key after a cold open.
    const remove = await runSystemTestEffectV1(fixture.database.begin());
    try {
      const deleted = ids[1];
      if (deleted === undefined) throw new Error("Pagination seed is incomplete.");
      await runSystemTestEffectV1(remove.delete(deleted));
      await runSystemTestEffectV1(fixture.database.commit(await runSystemTestEffectV1(remove.finalize())));
    } finally { await runSystemTestEffectV1(remove.abort()); }
    const coldFixture = Object.freeze({ ...fixture, database: await fixture.reopen() });
    const coldLayer = await makeApplicationNativeMutationTestLayer(coldFixture, loader);
    const second = decodePage((await invoke(coldLayer, "query-pages:second", {
      expressions: range, terminal: "paginate", count: 3, cursor: first.continueCursor,
    })).value);
    const end = decodePage((await invoke(coldLayer, "query-pages:end", {
      expressions: range, terminal: "paginate", count: 1, cursor: second.continueCursor,
    })).value);
    const repeatedEnd = decodePage((await invoke(coldLayer, "query-pages:end-again", {
      expressions: range, terminal: "paginate", count: CORE_TRANSACTION_REFERENCE_LIMITS.documentsRead, cursor: end.continueCursor,
    })).value);
    const maximumPage = decodePage((await invoke(coldLayer, "query-pages:maximum-size", {
      expressions: range, terminal: "paginate", count: CORE_TRANSACTION_REFERENCE_LIMITS.documentsRead,
    })).value);
    const wrongLive = await makeApplicationMutationTestLive(coldFixture, loader);
    const invalidScope = makeApplicationMutationSystemLayer({ ...wrongLive,
      queryCursor: { ...wrongLive.queryCursor, scopeUuid: "45000000-0000-4000-8000-000000000099" } });
    const beforeWrongScope = loader.loads;
    const wrongScope = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:queryProbe"), { terminal: "first" },
      TransactionRequestKeyV1Schema.make("query-pages:wrong-broker-scope"),
    ).pipe(Effect.provide(invalidScope)))));
    return { first, second, end, repeatedEnd, maximumPage, refusals, wrongScope, wrongScopeWorkerLoads: loader.loads - beforeWrongScope,
      decodedPosition: firstCursor.position.kind, workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationQueryPendingAndDropped(fixture: ApplicationCoreMutationFixture) {
  const ids = await seed(fixture, rows(260));
  const calls: string[] = [];
  const pages: number[] = [];
  const loader = new MiniflareApplicationWorkerLoader(method => { calls.push(method); }, (method, _args, result) => {
    if (method !== "queryNext") return;
    const envelope = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("ok"), value: pageSchema }))(result);
    pages.push(envelope.value.page.length);
  });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const move = ids[0], deleted = ids[1];
    if (move === undefined || deleted === undefined) throw new Error("Pending query seed is incomplete.");
    const pending = await invoke(layer, "query-pending:changes", { expressions: range, namesOnly: true,
      patch: [{ id: move, value: { name: "row999" } }], delete: [deleted], insert: [{ name: "row000-new" }] });
    calls.length = 0;
    pages.length = 0;
    const dropped = await invoke(layer, "query-pending:dropped", { expressions: range, dropped: true });
    const droppedCalls = calls.splice(0), droppedPages = pages.splice(0);
    const late = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:queryProbe"), { expressions: range, dropped: true, late: true },
      TransactionRequestKeyV1Schema.make("query-pending:late-terminal"),
    ).pipe(Effect.provide(layer)))));
    return { pending: pending.value, dropped: dropped.value, calls: droppedCalls, pages: droppedPages,
      late, lateCalls: calls.slice(), latePages: pages.slice(), workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationQueryByteBudgets(fixture: ApplicationCoreMutationFixture) {
  await seed(fixture, rows(10).map(row => ({ ...row, padding: "p".repeat(900_000) })));
  const counts: number[] = [];
  const loader = new MiniflareApplicationWorkerLoader(undefined, (method, _args, result) => {
    if (method !== "queryNext") return;
    const envelope = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("ok"), value: pageSchema }))(result);
    counts.push(envelope.value.page.length);
  });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const collected = await invoke(layer, "query-bytes:collect", { expressions: range, namesOnly: true });
    const collectionPages = counts.splice(0);
    const outcome = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:queryProbe"), { expressions: range, repeat: 2, namesOnly: true, catch: true, id: fixture.documentId },
      TransactionRequestKeyV1Schema.make("query-bytes:shared-operation-limit"),
    ).pipe(Effect.provide(layer)))));
    const transaction = await runSystemTestEffectV1(fixture.database.begin());
    let document;
    try { document = Option.getOrNull(await runSystemTestEffectV1(transaction.get(fixture.documentId))); }
    finally { await runSystemTestEffectV1(transaction.abort()); }
    return { collected: collected.value, collectionPages, outcome, document, failedPages: counts, workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

/** Compact JSON can still exceed the Worker's semantic frame budget. */
export async function proveCoreApplicationQuerySemanticByteBudgets(fixture: ApplicationCoreMutationFixture) {
  const expected = rows(128).map(row => row.name);
  await seed(fixture, rows(128).map((row, ordinal) => ({ ...row,
    values: ordinal < 64 ? Array<number>(8192).fill(0)
      : Array.from({ length: 128 }, () => Array<number>(64).fill(0)),
  })));
  const pages: Array<Readonly<{ count: number; encodedBytes: number; semanticBytes: number; names: readonly string[] }>> = [];
  const loader = new MiniflareApplicationWorkerLoader(undefined, (method, _args, result) => {
    if (method !== "queryNext") return;
    const envelope = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("ok"), value: Schema.Unknown }))(result);
    const measured = normalizeFlarexValueV1(envelope.value);
    const page = decodePage(measured.value);
    pages.push(Object.freeze({ count: page.page.length, names: page.page.map(row => row.name),
      encodedBytes: Result.getOrThrow(encodeDocumentValue(result)).byteLength,
      semanticBytes: measured.semanticSizeBytes }));
  });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const terminals = [];
    for (const terminal of ["collect", "take", "paginate"] as const) {
      const outcome = await invoke(layer, `query-semantic-bytes:${terminal}`, {
        expressions: range, terminal, count: 128, countOnly: true,
      });
      terminals.push({ terminal, result: outcome.value, pages: pages.splice(0) });
    }
    return { expected, terminals, workerLoads: loader.loads, coldAnalysisLoads: fixture.coldAnalysisLoads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationMissingQueryBridge(fixture: ApplicationCoreMutationFixture) {
  const loader = new MiniflareApplicationWorkerLoader(undefined, undefined, true);
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const outcome = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:queryProbe"), { terminal: "first", catch: true, id: fixture.documentId },
      TransactionRequestKeyV1Schema.make("query-bridge:missing"),
    ).pipe(Effect.provide(layer)))));
    const transaction = await runSystemTestEffectV1(fixture.database.begin());
    try { return { outcome, document: Option.getOrNull(await runSystemTestEffectV1(transaction.get(fixture.documentId))),
      workerLoads: loader.loads, pointReads: loader.pointDocumentReads }; }
    finally { await runSystemTestEffectV1(transaction.abort()); }
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationQueryPageRevocation(fixture: ApplicationCoreMutationFixture) {
  await seed(fixture, rows(260));
  let requestedPages = 0;
  let completedPages = 0;
  const loader = new MiniflareApplicationWorkerLoader(async method => {
    if (method === "queryNext" && ++requestedPages === 2)
      await runSystemTestEffectV1(fixture.database.advanceAuthorityEpoch(2n));
  }, method => { if (method === "queryNext") completedPages += 1; });
  try {
    const layer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const outcome = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:queryProbe"), { expressions: range, catch: true, id: fixture.documentId,
        patch: [{ id: fixture.documentId, value: { name: "must rollback query" } }] },
      TransactionRequestKeyV1Schema.make("query-grant:revoked-between-pages"),
    ).pipe(Effect.provide(layer)))));
    const transaction = await runSystemTestEffectV1(fixture.database.begin());
    try { return { outcome, requestedPages, completedPages, workerLoads: loader.loads,
      document: Option.getOrNull(await runSystemTestEffectV1(transaction.get(fixture.documentId))) }; }
    finally { await runSystemTestEffectV1(transaction.abort()); }
  } finally { await loader.dispose(); }
}
