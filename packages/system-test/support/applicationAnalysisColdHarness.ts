/// <reference types="@cloudflare/workers-types" />

import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { Data, Effect, Result } from "effect";

import {
  canonicalizeApplicationAnalysisReceiptV1,
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
  type ApplicationAnalysisHostCapabilities,
} from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import {
  makeApplicationAnalysisSystem,
} from "@flarex/source-analyzer-v2/internal/application-analysis-system";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
  type ApplicationAnalysisRepository,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import type { FlarexMetadataDatabase } from
  "@flarex/persistence-postgres/internal/system-test/deployments";
import {
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import {
  analyzeStandardApplication,
  type StandardApplicationAnalysis,
  type StandardApplicationAnalysisInput,
} from
  "@flarex/standard-application-analysis/application";
import { produceStandardApplicationSource } from
  "@flarex/standard-application-definition/application-source";
import type { StandardApplicationSourceModule } from
  "@flarex/standard-application-definition/application-source";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { copyBytes } from "@flarex/utils/bytes";
import {
  makeApplicationAnalysisR2SourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  makeLiveSourceArtifactV2Sha256,
  makeSourceArtifactV2R2Store,
  makeSourceArtifactV2UploadCore,
  SourceArtifactV2AttemptStoreConflictError,
  type SourceArtifactV2Attempt,
  type SourceArtifactV2AttemptMutation,
  type SourceArtifactV2AttemptStore,
  type SourceArtifactV2R2Bucket,
  type SourceArtifactV2ResourceBudget,
  type SourceArtifactV2UploadCore,
} from "flarex-backend/internal/application-analysis-upload";
import {
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";

import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "aa-r7-cold-analysis",
  schemaName: "public",
} as const);
const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_aa_r7_cold_analysis",
);
const PROJECT_ID = "project_aa_r7_cold_analysis";
const UPLOAD_ID = "aa070000-0000-4000-8000-000000000001";
const REQUEST_KEY = "request:aa-r7:cold-analysis";
const SOURCE = "export async function save() { return { ok: true }; }\n";
const CEILINGS = Object.freeze({
  calls: 256,
  blockBytes: 134_217_728,
  modules: 256,
  sourceMaps: 256,
  canonicalBytes: 134_217_728,
  frameBytes: 134_217_728,
  hashBytes: 536_870_912,
  timeMilliseconds: 120_000,
}) satisfies SourceArtifactV2ResourceBudget;
const ADMISSION = Object.freeze({
  calls: 1,
  blockBytes: 4_194_304,
  modules: 16,
  sourceMaps: 16,
  canonicalBytes: 4_194_304,
  frameBytes: 4_194_304,
  hashBytes: 16_777_216,
  timeMilliseconds: 10_000,
}) satisfies SourceArtifactV2ResourceBudget;

class ApplicationAnalysisColdProofError extends Data.TaggedError(
  "ApplicationAnalysisColdProofError",
)<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

function proofFailure(
  operation: string,
  detail: string,
  cause?: unknown,
): ApplicationAnalysisColdProofError {
  return new ApplicationAnalysisColdProofError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function proofPromise<A>(
  operation: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, ApplicationAnalysisColdProofError> {
  return Effect.tryPromise({
    try: run,
    catch: cause => proofFailure(
      operation,
      `AA-R7 foreign operation ${operation} failed.`,
      cause,
    ),
  });
}

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export interface ApplicationAnalysisColdProof {
  readonly lane: "pglite" | "postgres";
  readonly firstKind: "analyzed";
  readonly replayKind: "analyzed";
  readonly restartKind: "analyzed";
  readonly coldLoads: 2;
  readonly replayColdLoads: 0;
  readonly restartColdLoads: 2;
  readonly exactReplayIdentity: true;
  readonly restartDistinctIdentity: true;
  readonly durableAnalysisCount: 5;
  readonly durableRevisionCount: 2;
  readonly missingObjectRejected: true;
  readonly digestCorruptionRejected: true;
  readonly lengthCorruptionRejected: true;
  readonly postgresVersion?: string;
}

export async function proveApplicationAnalysisColdPGlite(
  persistence: PGliteFlarexPersistence,
): Promise<ApplicationAnalysisColdProof> {
  return runSystemTestEffectV1(proveApplicationAnalysisCold(
    "pglite",
    persistence,
    async randomUuid => createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator: LOCATOR, randomUuid },
    ).ensure({ deploymentId: DEPLOYMENT_ID, projectId: PROJECT_ID }),
  ));
}

