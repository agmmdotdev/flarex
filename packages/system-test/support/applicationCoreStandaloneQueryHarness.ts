import { defineModule, query, sourceModule, v } from "@flarex/application-definition";
import { runQuery } from "@flarex/application-invocation";
import { type CoreDatabase, type CoreReadToken } from "@flarex/persistence-postgres/internal/core";
import type { ApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { CORE_APPLICATION_COMPATIBILITY_DATE, CORE_APPLICATION_EPOCH_UUID, CORE_APPLICATION_SCOPE_UUID } from
  "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { captureCoreApplicationProgramProfile, makeCoreApplicationPrograms } from "@flarex/persistence-postgres/internal/core-application-program";
import { createApplicationNativeMutationSourceBundle } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { invokeApplicationQuery, makeApplicationQuerySystemLayer } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { invokeApplicationMutation, makeApplicationMutationSystemLayer } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { Effect, Fiber, Result, Schema } from "effect";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { makeApplicationMutationTestLive } from "./applicationNativeMutationHarness";
import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";
import { createCoreApplicationDefinition } from "./applicationCoreDefinition";

const typedModule = defineModule({ path: "users",
  source: sourceModule({ path: "functions/users.js", bytes: new TextEncoder().encode("export {};\n") }),
  functions: { typedQuery: query({ args: v.object({ id: v.string(), invalidReturn: v.optional(v.boolean()) }),
    returns: v.union(v.null(), v.string()) }),
    queryIdentity: query({ args: v.object({ nested: v.optional(v.boolean()) }), returns: v.any() }) },
});
const typedReference = typedModule.reference("typedQuery");
const mismatchedReference = defineModule({ path: "users",
  source: sourceModule({ path: "functions/users.js", bytes: new TextEncoder().encode("export {};\n") }),
  functions: { typedQuery: query({ args: v.object({ id: v.string() }), returns: v.boolean() }) },
}).reference("typedQuery");
const document = Schema.Struct({ _id: Schema.String, name: Schema.String });
const capabilities = Schema.Struct({ methods: Schema.Record(Schema.String, Schema.String), mutationRefused: Schema.Boolean });
const decodeSnapshot = Schema.decodeUnknownSync(Schema.Struct({ first: document, child: document, second: document,
  now: Schema.Number, later: Schema.Number, capabilities }));
const decodePage = Schema.decodeUnknownSync(Schema.Struct({ page: Schema.Array(document), isDone: Schema.Boolean,
  continueCursor: Schema.String }));

/** Observe the owner's completion token without reproducing query/dependency logic. */
function observeReads(database: CoreDatabase, tokens: CoreReadToken[]): CoreDatabase {
  return Object.freeze({ ...database,
    beginQuery: (...input: Parameters<CoreDatabase["beginQuery"]>) => database.beginQuery(...input).pipe(Effect.map(operation => Object.freeze({ ...operation,
      finish: () => operation.finish().pipe(Effect.tap(token => Effect.sync(() => { tokens.push(token); }))),
    }))),
  });
}

async function queryLayer(fixture: ApplicationCoreFixture, loader: MiniflareApplicationWorkerLoader,
  tokens: CoreReadToken[] = []) {
  const live = await makeApplicationMutationTestLive(fixture, loader);
  return makeApplicationQuerySystemLayer({ coreDatabase: observeReads(fixture.database, tokens), admission: live.admission,
    applicationRunner: live.applicationRunner, executionContextFactory: live.executionContextFactory,
    queryCursor: live.queryCursor });
}

function invoke(layer: Awaited<ReturnType<typeof queryLayer>>, path: string, args: unknown) {
  return runSystemTestEffectV1(Effect.scoped(invokeApplicationQuery(path, args).pipe(Effect.provide(layer))));
}

export async function proveCoreApplicationStandalonePublicQuery(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  const tokens: CoreReadToken[] = [];
  try {
    const layer = await queryLayer(fixture, loader, tokens);
    const before = { durable: await fixture.durableState(), timestamp: await runSystemTestEffectV1(fixture.database.publishedTimestamp),
      history: await fixture.history() };
    const value = await runSystemTestEffectV1(runQuery(typedReference, { id: fixture.documentId }).pipe(Effect.provide(layer)));
    const invalidArguments = await runSystemTestEffectV1(Effect.scoped(Effect.exit(
      invokeApplicationQuery("users:typedQuery", { id: 42 }).pipe(Effect.provide(layer)))));
    const internal = await runSystemTestEffectV1(Effect.scoped(Effect.exit(
      invokeApplicationQuery("users:getInternal", { id: fixture.documentId }).pipe(Effect.provide(layer)))));
    const mutation = await runSystemTestEffectV1(Effect.scoped(Effect.exit(
      invokeApplicationQuery("users:create", { name: "must never publish" }).pipe(Effect.provide(layer)))));
    const beforeReturnFailures = loader.loads;
    const serverReturn = await runSystemTestEffectV1(Effect.exit(runQuery(typedReference,
      { id: fixture.documentId, invalidReturn: true }).pipe(Effect.provide(layer))));
    const clientReturn = await runSystemTestEffectV1(Effect.exit(runQuery(mismatchedReference,
      { id: fixture.documentId }).pipe(Effect.provide(layer))));
    const capability = Schema.decodeUnknownSync(capabilities)(await invoke(layer, "users:queryCapabilities", {}));
    const anonymous = await runSystemTestEffectV1(runQuery(typedModule.reference("queryIdentity"), {}).pipe(Effect.provide(layer)));
    const after = { durable: await fixture.durableState(), timestamp: await runSystemTestEffectV1(fixture.database.publishedTimestamp),
      history: await fixture.history() };
    return { value, invalidArguments, internal, mutation, serverReturn, clientReturn, capability, anonymous,
      before, after, tokens, beforeReturnFailures, workerLoads: loader.loads, coldAnalysisLoads: fixture.coldAnalysisLoads,
      functions: fixture.manifest.functions.map(fn => ({ path: fn.path, kind: fn.kind, visibility: fn.visibility })) };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationStandaloneIdentity(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const layer = await queryLayer(fixture, loader);
    const identity = { kind: "user", user: { tokenIdentifier: "https://identity.test|subject",
      subject: "subject", issuer: "https://identity.test", name: "Ada", roles: ["member"] } } as const;
    const result = await runSystemTestEffectV1(runQuery(typedModule.reference("queryIdentity"), { nested: true }, { identity })
      .pipe(Effect.provide(layer)));
    return { result, identity, workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

/** Exercise trusted routing pins against the real selected programs before any request authority. */
export async function proveCoreApplicationConfiguredProgramProfile(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  let sourceReads = 0, claims = 0, grants = 0;
  try {
    const original = await makeApplicationMutationTestLive(fixture, loader);
    const database: CoreDatabase = Object.freeze({ ...fixture.database,
      claimRequest: (...args: Parameters<CoreDatabase["claimRequest"]>) => Effect.suspend(() => {
        claims++;
        return fixture.database.claimRequest(...args);
      }),
    });
    const base = Result.getOrThrow(captureCoreApplicationProgramProfile({ scopeUuid: CORE_APPLICATION_SCOPE_UUID,
      epochUuid: CORE_APPLICATION_EPOCH_UUID, sourceArtifactRootSha256: fixture.source.sourceArtifact.rootSha256 }));
    const profiles = [
      { name: "scope", expected: Result.getOrThrow(captureCoreApplicationProgramProfile({ ...base,
        scopeUuid: "45000000-0000-4000-8000-000000000003" })) },
      { name: "epoch", expected: Result.getOrThrow(captureCoreApplicationProgramProfile({ ...base,
        epochUuid: "45000000-0000-4000-8000-000000000004" })) },
      { name: "source", expected: { ...base, sourceArtifactRootSha256: "ff".repeat(32) } },
      { name: "invalid", expected: { ...base, sourceArtifactRootSha256: "invalid" } },
    ];
    const before = { durable: await fixture.durableState(), timestamp: await runSystemTestEffectV1(fixture.database.publishedTimestamp) };
    const results = [];
    for (const profile of profiles) {
      const live = { ...original, coreDatabase: database, expectedProgramProfile: profile.expected,
        applicationRunner: { ...original.applicationRunner, source: {
          read: (root: string) => Effect.suspend(() => { sourceReads++; return original.applicationRunner.source.read(root); }),
        } },
        grantIssuer: { ...original.grantIssuer, issue: (...args: Parameters<typeof original.grantIssuer.issue>) =>
          Effect.suspend(() => { grants++; return original.grantIssuer.issue(...args); }) },
      };
      const query = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationQuery("users:get",
        { id: fixture.documentId }).pipe(Effect.provide(makeApplicationQuerySystemLayer(live))))));
      const mutation = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationMutation(
        TransactionFunctionPathV1Schema.make("users:create"), { name: "must refuse" },
        TransactionRequestKeyV1Schema.make(`configured-profile:${profile.name}`),
      ).pipe(Effect.provide(makeApplicationMutationSystemLayer(live))))));
      results.push({ name: profile.name, query, mutation });
    }
    const after = { durable: await fixture.durableState(), timestamp: await runSystemTestEffectV1(fixture.database.publishedTimestamp) };
    return { results, before, after, sourceReads, claims, grants, workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationStandaloneSnapshot(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  const tokens: CoreReadToken[] = [];
  try {
    const layer = await queryLayer(fixture, loader, tokens);
    const block = loader.blockNextInvocation();
    const held = invoke(layer, "users:snapshotQuery", { id: fixture.documentId });
    let publication;
    try {
      await block.started;
      const mutationLayer = makeApplicationMutationSystemLayer(await makeApplicationMutationTestLive(fixture, loader));
      publication = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
        TransactionFunctionPathV1Schema.make("users:patchThroughInternal"), { id: fixture.documentId, fail: false },
        TransactionRequestKeyV1Schema.make("standalone-query:snapshot-race"),
      ).pipe(Effect.provide(mutationLayer))));
      await fixture.advanceProgramHead();
    } finally { block.release(); }
    const old = decodeSnapshot(await held);
    const next = decodeSnapshot(await invoke(layer, "users:snapshotQuery", { id: fixture.documentId }));
    const coldFixture = Object.freeze({ ...fixture, database: await fixture.reopen() });
    const cold = await runSystemTestEffectV1(runQuery(typedReference, { id: fixture.documentId }).pipe(
      Effect.provide(await queryLayer(coldFixture, loader))));
    return { publication, old, next, cold, tokens, initialTimestamp: fixture.initialTimestamp, workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationNestedReadonly(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    let beginCount = 0, queryBeginCount = 0;
    const database: CoreDatabase = Object.freeze({ ...fixture.database,
      begin: (options: Parameters<CoreDatabase["begin"]>[0]) => Effect.suspend(() => {
        beginCount += 1;
        return fixture.database.begin(options);
      }),
      beginQuery: (...input: Parameters<CoreDatabase["beginQuery"]>) => Effect.suspend(() => {
        queryBeginCount += 1; return fixture.database.beginQuery(...input);
      }),
    });
    const layer = makeApplicationMutationSystemLayer(await makeApplicationMutationTestLive({ ...fixture, database }, loader));
    const result = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:mutationReadsQuery"), { id: fixture.documentId },
      TransactionRequestKeyV1Schema.make("standalone-query:parent-pending"),
    ).pipe(Effect.provide(layer))));
    const snapshot = decodeSnapshot(result.value);
    const current = await runSystemTestEffectV1(runQuery(typedReference, { id: fixture.documentId }).pipe(
      Effect.provide(await queryLayer(fixture, loader))));
    return { result, snapshot, current, history: await fixture.history(), workerLoads: loader.loads, beginCount, queryBeginCount };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationStandaloneTerminals(fixture: ApplicationCoreFixture) {
  const calls: string[] = [];
  const tokens: CoreReadToken[] = [];
  const loader = new MiniflareApplicationWorkerLoader(method => { calls.push(method); });
  try {
    // Seed through the same supported owner, before measuring read completion.
    const transaction = await runSystemTestEffectV1(fixture.database.begin());
    try {
      for (let ordinal = 0; ordinal < 260; ordinal++) await runSystemTestEffectV1(transaction.insert("users",
        { name: `row${ordinal.toString().padStart(3, "0")}` }));
      await runSystemTestEffectV1(fixture.database.commit(await runSystemTestEffectV1(transaction.finalize())));
    } finally { await runSystemTestEffectV1(transaction.abort()); }
    const layer = await queryLayer(fixture, loader, tokens);
    const before = await fixture.durableState();
    const args = { expressions: [{ op: "gte", field: "name", value: "row000" }], namesOnly: true };
    const collected = await invoke(layer, "users:standaloneQuery", args);
    const taken = await invoke(layer, "users:standaloneQuery", { ...args, terminal: "take", count: 2 });
    const first = await invoke(layer, "users:standaloneQuery", { ...args, terminal: "first" });
    const unique = await invoke(layer, "users:standaloneQuery", {
      expressions: [{ op: "eq", field: "name", value: "row117" }], terminal: "unique" });
    const page = decodePage(await invoke(layer, "users:standaloneQuery", { ...args, terminal: "paginate", count: 2 }));
    const dropped = await invoke(layer, "users:standaloneQuery", { ...args, dropped: true });
    const late = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationQuery("users:standaloneQuery",
      { ...args, dropped: true, late: true }).pipe(Effect.provide(layer)))));
    const after = await fixture.durableState();
    const coldFixture = Object.freeze({ ...fixture, database: await fixture.reopen() });
    const nextPage = decodePage(await invoke(await queryLayer(coldFixture, loader), "users:standaloneQuery",
      { ...args, terminal: "paginate", count: 3, cursor: page.continueCursor }));
    return { collected, taken, first, unique, page, nextPage, dropped, late, before, after, tokens, calls,
      workerLoads: loader.loads };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationStandaloneCancelled(fixture: ApplicationCoreFixture) {
  const loader = new MiniflareApplicationWorkerLoader();
  try {
    const tokens: CoreReadToken[] = [];
    const layer = await queryLayer(fixture, loader, tokens);
    const before = await fixture.durableState();
    const block = loader.blockNextInvocation();
    const fiber = Effect.runFork(Effect.scoped(invokeApplicationQuery("users:snapshotQuery", { id: fixture.documentId })
      .pipe(Effect.provide(layer))));
    await block.started;
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
    block.release();
    await interrupted;
    const outcome = await Effect.runPromise(Fiber.await(fiber));
    const after = await fixture.durableState();
    const next = await runSystemTestEffectV1(runQuery(typedReference, { id: fixture.documentId }).pipe(Effect.provide(layer)));
    return { outcome, before, after, next, completedTokens: tokens.length };
  } finally { await loader.dispose(); }
}

