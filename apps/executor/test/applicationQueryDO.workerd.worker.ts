import { DurableObject } from "cloudflare:workers";
import { runQuery } from "@flarex/application-invocation";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from
  "@flarex/persistence-postgres/internal/execution-diagnostics";
import { Cause, Effect, Exit, Option, Schema, Tracer } from "effect";
import { Client } from "pg";
import { CloudflareSocket } from "pg-cloudflare";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { isNonArrayRecord } from "@flarex/utils/records";
import { makeApplicationAnalysisR2SourceReader } from
  "flarex-backend/internal/application-analysis-source-reader";

import {
  USERS_CACHE_REFERENCE,
  USERS_CACHE_MISMATCH_REFERENCE,
} from "../../../packages/system-test/support/applicationNativeQueryDefinitions";
import { makeSourceArtifactV2AttemptStore } from
  "../../../packages/flarex-backend/src/sourceArtifactV2/AttemptStore";
import { makeSourceArtifactV2R2Store } from
  "../../../packages/flarex-backend/src/sourceArtifactV2/R2Store";
import { makeLiveSourceArtifactV2Sha256 } from
  "../../../packages/flarex-backend/src/sourceArtifactV2/Sha256";
import { makeSourceArtifactV2UploadCore, type SourceArtifactV2UploadReceipt } from
  "../../../packages/flarex-backend/src/sourceArtifactV2/UploadCore";
import { initializeDeploymentStorage } from
  "../../../packages/flarex-backend/src/deployment/StorageSchema";
import {
  makeApplicationQueryDurableObject,
  type ApplicationQueryDurableObjectClass,
  type ApplicationQueryDurableObjectEnv,
} from "../src/applicationQueryDO";

const FixtureConfigurationSchema = Schema.Struct({
  deploymentId: Schema.NonEmptyString,
  scopeId: Schema.NonEmptyString,
  schemaName: Schema.NonEmptyString,
});
interface FixtureEnv extends ApplicationQueryDurableObjectEnv {
  readonly QUERY_CONFIGURATION: string;
  readonly QUERY_BETA_CONFIGURATION: string;
  readonly QUERIES: DurableObjectNamespace;
  readonly BETA_QUERIES: DurableObjectNamespace;
  readonly WRONG_QUERIES: DurableObjectNamespace;
  readonly UPLOADS: DurableObjectNamespace;
}
const decodeConfiguration = Schema.decodeUnknownSync(Schema.fromJsonString(FixtureConfigurationSchema));

const ArgumentsSchema = Schema.Struct({
  repeatId: Schema.String,
  missingId: Schema.String,
  suffixId: Schema.String,
  bounds: Schema.Struct({
    startInclusive: Schema.optionalKey(Schema.String),
    endExclusive: Schema.optionalKey(Schema.String),
  }),
});
const QueryRequestSchema = Schema.Struct({
  operation: Schema.Literals(["probe", "mismatch", "cleanupFailure", "mismatchCleanupFailure", "constructorFailure", "connectFailure"]),
  args: ArgumentsSchema,
});
const decodeQuery = Schema.decodeUnknownEffect(Schema.fromJsonString(QueryRequestSchema));
let nextClientFailure: "cleanupFailure" | "constructorFailure" | "connectFailure" | undefined;
let executionSequence = 0;
const resources = { constructed: 0, connected: 0, ended: 0, errorEvents: 0 };
const decodeBackendPid = Schema.decodeUnknownSync(Schema.Int.check(Schema.isGreaterThan(0)));
let lastConnectedBackend: Readonly<{ pid: number; applicationName: string }> | undefined;