export async function proveApplicationAnalysisColdPostgres(
  persistence: PostgresFlarexPersistence,
): Promise<ApplicationAnalysisColdProof> {
  return runSystemTestEffectV1(Effect.gen(function* () {
    const proof = yield* proveApplicationAnalysisCold(
      "postgres",
      persistence,
      async randomUuid => createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator: LOCATOR, randomUuid },
      ).ensure({ deploymentId: DEPLOYMENT_ID, projectId: PROJECT_ID }),
    );
    const version = yield* proofPromise("loadPostgresVersion", () =>
      persistence.query<{ version: string }>("select version() as version"),
    );
    return Object.freeze({
      ...proof,
      postgresVersion: version.rows[0]?.version ?? "missing",
    });
  }));
}

const proveApplicationAnalysisCold = Effect.fn("AAR7.proveColdAnalysis")(
  function* (
  lane: "pglite" | "postgres",
  persistence: Persistence,
  ensureScope: (
    randomUuid: () => string,
  ) => Promise<Readonly<{ readonly scope: Readonly<{ readonly scopeId: string }> }>>,
  ) {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const provisioned = yield* proofPromise(
    "ensureScope",
    () => ensureScope(uuidSequence(1, 2)),
  );
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  yield* proofPromise("selectStorageGeneration", () => persistence.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [scopeId],
  ));
  const clock = yield* proofPromise(
    "loadScopeClock",
    () => persistence.getScopeClock(scopeId),
  );
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    return yield* proofFailure(
      "loadScopeClock",
      "AA-R7 cold-analysis scope is missing.",
    );
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const definition = yield* Effect.fromResult(
    prepareStandardApplicationDefinitionV1(definitionInput()),
  );
  const source = yield* Effect.fromResult(
    produceStandardApplicationSource(definition),
  );
  const bucket = new MemorySourceArtifactBucket();
  const attempts = memoryAttemptStore();
  const sha256 = makeLiveSourceArtifactV2Sha256();
  const upload = makeSourceArtifactV2UploadCore({
    deploymentId: DEPLOYMENT_ID,
    attempts,
    objects: makeSourceArtifactV2R2Store(bucket, sha256),
    sha256,
  });
  const finalized = yield* uploadSource(upload, source.modules);
  const root = finalized.completedRootDigest;
  if (root === null) {
    return yield* proofFailure(
      "uploadSource",
      "AA-R7 source upload omitted its root.",
    );
  }

  const controlDb: FlarexMetadataDatabase = persistence.drizzle;
  const repository = makeApplicationAnalysisRepository(
    controlDb,
    { randomUuid: uuidCounter(10) },
  );
  const firstPhase = yield* runAnalysisPhase(
    bucket,
    authority,
    repository,
    { requestKey: REQUEST_KEY, sourceArtifactRootSha256: root },
  );
  const first = firstPhase.analysis;
  if (first.kind !== "analyzed") {
    return yield* proofFailure(
      "firstAnalysis",
      "AA-R7 cold analysis was rejected.",
    );
  }

  const replayPhase = yield* runAnalysisPhase(
    bucket,
    authority,
    makeApplicationAnalysisRepository(
      controlDb,
      { randomUuid: uuidCounter(50) },
    ),
    { requestKey: REQUEST_KEY, sourceArtifactRootSha256: root },
  );
  const replay = replayPhase.analysis;
  if (replay.kind !== "analyzed") {
    return yield* proofFailure(
      "replayAnalysis",
      "AA-R7 cold analysis replay changed terminal status.",
    );
  }
  yield* requireExactAnalyzedReplay(first, replay);

  const restartPhase = yield* runAnalysisPhase(
    bucket,
    authority,
    makeApplicationAnalysisRepository(
      controlDb,
      { randomUuid: uuidCounter(80) },
    ),
    {
      requestKey: `${REQUEST_KEY}:fresh-restart`,
      sourceArtifactRootSha256: root,
    },
  );
  const restart = restartPhase.analysis;
  if (restart.kind !== "analyzed") {
    return yield* proofFailure(
      "restartAnalysis",
      "AA-R7 fresh restart did not cold-analyze from R2 bytes.",
    );
  }
  yield* requireDistinctRestart(first, restart);

  const sourceKey = bucket.keys().find(key => key.includes("/source-block/"));
  if (sourceKey === undefined) {
    return yield* proofFailure(
      "locateSourceBlock",
      "AA-R7 source block is missing.",
    );
  }
  const original = bucket.read(sourceKey);
  if (original === undefined) {
    return yield* proofFailure(
      "readSourceBlock",
      "AA-R7 source block body is missing.",
    );
  }
  const corruptionPhases = yield* Effect.gen(function* () {
    bucket.remove(sourceKey);
    const missing = yield* runAnalysisPhase(bucket, authority, repository, {
      requestKey: `${REQUEST_KEY}:missing`,
      sourceArtifactRootSha256: root,
    });

    const mutated = yield* Effect.fromResult(mutateSourcePayload(original));
    bucket.write(sourceKey, mutated);
    const digest = yield* runAnalysisPhase(bucket, authority, repository, {
      requestKey: `${REQUEST_KEY}:digest-corrupt`,
      sourceArtifactRootSha256: root,
    });

    bucket.write(sourceKey, original);
    bucket.reportSize(sourceKey, original.byteLength + 1);
    const length = yield* runAnalysisPhase(bucket, authority, repository, {
      requestKey: `${REQUEST_KEY}:length-corrupt`,
      sourceArtifactRootSha256: root,
    });
    return Object.freeze({ missing, digest, length });
  }).pipe(Effect.ensuring(Effect.sync(() => bucket.write(sourceKey, original))));

  const counts = yield* proofPromise("loadDurableCounts", () => persistence.query<{
      analysis_count: string;
      revision_count: string;
    }>(`select
      (select count(*)::text from fx_system_application_analysis_v1) as analysis_count,
      (select count(*)::text from fx_system_application_revision_v2) as revision_count`));
  const count = counts.rows[0];
  if (count === undefined) {
    return yield* proofFailure(
      "loadDurableCounts",
      "AA-R7 durable counts are missing.",
    );
  }
  const coldLoads = yield* Effect.fromResult(requireLiteral(firstPhase.loads, 2));
  const replayColdLoads = yield* Effect.fromResult(
    requireLiteral(replayPhase.loads, 0),
  );
  const restartColdLoads = yield* Effect.fromResult(
    requireLiteral(restartPhase.loads, 2),
  );
  const durableAnalysisCount = yield* Effect.fromResult(
    requireLiteral(Number(count.analysis_count), 5),
  );
  const durableRevisionCount = yield* Effect.fromResult(
    requireLiteral(Number(count.revision_count), 2),
  );
  const missingObjectRejected = yield* Effect.fromResult(requireSourceRejection(
    corruptionPhases.missing.analysis,
    corruptionPhases.missing.loads,
  ));
  const digestCorruptionRejected = yield* Effect.fromResult(
    requireSourceRejection(
      corruptionPhases.digest.analysis,
      corruptionPhases.digest.loads,
    ),
  );
  const lengthCorruptionRejected = yield* Effect.fromResult(
    requireSourceRejection(
      corruptionPhases.length.analysis,
      corruptionPhases.length.loads,
    ),
  );
  return Object.freeze({
    lane,
    firstKind: "analyzed",
    replayKind: "analyzed",
    restartKind: "analyzed",
    coldLoads,
    replayColdLoads,
    restartColdLoads,
    exactReplayIdentity: true,
    restartDistinctIdentity: true,
    durableAnalysisCount,
    durableRevisionCount,
    missingObjectRejected,
    digestCorruptionRejected,
    lengthCorruptionRejected,
  });
  },
);