export async function proveCoreApplicationStandaloneMetadata(fixture: ApplicationCoreFixture) {
  const nextDefinition = await createCoreApplicationDefinition(await createApplicationNativeMutationSourceBundle(
    false, 0, 0, true, false, false, true, true, true));
  const loader = new MiniflareApplicationWorkerLoader();
  const tokens: CoreReadToken[] = [];
  try {
    const live = await makeApplicationMutationTestLive(fixture, loader, { source: { read: root => {
      const definition = [fixture, nextDefinition].find(candidate => candidate.source.sourceArtifact.rootSha256 === root);
      return definition === undefined ? Effect.die("Metadata query selected a foreign source root") : Effect.succeed(definition.source);
    } } });
    const layer = makeApplicationQuerySystemLayer({ coreDatabase: observeReads(fixture.database, tokens), admission: live.admission,
      applicationRunner: live.applicationRunner, executionContextFactory: live.executionContextFactory, queryCursor: live.queryCursor });
    const block = loader.blockNextInvocation();
    const held = runSystemTestEffectV1(runQuery(typedReference, { id: fixture.documentId }).pipe(Effect.provide(layer)));
    try {
      await block.started;
      const programs = await runSystemTestEffectV1(makeCoreApplicationPrograms({ manifest: nextDefinition.manifest,
        scopeUuid: CORE_APPLICATION_SCOPE_UUID, epochUuid: CORE_APPLICATION_EPOCH_UUID,
        compatibilityDate: CORE_APPLICATION_COMPATIBILITY_DATE, generation: 2,
        sha256: bytes => Effect.promise(async () => new Uint8Array(await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)))),
      }));
      await runSystemTestEffectV1(fixture.database.publishPrograms({ programs }));
    } finally { block.release(); }
    const old = await held;
    const badArguments = await runSystemTestEffectV1(Effect.scoped(Effect.exit(invokeApplicationQuery("users:typedQuery",
      { id: fixture.documentId }).pipe(Effect.provide(layer)))));
    const next = await invoke(layer, "users:typedQuery", { id: fixture.documentId, revision: "next" });
    return { old, next, badArguments, tokens, workerLoads: loader.loads,
      roots: loader.revisionIds, coldAnalysisLoads: nextDefinition.coldAnalysisLoads };
  } finally { await loader.dispose(); }
}