class ObservedClient extends Client {
  readonly #failCleanup: boolean;
  readonly #failConnect: boolean;
  readonly #applicationName: string;
  #nativeEndFulfilled = false;
  constructor(connectionString: string, schemaName: string, failure: typeof nextClientFailure) {
    const applicationName = `actual-query-do-${crypto.randomUUID()}`;
    super({ connectionString, options: `-c search_path=${schemaName}`, application_name: applicationName });
    resources.constructed++;
    this.#failCleanup = failure === "cleanupFailure";
    this.#failConnect = failure === "connectFailure";
    this.#applicationName = applicationName;
  }
  override connect(): Promise<Client>;
  override connect(callback: ((err: Error) => void) | ((err: null, client: Client) => void)): void;
  override connect(callback?: ((err: Error) => void) | ((err: null, client: Client) => void)): Promise<Client> | void {
    resources.connected++;
    if (callback !== undefined) return super.connect(callback);
    if (this.#failConnect) return Promise.reject(new Error("query-host-fixture-client-connect"));
    return super.connect().then(client => {
      // Installed pg exposes the backend key data at processID. Decode this
      // foreign observational field; it is not an authority/caller-selected PID.
      const pid = decodeBackendPid(Reflect.get(this, "processID"));
      lastConnectedBackend = { pid, applicationName: this.#applicationName };
      const connection: unknown = Reflect.get(this, "connection");
      const stream: unknown = isNonArrayRecord(connection) ? Reflect.get(connection, "stream") : undefined;
      if (!(stream instanceof CloudflareSocket)) {
        throw new Error("Actual DO fixture did not select the pg-used CloudflareSocket.");
      }
      this.#trace("connected", { stream: "actual-pg-used-CloudflareSocket" });
      return client;
    });
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "error") {
      resources.errorEvents++;
      const error = args[0];
      this.#trace("error", { message: error instanceof Error ? error.message : String(error),
        code: isNonArrayRecord(error) && typeof error.code === "string" ? error.code : null });
    }
    if (event === "end") this.#trace("client-end-event");
    // No test error listener: preserve EventEmitter's real unhandled behavior.
    return super.emit(event, ...args);
  }
  override async end(): Promise<void> {
    resources.ended++;
    this.#trace("native-end-start");
    await super.end();
    this.#nativeEndFulfilled = true;
    this.#trace("native-end-fulfilled");
    if (this.#failCleanup) throw new Error("query-host-fixture-client-cleanup");
  }
  #trace(phase: string, detail: Readonly<Record<string, string | null>> = {}): void {
    console.info("QUERY_DO_CLIENT_LIFECYCLE", JSON.stringify({ phase, applicationName: this.#applicationName,
      nativeEndFulfilled: this.#nativeEndFulfilled, at: performance.now(), ...detail }));
  }
}

function ancestorHasName(parent: Tracer.AnySpan | undefined, name: string): boolean {
  while (parent?._tag === "Span") {
    if (parent.name === name) return true;
    parent = Option.getOrUndefined(parent.parent);
  }
  return false;
}

const dispatch = Effect.fn("ApplicationQueryDOFixture.dispatch")(function* (request: Request) {
  // This is a finite private fixture protocol, not a general query endpoint.
  const text = yield* readFixtureText(request, 16_384);
  const input = yield* decodeQuery(text);
  if (input.operation === "cleanupFailure" || input.operation === "constructorFailure" || input.operation === "connectFailure") {
    nextClientFailure = input.operation;
  }
  if (input.operation === "mismatchCleanupFailure") nextClientFailure = "cleanupFailure";
  const beforeResources = { ...resources };
  const resourceCounts = () => ({ constructed: resources.constructed - beforeResources.constructed,
    connected: resources.connected - beforeResources.connected, ended: resources.ended - beforeResources.ended });
  const counts = { rowReads: 0, indexReads: 0, indexBodyReads: 0,
    refreshRows: 0, refreshes: 0, logicalPoints: 0, logicalIndexes: 0 };
  const storageSpans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({ span(options) {
    if (options.name === "AppRows.captureSnapshotRead") {
      const parent = Option.getOrUndefined(options.parent);
      if (ancestorHasName(parent, "ApplicationQuerySnapshot.readIndexInTransaction")) counts.indexBodyReads++;
      if (ancestorHasName(parent, "ApplicationQueryCache.captureRefresh")) counts.refreshRows++;
      else counts.rowReads++;
    }
    if (options.name === "ApplicationQueryCache.captureRefresh") counts.refreshes++;
    if (options.name === "ApplicationQuerySnapshot.readPoint") counts.logicalPoints++;
    if (options.name === "ApplicationQuerySnapshot.readIndex") counts.logicalIndexes++;
    const span = new Tracer.NativeSpan(options);
    if (options.name.startsWith("ApplicationActivation.") || options.name.startsWith("ApplicationQuerySnapshot.")
      || options.name.startsWith("ScopeExecution.")) storageSpans.push(span);
    return span;
  } });
  const diagnostics: ExecutionDiagnosticPolicy = {
    observe(name, work) {
      if (name === "AppIndexEntries.scanAtSnapshotInTransaction") counts.indexReads++;
      return work;
    },
  };
  const query = Effect.gen(function* () {
    if (input.operation === "mismatch" || input.operation === "mismatchCleanupFailure") {
      return yield* runQuery(USERS_CACHE_MISMATCH_REFERENCE, input.args);
    }
    return yield* runQuery(USERS_CACHE_REFERENCE, input.args);
  });
  // Recovery is deliberately OUTSIDE runQuery's owned completion scope.
  const outcome = yield* query.pipe(Effect.withTracer(tracer),
    Effect.provideService(ExecutionDiagnostics, diagnostics), Effect.exit);
  if (Exit.isSuccess(outcome)) return Response.json({ ok: true, value: outcome.value, counts, resources: resourceCounts() });
  const reason = outcome.cause.reasons.find(Cause.isFailReason);
  const defect = outcome.cause.reasons.find(Cause.isDieReason);
  const error = reason?.error;
  const owner = isNonArrayRecord(error) && isNonArrayRecord(error.cause) ? error.cause : undefined;
  return Response.json({
    ok: false,
    failure: {
      kind: defect === undefined ? (reason === undefined ? "interrupted" : "typed") : "defect",
      tag: isNonArrayRecord(error) && typeof error._tag === "string" ? error._tag : null,
      reason: isNonArrayRecord(error) && typeof error.reason === "string" ? error.reason : null,
      ownerTag: typeof owner?._tag === "string" ? owner._tag : null,
      ownerReason: typeof owner?.reason === "string" ? owner.reason : null,
      message: defect?.defect instanceof Error ? defect.defect.message : null,
    },
    counts,
    resources: resourceCounts(),
    cause: Cause.pretty(outcome.cause),
    typedFailures: outcome.cause.reasons.filter(Cause.isFailReason).map(reason =>
      isNonArrayRecord(reason.error) && typeof reason.error._tag === "string" ? reason.error._tag : "UnknownFailure"),
    defects: outcome.cause.reasons.filter(Cause.isDieReason).map(reason =>
      reason.defect instanceof Error ? reason.defect.message : String(reason.defect)),
    // Existing owner spans keep precise typed guards before the Worker projects
    // its public read-boundary failure. Observe them; never recreate the guard.
    spanFailures: storageSpans.flatMap(span => {
      const status = span.status;
      if (status._tag !== "Ended" || !Exit.isFailure(status.exit)) return [];
      return status.exit.cause.reasons.flatMap(reason => {
        if (!Cause.isFailReason(reason) || !isNonArrayRecord(reason.error) || typeof reason.error._tag !== "string") return [];
        return [{ span: span.name, tag: reason.error._tag,
          reason: typeof reason.error.reason === "string" ? reason.error.reason : null }];
      });
    }).slice(0, 128),
  });
});

function hostOptions(profile: "alpha" | "beta" | "wrong" = "alpha") {
  let schemaName: string | undefined;
  return {
    serving(env: FixtureEnv) {
      const input = decodeConfiguration(profile === "beta" ? env.QUERY_BETA_CONFIGURATION : env.QUERY_CONFIGURATION);
      schemaName = input.schemaName;
      return {
        deploymentId: profile === "wrong" ? `${input.deploymentId}-wrong` : input.deploymentId,
        scopeId: decodeReplacementScopeIdV1(input.scopeId),
        physicalLocator: { kind: "database_per_scope" as const,
          databaseKey: "application_native_mutation_target", schemaName: input.schemaName },
      };
    },
    snapshotBudget: { maximumPointReads: 16, maximumIndexReads: 16, maximumDocuments: 64, maximumSemanticBytes: 1_048_576 },
    executionContextFactory: () => {
      executionSequence++;
      return { executionId: `actual-do-query-${executionSequence}`, randomSeed: crypto.getRandomValues(new Uint8Array(32)),
        executionTime: 1_800_000_000_000 + executionSequence };
    },
    dispatch,
    createClient: (connectionString: string) => {
      const failure = nextClientFailure;
      nextClientFailure = undefined;
      if (failure === "constructorFailure") throw new Error("query-host-fixture-client-construction");
      if (schemaName === undefined) throw new Error("Query fixture did not capture trusted schema configuration.");
      return new ObservedClient(connectionString, schemaName, failure);
    },
  };
}

interface SourceGate {
  hold: boolean;
  entered: boolean;
  release: (() => void) | undefined;
  backend: typeof lastConnectedBackend;
}
function observedQueryClass(Base: ApplicationQueryDurableObjectClass<FixtureEnv>): ApplicationQueryDurableObjectClass<FixtureEnv> {
  return class ObservedQueryFixtureDO extends Base {
  readonly #boot = crypto.randomUUID();
  readonly #sourceGate: SourceGate;
  constructor(ctx: DurableObjectState, env: FixtureEnv) {
    const gate: SourceGate = { hold: false, entered: false, release: undefined, backend: undefined };
    const source = env.ARTIFACTS;
    // Real R2 I/O with a deterministic host scheduling gate after snapshot open.
    const artifacts = {
      get: async (key: string) => {
        if (gate.hold) {
          gate.hold = false;
          gate.entered = true;
          gate.backend = lastConnectedBackend;
          await new Promise<void>(resolve => { gate.release = resolve; });
        }
        return source.get(key);
      },
      put: (...args: Parameters<typeof source.put>) => source.put(...args),
    };
    super(ctx, { ...env, ARTIFACTS: artifacts });
    this.#sourceGate = gate;
  }
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/gate-status") return Response.json({ entered: this.#sourceGate.entered,
      pid: this.#sourceGate.backend?.pid ?? null, applicationName: this.#sourceGate.backend?.applicationName ?? null,
      errorEvents: resources.errorEvents });
    if (path === "/release") {
      this.#sourceGate.release?.();
      this.#sourceGate.entered = false;
      return Response.json({ released: true });
    }
    if (path === "/hold") this.#sourceGate.hold = true;
    const response = await super.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("x-query-do-boot", this.#boot);
    return new Response(response.body, { status: response.status, headers });
  }
  };
}
const QueryBase = makeApplicationQueryDurableObject(hostOptions());
export class ApplicationQueryFixtureDO extends observedQueryClass(QueryBase) {}
export const WrongApplicationQueryFixtureDO = makeApplicationQueryDurableObject(hostOptions("wrong"));
const BetaBase = makeApplicationQueryDurableObject(hostOptions("beta"));
export class ApplicationQueryBetaFixtureDO extends observedQueryClass(BetaBase) {}