const runAnalysisPhase = Effect.fn("AAR7.runAnalysisPhase")(function* (
  bucket: MemorySourceArtifactBucket,
  authority: ApplicationAnalysisAuthority,
  repository: ApplicationAnalysisRepository,
  input: StandardApplicationAnalysisInput,
) {
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new MiniflareApplicationAnalysisLoader()),
    loader => analyzeStandardApplication(
      input,
      makeApplicationAnalysisSystem({
        authority,
        repository,
        host: hostCapabilities(bucket, loader),
      }),
    ).pipe(Effect.map(analysis => Object.freeze({
      analysis,
      loads: loader.loads,
    }))),
    loader => proofPromise("disposeAnalyzerLoader", () => loader.dispose()),
  );
});

const requireExactAnalyzedReplay = Effect.fn("AAR7.requireExactReplay")(
  function* (
  first: Extract<StandardApplicationAnalysis, { readonly kind: "analyzed" }>,
  replay: Extract<StandardApplicationAnalysis, { readonly kind: "analyzed" }>,
  ) {
  const firstReceipt = yield* Effect.fromResult(
    canonicalizeApplicationAnalysisReceiptV1(first.receipt),
  );
  const replayReceipt = yield* Effect.fromResult(
    canonicalizeApplicationAnalysisReceiptV1(replay.receipt),
  );
  const firstManifest = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(first.manifest),
  );
  const replayManifest = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(replay.manifest),
  );
  if (
    firstReceipt.canonicalText !== replayReceipt.canonicalText ||
    firstManifest.canonicalText !== replayManifest.canonicalText
  ) {
    return yield* proofFailure(
      "verifyReplay",
      "AA-R7 durable replay changed terminal receipt or manifest identity.",
    );
  }
  },
);

