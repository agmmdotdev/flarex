/// <reference types="@cloudflare/workers-types" />

import {
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  makeApplicationQuerySystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { invokeStandardApplicationPointQueryV1 } from
  "@flarex/standard-application-invocation/v1";
import { Effect } from "effect";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import { ApplicationAnalysisSourceReadError } from
  "flarex-backend/internal/application-analysis-source-reader";
import { TransactionFunctionPathV1Schema } from
  "flarex-protocol/transaction-session";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { Miniflare } from "miniflare";
import {
  decodeSystemTestStructuredCloneBridgeValueV1,
  encodeSystemTestStructuredCloneBridgeValueV1,
  SYSTEM_TEST_STRUCTURED_CLONE_BRIDGE_WORKER_SOURCE_V1,
} from "./systemTestStructuredCloneBridgeV1";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const RUNTIME_HOST_IDENTITY = "flarex-application-runtime-host-v1";
const COMPATIBILITY_DATE = "2026-06-14";

export const APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS = Object.freeze({
  runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
  compatibilityDate: COMPATIBILITY_DATE,
});

export type ApplicationNativeQueryFixtureFactory = () => Promise<
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

export function makeApplicationNativeQueryTestLayer(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
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
  const invoke = () => runSystemTestEffectV1(Effect.scoped(
    invokeStandardApplicationPointQueryV1(
      TransactionFunctionPathV1Schema.make("users:get"),
      { id: seeded.documentId },
    ).pipe(Effect.provide(layer)),
  ));
  try {
    const result = requireQueryResult(await invoke());
    if (result.name !== seeded.name) {
      throw new Error("Application query did not return the stored document.");
    }
    await fixture.moveHead();
    const moved = requireQueryResult(await invoke());
    if (moved.name !== seeded.name) {
      throw new Error("Application query lost the stored document after head movement.");
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

export class MiniflareApplicationWorkerLoader implements WorkerLoader {
  loads = 0;
  revalidations = 0;
  pointDocumentReads = 0;
  readonly revisionIds: string[] = [];
  readonly documentIds: string[] = [];
  readonly #runtimes = new Set<Miniflare>();
  readonly #disposals: Array<Promise<void>> = [];
  #nextInvocationBlock: InvocationBlock | undefined;

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
    throw new Error("Application query proof forbids cached Worker loading.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareQueryWorkerStub(this, code);
  }

  observeCapability(method: string, argumentsValue: readonly unknown[]): void {
    if (method === "revalidate") this.revalidations += 1;
    if (method !== "readPointDocument") return;
    this.pointDocumentReads += 1;
    const documentId = argumentsValue[1];
    if (typeof documentId !== "string") {
      throw new Error("Application query Worker supplied an invalid document ID.");
    }
    this.documentIds.push(documentId);
  }

  attach(runtime: Miniflare): void {
    this.#runtimes.add(runtime);
  }

  release(runtime: Miniflare): void {
    if (!this.#runtimes.delete(runtime)) return;
    this.#disposals.push(runtime.dispose());
  }

  async waitForNextInvocationBlock(): Promise<void> {
    const block = this.#nextInvocationBlock;
    if (block === undefined) return;
    this.#nextInvocationBlock = undefined;
    block.started.resolve();
    await block.released.promise;
  }

  async dispose(): Promise<void> {
    const live = [...this.#runtimes];
    this.#runtimes.clear();
    await Promise.all([
      ...this.#disposals.splice(0),
      ...live.map(runtime => runtime.dispose()),
    ]);
  }
}

class MiniflareQueryWorkerStub implements WorkerStub {
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
        throw new Error("Application query proof forbids sockets.");
      },
    };
    // SAFETY: the test adapter implements the exact run RPC used by the host
    // plus the Fetcher surface required by Cloudflare's branded declaration.
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application query proof forbids Durable Objects.");
  }

  private async run(
    name: string | undefined,
    request: unknown,
    capability: object,
  ): Promise<unknown> {
    if (name === undefined) {
      throw new Error("Application query Worker entrypoint was not selected.");
    }
    this.owner.revisionIds.push(requireNestedString(request, "target", "revisionId"));
    await this.owner.waitForNextInvocationBlock();
    const runtime = new Miniflare({
      compatibilityDate: COMPATIBILITY_DATE,
      modules: true,
      script: applicationQueryBridgeSource(this.code, name),
      workerLoaders: { LOADER: {} },
      serviceBindings: {
        CAPABILITY: (input: Request) => invokeCapability(
          input,
          capability,
          (method, argumentsValue) =>
            this.owner.observeCapability(method, argumentsValue),
        ),
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
        throw new Error("Application query Worker returned an invalid RPC result.");
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
  observe: (method: string, argumentsValue: readonly unknown[]) => void,
): Promise<Response> {
  try {
    const request = decodeBridgeValue(JSON.parse(await input.text()));
    if (
      !isRecord(request) || typeof request.method !== "string" ||
      !Array.isArray(request.arguments)
    ) throw new Error("Application query capability request is invalid.");
    observe(request.method, request.arguments);
    const method = Reflect.get(capability, request.method);
    if (typeof method !== "function") {
      throw new Error("Application query capability method is unavailable.");
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

function applicationQueryBridgeSource(
  code: WorkerLoaderWorkerCode,
  entrypoint: string,
): string {
  return `import { RpcTarget } from "cloudflare:workers";
const workerCode = ${JSON.stringify(code)};
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
      const worker = env.LOADER.load(workerCode);
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