const UploadRequestSchema = Schema.Struct({
  modules: Schema.Array(Schema.Struct({ path: Schema.String, roles: Schema.Int, source: Schema.String }))
    .check(Schema.isMinLength(1), Schema.isMaxLength(8)),
});
const decodeUpload = Schema.decodeUnknownEffect(Schema.fromJsonString(UploadRequestSchema));
const uploadAdmission = { calls: 1, blockBytes: 131_072, modules: 1, sourceMaps: 0,
  canonicalBytes: 1_048_576, frameBytes: 1_048_576, hashBytes: 1_048_576, timeMilliseconds: 1_000 };
// The real upload owner reserves a whole admission per command. The finite
// fixture permits eight modules: begin + three commands per module + finalize.
const uploadCommands = 2 + 3 * 8;
const uploadBudget = { calls: uploadCommands * uploadAdmission.calls,
  blockBytes: uploadCommands * uploadAdmission.blockBytes, modules: uploadCommands * uploadAdmission.modules,
  sourceMaps: 0, canonicalBytes: uploadCommands * uploadAdmission.canonicalBytes,
  frameBytes: uploadCommands * uploadAdmission.frameBytes, hashBytes: uploadCommands * uploadAdmission.hashBytes,
  timeMilliseconds: uploadCommands * uploadAdmission.timeMilliseconds };

