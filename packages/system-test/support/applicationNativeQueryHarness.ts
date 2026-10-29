/// <reference types="@cloudflare/workers-types" />

import {
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { runQuery } from "@flarex/application-invocation";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from
  "@flarex/persistence-postgres/internal/execution-diagnostics";
import { InvalidAppIndexEntryInputError } from
  "@flarex/persistence-postgres/internal/app-index-entry-errors";
import { invokeApplicationMutation } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { appDocumentIdV1FromRowIdentity } from
  "flarex-protocol/app-document-id";
import { appOrderedIndexDocumentPathV1, compileAppOrderedIndexBoundsV1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1, orderedIndexValueFromFlarexValueV1 } from
  "flarex-protocol/ordered-index";
import { decodeSchemaManifestAppDeveloperOrderedIndexSpecV1, decodeSchemaManifestAppIndexFieldPath } from
  "flarex-protocol/schema-manifest";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";
import {
  makeApplicationQuerySystemLayer,
  type ApplicationQuerySystemLive,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { Cause, Effect, Exit, Result, Tracer } from "effect";
import { ApplicationExecutionHostError, makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import { ApplicationAnalysisSourceReadError } from
  "flarex-backend/internal/application-analysis-source-reader";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { Miniflare } from "miniflare";
import {
  decodeSystemTestStructuredCloneBridgeValueV1,
  encodeSystemTestStructuredCloneBridgeValueV1,
  SYSTEM_TEST_STRUCTURED_CLONE_BRIDGE_WORKER_SOURCE_V1,
} from "./systemTestStructuredCloneBridgeV1";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

import {
  USERS_GET_REFERENCE, USERS_GET_MISMATCH_REFERENCE,
  USERS_CACHE_REFERENCE, USERS_CACHE_MISMATCH_REFERENCE,
  CACHE_ROW_A, CACHE_ROW_B, CACHE_ROW_C, CACHE_ROW_MISSING,
  APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
} from "./applicationNativeQueryDefinitions";
const COMPATIBILITY_DATE = APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS.compatibilityDate;
export type ApplicationNativeQueryFixtureFactory = (profile?: "cacheProbe") => Promise<
  ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
>;

export interface ApplicationNativeQueryProof {
  readonly result: Readonly<{
    readonly name: string;
  }>;
  readonly freshWorkerLoads: 2;
  readonly snapshotRevalidations: 2;
  readonly pointDocumentReads: 2;
  readonly sourceReads: 2;
  readonly headMovementSelectedNewRevision: true;
}

export interface ApplicationNativeQueryTestFixture {
  readonly deploymentId: string;
  readonly activation: ApplicationQuerySystemLive["activation"];
  readonly control: Readonly<{
    readonly drizzle: ApplicationQuerySystemLive["snapshot"]["controlDb"];
  }>;
  readonly authorityPorts: ApplicationQuerySystemLive["snapshot"]["authority"];
  readonly schema: ApplicationQuerySystemLive["snapshot"]["schema"];
  readonly relationSchema?: ApplicationQuerySystemLive["snapshot"][
    "relationSchema"
  ];
  readonly relationReads?: ApplicationQuerySystemLive["snapshot"]["relations"];
  readonly developerIndexes: ApplicationQuerySystemLive["snapshot"][
    "developerIndexes"
  ];
  readonly source: ApplicationNativeMutationFixture<
    ApplicationNativeMutationPersistence
  >["source"];
}

export function makeApplicationNativeQueryTestLayer(
  fixture: ApplicationNativeQueryTestFixture,
  loader: WorkerLoader,
  onExecution: () => void = () => undefined,
) {
  let executionSequence = 0;
  return makeApplicationQuerySystemLayer({
    activation: fixture.activation,
    snapshot: {
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
      schema: fixture.schema,
      ...(fixture.relationSchema === undefined
        ? {}
        : { relationSchema: fixture.relationSchema }),
      ...(fixture.relationReads === undefined
        ? {}
        : { relations: fixture.relationReads }),
      developerIndexes: fixture.developerIndexes,
    },
    snapshotBudget: Object.freeze({
      maximumPointReads: 16,
      maximumIndexReads: 16,
      maximumDocuments: 64,
      maximumSemanticBytes: 1_048_576,
    }),
    source: Object.freeze({
      read: (rootSha256: string) =>
        rootSha256 === fixture.source.sourceArtifact.rootSha256
          ? Effect.succeed(fixture.source)
          : Effect.fail(new ApplicationAnalysisSourceReadError({
            operation: "read",
            reason: "invalidRoot",
          })),
    }),
    host: makeApplicationExecutionHost(loader),
    executionContextFactory: () => {
      executionSequence += 1;
      onExecution();
      return Object.freeze({
        executionId: `standard-application-query-${executionSequence}`,
        randomSeed: new Uint8Array(32).fill(executionSequence),
        executionTime: 1_800_000_000_000 + executionSequence,
      });
    },
  });
}

export async function proveApplicationNativeQuery(
  createFixture: ApplicationNativeQueryFixtureFactory,
): Promise<ApplicationNativeQueryProof> {
  const fixture = await createFixture();
  const seeded = await fixture.seedUserDocument("Ada");
  const loader = new MiniflareApplicationWorkerLoader();
  let sourceReads = 0;
  let executionSequence = 0;
  const layer = makeApplicationQuerySystemLayer({
    activation: fixture.activation,
    snapshot: {
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
      schema: fixture.schema,
      developerIndexes: fixture.developerIndexes,
    },
    snapshotBudget: Object.freeze({
      maximumPointReads: 16,
      maximumIndexReads: 16,
      maximumDocuments: 64,
      maximumSemanticBytes: 1_048_576,
    }),
    source: Object.freeze({
      read: (rootSha256: string) => {
        sourceReads += 1;
        return rootSha256 === fixture.source.sourceArtifact.rootSha256
          ? Effect.succeed(fixture.source)
          : Effect.fail(new ApplicationAnalysisSourceReadError({
            operation: "read",
            reason: "invalidRoot",
          }));
      },
    }),
    host: makeApplicationExecutionHost(loader),
    executionContextFactory: () => {
      executionSequence += 1;
      return Object.freeze({
        executionId: `application-query-${executionSequence}`,
        randomSeed: new Uint8Array(32).fill(executionSequence),
        executionTime: 1_800_000_000_000 + executionSequence,
      });
    },
  });
  const invoke = () => runSystemTestEffectV1(
    runQuery(
      USERS_GET_REFERENCE,
      { id: seeded.documentId },
    ).pipe(Effect.provide(layer)),
  );
  const invokeMismatch = () => runSystemTestEffectV1(Effect.scoped(
    runQuery(
      USERS_GET_MISMATCH_REFERENCE,
      { id: seeded.documentId },
    ).pipe(
      Effect.provide(layer),
      Effect.flip,
    ),
  ));
  try {
    const result = requireQueryResult(await invoke());
    if (result.name !== seeded.name) {
      throw new Error("Application query did not return the stored document.");
    }
    await fixture.moveHead();
    const mismatch = await invokeMismatch();
    if (
      !isRecord(mismatch) ||
      mismatch._tag !== "ApplicationResultContractError" ||
      mismatch.operation !== "query"
    ) {
      throw new Error("Application query accepted a mismatched local result contract.");
    }
    if (
      loader.revisionIds.length !== 2 ||
      loader.revisionIds[0] === loader.revisionIds[1]
    ) {
      throw new Error("Application query did not select the replacement head.");
    }
    if (
      loader.loads !== 2 || loader.revalidations !== 2 ||
      loader.pointDocumentReads !== 2 || sourceReads !== 2
    ) {
      throw new Error("Application query proof observed an unexpected call count.");
    }
    if (loader.documentIds.some(documentId => documentId !== seeded.documentId)) {
      throw new Error("Application query read an unexpected document identity.");
    }
    return Object.freeze({
      result,
      freshWorkerLoads: 2,
      snapshotRevalidations: 2,
      pointDocumentReads: 2,
      sourceReads: 2,
      headMovementSelectedNewRevision: true,
    });
  } finally {
    await loader.dispose();
  }
}

export interface ApplicationNativeQueryDataReadObservation {
  readonly method: "readPointDocument" | "queryIndexRange";
  readonly ordinal: number;
  readonly rowSnapshotReads: number;
  readonly indexSnapshotReads: number;
}

type MutableQueryDataReadObservation = {
  -readonly [Field in keyof ApplicationNativeQueryDataReadObservation]: ApplicationNativeQueryDataReadObservation[Field];
};

/** Genuine Worker source exercises storage reuse; RPC counts remain logical calls. */
export async function proveApplicationNativeQueryCache(createFixture: ApplicationNativeQueryFixtureFactory) {
  const fixture = await createFixture("cacheProbe");
  const table = fixture.schemaAuthority.tables.find(candidate => candidate.logicalName === "users");
  if (table === undefined) throw new Error("Application cache probe users table is missing.");
  const documentId = (rowId: typeof CACHE_ROW_A) => appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
  const args = Object.freeze({
    repeatId: documentId(CACHE_ROW_C),
    missingId: documentId(CACHE_ROW_MISSING),
    suffixId: documentId(CACHE_ROW_B),
    bounds: compileAppOrderedIndexBoundsV1({
      spec: lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
        kind: "developerOrdered", specVersion: 1, fields: ["name"],
      })),
      expressions: [{ op: "eq", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("name")),
        value: orderedIndexValueFromFlarexValueV1("Ada") }],
    }),
  });
  let current: MutableQueryDataReadObservation | undefined;
  let observations: MutableQueryDataReadObservation[] = [];
  let indexTransactionSpans: Tracer.NativeSpan[] = [];
  let observing = false;
  let refreshRowSnapshotReads = 0;
  let refreshCaptures = 0;
  const loader = new MiniflareApplicationWorkerLoader(method => {
    current = undefined;
    if (!observing || (method !== "readPointDocument" && method !== "queryIndexRange")) return;
    current = { method, ordinal: observations.filter(item => item.method === method).length + 1,
      rowSnapshotReads: 0, indexSnapshotReads: 0 };
    observations.push(current);
  });
  const tracer = Tracer.make({ span(options) {
    if (observing && options.name === "AppRows.captureSnapshotRead") {
      if (current === undefined) refreshRowSnapshotReads++;
      else current.rowSnapshotReads++;
    }
    if (observing && options.name === "ApplicationQueryCache.captureRefresh") refreshCaptures++;
    const span = new Tracer.NativeSpan(options);
    if (options.name === "ApplicationQuerySnapshot.readIndexInTransaction") indexTransactionSpans.push(span);
    return span;
  } });
  const diagnostics: ExecutionDiagnosticPolicy = {
    observe(name, work) {
      if (current !== undefined && name === "AppIndexEntries.scanAtSnapshotInTransaction") current.indexSnapshotReads++;
      return work;
    },
  };
  const layer = makeApplicationNativeQueryTestLayer(fixture, loader);
  const invoke = async () => {
    observations = [];
    refreshRowSnapshotReads = 0;
    refreshCaptures = 0;
    current = undefined;
    observing = true;
    const before = loader.loads;
    try {
      const value = await runSystemTestEffectV1(runQuery(USERS_CACHE_REFERENCE, args).pipe(
        Effect.provide(layer), Effect.provideService(Tracer.Tracer, tracer),
        Effect.provideService(ExecutionDiagnostics, diagnostics),
      ));
      return Object.freeze({ value, workerLoads: loader.loads - before, refreshRowSnapshotReads, refreshCaptures,
        reads: Object.freeze(observations.map(item => Object.freeze({ ...item }))) });
    } finally {
      observing = false;
      current = undefined;
    }
  };
  const invokeInvertedBounds = async (mode: "cold" | "warm") => {
    observations = [];
    indexTransactionSpans = [];
    current = undefined;
    observing = true;
    const before = loader.loads;
    try {
      const outcome = await runSystemTestEffectV1(Effect.scoped(runQuery(USERS_CACHE_REFERENCE,
        { ...args, invertedBounds: mode }).pipe(
          Effect.provide(layer), Effect.provideService(Tracer.Tracer, tracer),
          Effect.provideService(ExecutionDiagnostics, diagnostics), Effect.result,
        )));
      // The Worker projects its boundary failure; the existing storage span
      // retains the precise typed cause so unrelated failures cannot pass.
      const refused = Result.match(outcome, {
        onFailure: error => error._tag === "QueryInvocationError" &&
          error.cause instanceof ApplicationExecutionHostError && error.cause.reason === "readBoundaryFailed",
        onSuccess: () => false,
      });
      const invalidBoundsFailures = indexTransactionSpans.filter(span => span.status._tag === "Ended" &&
        Exit.isFailure(span.status.exit) && span.status.exit.cause.reasons.some(reason =>
          Cause.isFailReason(reason) && reason.error instanceof InvalidAppIndexEntryInputError &&
          reason.error.issue === "invalidBounds")).length;
      return Object.freeze({ refused, invalidBoundsFailures, workerLoads: loader.loads - before,
        reads: Object.freeze(observations.map(item => Object.freeze({ ...item }))) });
    } finally {
      observing = false;
      current = undefined;
    }
  };
  const invokeCaughtMismatch = async () => {
    const before = loader.loads;
    const error = await runSystemTestEffectV1(Effect.scoped(runQuery(USERS_CACHE_MISMATCH_REFERENCE, args).pipe(
      Effect.provide(layer), Effect.flip,
    )));
    return Object.freeze({ error, workerLoads: loader.loads - before });
  };
  try {
    const coldInvertedBounds = await invokeInvertedBounds("cold");
    const warmInvertedBounds = await invokeInvertedBounds("warm");
    const first = await invoke();
    const unchanged = await invoke();
    const caughtMismatch = await invokeCaughtMismatch();
    const afterCaughtMismatch = await invoke();
    const { makeApplicationNativeMutationTestLayer } = await import("./applicationNativeMutationHarness");
    const mutationLayer = await makeApplicationNativeMutationTestLayer(fixture, loader);
    const touched = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:renameCacheProbe"),
      { id: args.repeatId, name: "Bea", padding: "same-key refreshed body" },
      TransactionRequestKeyV1Schema.make("application-native-query-cache:body"),
    ).pipe(Effect.provide(mutationLayer))));
    if (touched.disposition !== "published") throw new Error("Application cache body patch did not publish.");
    const sameKey = await invoke();
    const renamed = await runSystemTestEffectV1(Effect.scoped(invokeApplicationMutation(
      TransactionFunctionPathV1Schema.make("users:renameCacheProbe"),
      { id: args.repeatId, name: "Cyra" },
      TransactionRequestKeyV1Schema.make("application-native-query-cache:rename"),
    ).pipe(Effect.provide(mutationLayer))));
    if (renamed.disposition !== "published") throw new Error("Application cache probe patch did not publish.");
    const next = await invoke();
    return Object.freeze({ first, unchanged, caughtMismatch, afterCaughtMismatch, sameKey, next, coldInvertedBounds, warmInvertedBounds,
      ids: Object.freeze({ first: documentId(CACHE_ROW_A), second: args.suffixId,
      changed: args.repeatId, missing: args.missingId }), mutationCommitSeq: renamed.commitSeq });
  } finally {
    await loader.dispose();
  }
}