const requireDistinctRestart = Effect.fn("AAR7.requireDistinctRestart")(
  function* (
  first: Extract<StandardApplicationAnalysis, { readonly kind: "analyzed" }>,
  restart: Extract<StandardApplicationAnalysis, { readonly kind: "analyzed" }>,
  ) {
  const firstManifest = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(first.manifest),
  );
  const restartManifest = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(restart.manifest),
  );
  if (
    first.receipt.analysisId === restart.receipt.analysisId ||
    first.receipt.candidateId === restart.receipt.candidateId ||
    firstManifest.canonicalText !== restartManifest.canonicalText ||
    first.receipt.sourceArtifactRootSha256 !==
      restart.receipt.sourceArtifactRootSha256 ||
    first.receipt.analyzerIdentity !== restart.receipt.analyzerIdentity ||
    first.receipt.analyzerPolicyIdentity !==
      restart.receipt.analyzerPolicyIdentity
  ) {
    return yield* proofFailure(
      "verifyRestart",
      "AA-R7 fresh restart did not preserve source identity with a new durable analysis.",
    );
  }
  },
);

function mutateSourcePayload(
  frame: Uint8Array,
): Result.Result<Uint8Array, ApplicationAnalysisColdProofError> {
  if (frame.byteLength === 0) {
    return Result.fail(proofFailure(
      "mutateSourcePayload",
      "AA-R7 source block frame has no payload byte.",
    ));
  }
  const mutated = copyBytes(frame);
  // Source Artifact V2 block framing places the opaque payload last, so this
  // preserves the domain, counters, frame length, and structural decodability.
  mutated[mutated.byteLength - 1] ^= 1;
  return Result.succeed(mutated);
}

function hostCapabilities(
  bucket: MemorySourceArtifactBucket,
  loader: MiniflareApplicationAnalysisLoader,
): ApplicationAnalysisHostCapabilities {
  return Object.freeze({
    source: makeApplicationAnalysisR2SourceReader(bucket),
    loader,
  });
}