export class ApplicationQuerySourceUploadDO extends DurableObject<FixtureEnv> {
  constructor(ctx: DurableObjectState, env: FixtureEnv) {
    super(ctx, env);
    initializeDeploymentStorage(ctx.storage.sql);
  }
  override async fetch(request: Request): Promise<Response> {
    const operation = Effect.gen({ self: this }, function* () {
      const text = yield* readFixtureText(request, 1_048_576);
      const input = yield* decodeUpload(text);
      const sha256 = makeLiveSourceArtifactV2Sha256();
      const core = makeSourceArtifactV2UploadCore({ deploymentId: "query-do-source-fixture",
        attempts: makeSourceArtifactV2AttemptStore(this.ctx.storage, this.ctx.storage.sql),
        objects: makeSourceArtifactV2R2Store(this.env.ARTIFACTS, sha256), sha256 });
      const uploadId = crypto.randomUUID();
      let receipt = yield* core.beginUpload({ uploadId, commandId: `${uploadId}:begin`,
        ceilings: uploadBudget, admission: uploadAdmission });
      const command = (current: SourceArtifactV2UploadReceipt, suffix: string) => ({
        uploadId, generation: current.generation, expectedFence: current.mutationFence,
        commandId: `${uploadId}:${suffix}`, admission: uploadAdmission,
      });
      for (const [index, module] of [...input.modules].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).entries()) {
        receipt = yield* core.beginModule({ ...command(receipt, `${index}:begin`),
          path: module.path, roles: module.roles, environment: "isolate" });
        receipt = yield* core.appendBlock({ ...command(receipt, `${index}:block`), kind: "source", blockIndex: 0,
          bytes: new TextEncoder().encode(module.source) });
        receipt = yield* core.closeModule(command(receipt, `${index}:close`));
      }
      receipt = yield* core.finalize(command(receipt, "finalize"));
      if (receipt.completedRootDigest === null) return yield* Effect.die(new Error("Finalized source has no root digest."));
      const source = yield* makeApplicationAnalysisR2SourceReader(this.env.ARTIFACTS).read(receipt.completedRootDigest);
      return Response.json({ source });
    });
    const outcome = await Effect.runPromiseExit(operation);
    if (Exit.isSuccess(outcome)) return outcome.value;
    return Response.json({ error: "source-upload-failed", cause: Cause.pretty(outcome.cause),
      failures: outcome.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error),
      defects: outcome.cause.reasons.filter(Cause.isDieReason).map(reason =>
        reason.defect instanceof Error ? { message: reason.defect.message, stack: reason.defect.stack } : String(reason.defect)),
    }, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: FixtureEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/source") return env.UPLOADS.get(env.UPLOADS.idFromName("source-upload")).fetch(request);
    const segment = path.split("/")[1];
    const namespace = segment === "wrong" ? env.WRONG_QUERIES : segment === "beta" ? env.BETA_QUERIES : env.QUERIES;
    const name = segment === "beta" ? "scope:beta" : "scope:alpha";
    const targetPath = path.slice((segment?.length ?? 0) + 1) || "/query";
    const url = new URL(request.url);
    url.pathname = targetPath;
    return namespace.get(namespace.idFromName(name)).fetch(new Request(url, request));
  },
} satisfies ExportedHandler<FixtureEnv>;

const readFixtureText = Effect.fn("ApplicationQueryDOFixture.readBody")((request: Request, maximum: number) =>
  Effect.tryPromise({
    try: async () => {
      if (request.body === null) return "";
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maximum) {
            await reader.cancel("fixture-request-too-large");
            throw new Error("fixture-request-too-large");
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    },
    catch: cause => cause,
  }));