type ApplicationWorkerRuntime = Pick<Miniflare, "dispose">;

export class MiniflareApplicationWorkerLoader implements WorkerLoader {
  loads = 0;
  revalidations = 0;
  pointDocumentReads = 0;
  incomingRelationReads = 0;
  readonly revisionIds: string[] = [];
  readonly documentIds: string[] = [];
  readonly #runtimes = new Set<ApplicationWorkerRuntime>();
  readonly #disposals: Array<Promise<PromiseSettledResult<void>[]>> = [];
  #nextInvocationBlock: InvocationBlock | undefined;

  constructor(private readonly onCapability: (method: string, argumentsValue: readonly unknown[]) => void | Promise<void> = () => undefined) {}

  blockNextInvocation(): Readonly<{
    readonly started: Promise<void>;
    readonly release: () => void;
  }> {
    if (this.#nextInvocationBlock !== undefined) {
      throw new Error("Application Worker invocation block is already armed.");
    }
    const started = deferred<void>();
    const released = deferred<void>();
    this.#nextInvocationBlock = Object.freeze({ started, released });
    return Object.freeze({
      started: started.promise,
      release: () => released.resolve(),
    });
  }

  get(
    _name: string | null,
    _getCode: () => WorkerLoaderWorkerCode | Promise<WorkerLoaderWorkerCode>,
  ): WorkerStub {
    throw new Error("Application system test forbids cached Worker loading.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareApplicationWorkerStub(this, code);
  }

  async observeCapability(method: string, argumentsValue: readonly unknown[]): Promise<void> {
    await this.onCapability(method, argumentsValue);
    if (method === "revalidate") this.revalidations += 1;
    if (method === "takeIncomingRelationSources") this.incomingRelationReads += 1;
    if (method !== "readPointDocument") return;
    this.pointDocumentReads += 1;
    const documentId = argumentsValue[1];
    if (typeof documentId !== "string") {
      throw new Error("Application Worker supplied an invalid document ID.");
    }
    this.documentIds.push(documentId);
  }

  attach(runtime: ApplicationWorkerRuntime): void {
    this.#runtimes.add(runtime);
  }

  release(runtime: ApplicationWorkerRuntime): void {
    if (!this.#runtimes.delete(runtime)) return;
    // Host result release starts cleanup before its caller can join it. Capture
    // rejection now, retain the failure, and let dispose drain every runtime.
    this.#disposals.push(Promise.allSettled([runtime.dispose()]));
  }

  async waitForNextInvocationBlock(): Promise<void> {
    const block = this.#nextInvocationBlock;
    if (block === undefined) return;
    this.#nextInvocationBlock = undefined;
    block.started.resolve();
    await block.released.promise;
  }

  async dispose(): Promise<void> {
    for (const runtime of this.#runtimes) this.release(runtime);
    const settlements = await Promise.all(this.#disposals.splice(0));
    const failures: unknown[] = [];
    for (const result of settlements.flat()) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Application Worker runtime disposal failed.");
    }
  }
}

class MiniflareApplicationWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: MiniflareApplicationWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    const entrypoint = {
      run: (request: unknown, capability: object) =>
        this.run(name, request, capability),
      fetch: async () => new Response(null, { status: 501 }),
      connect: () => {
        throw new Error("Application system test forbids sockets.");
      },
    };
    // SAFETY: the test adapter implements the exact run RPC used by the host
    // plus the Fetcher surface required by Cloudflare's branded declaration.
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application system test forbids Durable Objects.");
  }

  private async run(
    name: string | undefined,
    request: unknown,
    capability: object,
  ): Promise<unknown> {
    if (name === undefined) {
      throw new Error("Application Worker entrypoint was not selected.");
    }
    this.owner.revisionIds.push(requireNestedString(request, "target", "revisionId"));
    await this.owner.waitForNextInvocationBlock();
    const globalOutbound = this.code.globalOutbound;
    const runtime = new Miniflare({
      compatibilityDate: COMPATIBILITY_DATE,
      modules: true,
      script: applicationWorkerBridgeSource(this.code, name),
      workerLoaders: { LOADER: {} },
      serviceBindings: {
        CAPABILITY: (input: Request) => invokeCapability(
          input,
          capability,
          (method, argumentsValue) =>
            this.owner.observeCapability(method, argumentsValue),
        ),
        ...(globalOutbound == null
          ? {}
          : {
              GLOBAL_OUTBOUND: async (request: Request) =>
                globalOutbound.fetch(await copyMiniflareRequestV1(request)),
            }),
      },
    });
    this.owner.attach(runtime);
    try {
      const response = await runtime.dispatchFetch("https://application-query.invalid/", {
        method: "POST",
        body: JSON.stringify(encodeBridgeValue(structuredClone(request))),
      });
      const envelope = decodeBridgeValue(JSON.parse(await response.text()));
      if (!isRecord(envelope) || envelope.ok !== true) {
        const error = new Error(errorMessage(envelope));
        Object.defineProperty(error, "name", { value: errorName(envelope) });
        this.owner.release(runtime);
        throw error;
      }
      const result = envelope.result;
      if (result === null || typeof result !== "object") {
        this.owner.release(runtime);
        throw new Error("Application Worker returned an invalid RPC result.");
      }
      return Object.defineProperty(result, Symbol.dispose, {
        value: () => this.owner.release(runtime),
      });
    } catch (cause) {
      this.owner.release(runtime);
      throw cause;
    }
  }
}

interface Deferred<A> {
  readonly promise: Promise<A>;
  readonly resolve: (value: A | PromiseLike<A>) => void;
}

interface InvocationBlock {
  readonly started: Deferred<void>;
  readonly released: Deferred<void>;
}

function deferred<A>(): Deferred<A> {
  let resolve!: Deferred<A>["resolve"];
  const promise = new Promise<A>(settle => {
    resolve = settle;
  });
  return Object.freeze({ promise, resolve });
}

async function invokeCapability(
  input: Request,
  capability: object,
  observe: (method: string, argumentsValue: readonly unknown[]) => void | Promise<void>,
): Promise<Response> {
  try {
    const request = decodeBridgeValue(JSON.parse(await input.text()));
    if (
      !isRecord(request) || typeof request.method !== "string" ||
      !Array.isArray(request.arguments)
    ) throw new Error("Application capability request is invalid.");
    await observe(request.method, request.arguments);
    const method = Reflect.get(capability, request.method);
    if (typeof method !== "function") {
      throw new Error("Application capability method is unavailable.");
    }
    const result = await Reflect.apply(method, capability, request.arguments);
    return bridgeResponse({ ok: true, result });
  } catch (cause) {
    return bridgeResponse({
      ok: false,
      name: cause instanceof Error ? cause.name : "Error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function bridgeResponse(value: unknown): Response {
  return new Response(JSON.stringify(encodeBridgeValue(value)));
}

function applicationWorkerBridgeSource(
  code: WorkerLoaderWorkerCode,
  entrypoint: string,
): string {
  const workerCode = Object.freeze({ ...code, globalOutbound: null });
  const globalOutbound = code.globalOutbound == null
    ? "null"
    : "env.GLOBAL_OUTBOUND";
  return `import { RpcTarget } from "cloudflare:workers";
const workerCode = ${JSON.stringify(workerCode)};
${BRIDGE_CODEC_SOURCE}
class Capability extends RpcTarget {
  constructor(binding) { super(); this.binding = binding; }
  async call(method, argumentsValue) {
    const response = await this.binding.fetch("https://capability.invalid/", {
      method: "POST",
      body: JSON.stringify(encodeBridgeValue({ method, arguments: argumentsValue })),
    });
    const envelope = decodeBridgeValue(JSON.parse(await response.text()));
    if (!envelope.ok) {
      const error = new Error(envelope.message);
      Object.defineProperty(error, "name", { value: envelope.name });
      throw error;
    }
    return envelope.result;
  }
  revalidate() { return this.call("revalidate", []); }
  readPointDocument(tableName, documentId) {
    return this.call("readPointDocument", [tableName, documentId]);
  }
  queryIndexRange(tableName, indexDescriptor, bounds, limit) {
    return this.call("queryIndexRange", [tableName, indexDescriptor, bounds, limit]);
  }
  takeIncomingRelationSources(input) {
    return this.call("takeIncomingRelationSources", [input]);
  }
  invoke(request) { return this.call("invoke", [request]); }
  insertPointDocument(tableName, value) {
    return this.call("insertPointDocument", [tableName, value]);
  }
  patchPointDocument(documentId, value) {
    return this.call("patchPointDocument", [documentId, value]);
  }
  replacePointDocument(documentId, value) {
    return this.call("replacePointDocument", [documentId, value]);
  }
  deletePointDocument(documentId) {
    return this.call("deletePointDocument", [documentId]);
  }
}
export default {
  async fetch(request, env) {
    try {
      const worker = env.LOADER.load({
        ...workerCode,
        globalOutbound: ${globalOutbound},
      });
      const stub = worker.getEntrypoint(${JSON.stringify(entrypoint)});
      const input = decodeBridgeValue(JSON.parse(await request.text()));
      const result = await stub.run(input, new Capability(env.CAPABILITY));
      try {
        return new Response(JSON.stringify(encodeBridgeValue({
          ok: true,
          result: structuredClone(result),
        })));
      } finally {
        result?.[Symbol.dispose]?.();
      }
    } catch (error) {
      return new Response(JSON.stringify(encodeBridgeValue({
        ok: false,
        name: typeof error?.name === "string" ? error.name : "Error",
        message: typeof error?.message === "string" ? error.message : String(error),
      })), { status: 500 });
    }
  },
};`;
}

async function copyMiniflareRequestV1(request: Request): Promise<Request> {
  const method = request.method;
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  return new Request(request.url, {
    method,
    headers: [...request.headers.entries()],
    ...(body === undefined ? {} : { body }),
  });
}

const BRIDGE_CODEC_SOURCE = `${SYSTEM_TEST_STRUCTURED_CLONE_BRIDGE_WORKER_SOURCE_V1}
const encodeBridgeValue = encodeStructuredCloneBridgeValue;
const decodeBridgeValue = decodeStructuredCloneBridgeValue;`;

function encodeBridgeValue(value: unknown): unknown {
  return encodeSystemTestStructuredCloneBridgeValueV1(value);
}

function decodeBridgeValue(value: unknown): unknown {
  return decodeSystemTestStructuredCloneBridgeValueV1(value);
}

function errorName(value: unknown): string {
  return isRecord(value) && typeof value.name === "string" ? value.name : "Error";
}

function errorMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === "string"
    ? value.message
    : "Application query Workerd execution failed.";
}

function requireNestedString(
  value: unknown,
  objectKey: string,
  stringKey: string,
): string {
  if (!isRecord(value) || !isRecord(value[objectKey])) {
    throw new Error(`Application query proof expected ${objectKey}.`);
  }
  const member = value[objectKey][stringKey];
  if (typeof member !== "string") {
    throw new Error(`Application query proof expected ${stringKey}.`);
  }
  return member;
}

function requireQueryResult(value: unknown): ApplicationNativeQueryProof["result"] {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new Error("Application query proof received an invalid document.");
  }
  return Object.freeze({ name: value.name });
}