const uploadSource = Effect.fn("AAR7.uploadSource")(function* (
  core: SourceArtifactV2UploadCore,
  modules: ReadonlyArray<StandardApplicationSourceModule>,
) {
  let receipt = yield* core.beginUpload({
    uploadId: UPLOAD_ID,
    commandId: "begin",
    ceilings: CEILINGS,
    admission: ADMISSION,
  });
  for (const [ordinal, module] of modules.entries()) {
    receipt = yield* core.beginModule({
      uploadId: UPLOAD_ID,
      generation: receipt.generation,
      expectedFence: receipt.mutationFence,
      commandId: `module-${ordinal}-begin`,
      admission: ADMISSION,
      path: module.path,
      roles: module.roles,
      environment: "isolate",
    });
    receipt = yield* core.appendBlock({
      uploadId: UPLOAD_ID,
      generation: receipt.generation,
      expectedFence: receipt.mutationFence,
      commandId: `module-${ordinal}-source`,
      admission: ADMISSION,
      kind: "source",
      blockIndex: 0,
      bytes: module.sourceBytes,
    });
    receipt = yield* core.closeModule({
      uploadId: UPLOAD_ID,
      generation: receipt.generation,
      expectedFence: receipt.mutationFence,
      commandId: `module-${ordinal}-close`,
      admission: ADMISSION,
    });
  }
  return yield* core.finalize({
    uploadId: UPLOAD_ID,
    generation: receipt.generation,
    expectedFence: receipt.mutationFence,
    commandId: "finalize",
    admission: ADMISSION,
  });
});

function memoryAttemptStore(): SourceArtifactV2AttemptStore {
  const rows = new Map<string, SourceArtifactV2Attempt>();
  return Object.freeze({
    read: (uploadId: string) => Effect.succeed(rows.get(uploadId) ?? null),
    write: (mutation: SourceArtifactV2AttemptMutation) => Effect.suspend(() => {
      const current = rows.get(mutation.uploadId);
      if (current?.lastCommandId === mutation.commandId) {
        return current.lastCommandDigest === mutation.commandDigest
          ? Effect.succeed(current)
          : Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
              uploadId: mutation.uploadId,
              reason: "conflictingReplay",
            }));
      }
      if (mutation.expectedFence === null && current !== undefined) {
        return Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
          uploadId: mutation.uploadId,
          reason: "alreadyExists",
        }));
      }
      if (mutation.expectedFence !== null && current === undefined) {
        return Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
          uploadId: mutation.uploadId,
          reason: "notFound",
        }));
      }
      if (
        mutation.expectedFence !== null &&
        current !== undefined &&
        current.mutationFence !== mutation.expectedFence
      ) {
        return Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
          uploadId: mutation.uploadId,
          reason: "staleFence",
        }));
      }
      rows.set(mutation.uploadId, mutation.next);
      return Effect.succeed(mutation.next);
    }),
  });
}

class MemorySourceArtifactBucket implements SourceArtifactV2R2Bucket {
  readonly #objects = new Map<string, Uint8Array>();
  readonly #reportedSizes = new Map<string, number>();

  put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<Readonly<Record<string, never>> | null> {
    if (this.#objects.has(key)) return Promise.resolve(null);
    this.#objects.set(key, copyBytes(new Uint8Array(value)));
    return Promise.resolve(Object.freeze({}));
  }

  get(key: string): PromiseLike<Readonly<Record<string, unknown>> | null> {
    const bytes = this.#objects.get(key);
    return Promise.resolve(bytes === undefined
      ? null
      : storedObject(bytes, this.#reportedSizes.get(key) ?? bytes.byteLength));
  }

  keys(): ReadonlyArray<string> {
    return [...this.#objects.keys()];
  }

  read(key: string): Uint8Array | undefined {
    const bytes = this.#objects.get(key);
    return bytes === undefined ? undefined : copyBytes(bytes);
  }

  remove(key: string): void {
    this.#objects.delete(key);
    this.#reportedSizes.delete(key);
  }

  write(key: string, bytes: Uint8Array): void {
    this.#objects.set(key, copyBytes(bytes));
    this.#reportedSizes.delete(key);
  }

  reportSize(key: string, size: number): void {
    if (!this.#objects.has(key)) {
      throw new Error("AA-R7 cannot alter metadata for a missing object.");
    }
    this.#reportedSizes.set(key, size);
  }
}

function storedObject(
  bytes: Uint8Array,
  reportedSize: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    size: reportedSize,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(copyBytes(bytes));
        controller.close();
      },
    }),
  });
}

class MiniflareApplicationAnalysisLoader implements WorkerLoader {
  loads = 0;
  readonly #runtimes = new Set<Miniflare>();
  readonly #disposals: Array<Promise<void>> = [];

  get(): WorkerStub {
    throw new Error("AA-R7 cold analysis forbids cached Worker Loader state.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    const runtime = new Miniflare({
      compatibilityDate: "2026-06-14",
      modules: true,
      script: loaderBridgeSource(code),
      workerLoaders: { LOADER: {} },
    });
    this.#runtimes.add(runtime);
    return new MiniflareWorkerStub(runtime, () => this.#release(runtime));
  }

  async dispose(): Promise<void> {
    const live = [...this.#runtimes];
    this.#runtimes.clear();
    await Promise.all([
      ...this.#disposals.splice(0),
      ...live.map(runtime => runtime.dispose()),
    ]);
  }

  #release(runtime: Miniflare): void {
    if (!this.#runtimes.delete(runtime)) return;
    this.#disposals.push(runtime.dispose());
  }
}

class MiniflareWorkerStub implements WorkerStub {
  constructor(
    private readonly runtime: Miniflare,
    private readonly released: () => void,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    if (name !== APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT) {
      throw new Error("AA-R7 requested an unexpected analyzer entrypoint.");
    }
    const runtime = this.runtime;
    const released = this.released;
    const entrypoint = {
      analyze: async () => {
        const response = await runtime.dispatchFetch("https://aa-r7.invalid/");
        const value = await response.json();
        if (typeof value !== "object" || value === null) {
          throw new Error("AA-R7 analyzer returned a non-object RPC value.");
        }
        return Object.defineProperty(value, Symbol.dispose, {
          configurable: true,
          value: () => {
            released();
          },
        });
      },
      fetch: async () => new Response(null, { status: 501 }),
      connect: () => {
        throw new Error("AA-R7 analyzer entrypoint forbids socket connections.");
      },
    };
    // SAFETY: this test-owned WorkerStub exposes the one RPC method requested
    // by ApplicationAnalysisHost plus the Fetcher transport members required
    // by Cloudflare's generic Worker Loader declaration.
    // oxlint-disable-next-line flarex/no-chained-type-assertions, flarex/no-banned-type-assertions -- REVIEW: host - Cloudflare's unknown branded RPC provider cannot be constructed structurally in a test adapter
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("AA-R7 does not load Durable Object classes.");
  }
}

function loaderBridgeSource(definition: WorkerLoaderWorkerCode): string {
  return `export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(${JSON.stringify(definition)});
    const stub = worker.getEntrypoint(${JSON.stringify(
      APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
    )});
    const result = await stub.analyze();
    try { return Response.json(result); }
    finally { result?.[Symbol.dispose]?.(); }
  },
};`;
}

function definitionInput() {
  return {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 64,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "recipes",
        functions: [{
          exportName: "save",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: { type: "any" },
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "recipes.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode(SOURCE),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "recipes",
        artifactModulePath: "recipes.js",
      }],
      executionPath: "recipes.js",
      schemaPath: null,
      authPath: null,
    },
  } as const;
}

function uuidSequence(...values: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1];
    if (value === undefined) throw new Error("AA-R7 UUID sequence is empty.");
    index += 1;
    return `aa070000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
  };
}

function uuidCounter(start: number): () => string {
  let value = start;
  return () => {
    const current = value;
    value += 1;
    return `aa070000-0000-4000-8000-${current.toString().padStart(12, "0")}`;
  };
}

function requireLiteral<const Value extends number>(
  value: number,
  expected: Value,
): Result.Result<Value, ApplicationAnalysisColdProofError> {
  return value === expected
    ? Result.succeed(expected)
    : Result.fail(proofFailure(
      "verifyLiteral",
      `Expected ${expected}, observed ${value}.`,
    ));
}

function requireTrue(
  value: boolean,
): Result.Result<true, ApplicationAnalysisColdProofError> {
  return value
    ? Result.succeed(true)
    : Result.fail(proofFailure(
      "verifyRejection",
      "Expected AA-R7 fail-closed rejection.",
    ));
}

function requireSourceRejection(
  result: StandardApplicationAnalysis,
  loaderCalls: number,
): Result.Result<true, ApplicationAnalysisColdProofError> {
  return requireTrue(
    result.kind === "rejected" &&
      result.receipt.status === "rejected" &&
      result.receipt.failureCode === "invalid_source_artifact" &&
      loaderCalls === 0,
  );
}
