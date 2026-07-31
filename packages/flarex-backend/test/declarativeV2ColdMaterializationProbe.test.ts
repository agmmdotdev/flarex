import { webcrypto } from "node:crypto";
import { Effect, Exit, Option, Result } from "effect";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
  type DeclarativeV2FunctionGroupEntryFrameV1,
  type DeclarativeV2FunctionGroupManifestFrameV1,
  type DeclarativeV2RuntimeProjectionFrameV1,
  type DeclarativeV2RuntimeProjectionModuleFrameV1,
  type DeclarativeV2RuntimeProjectionSetFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  frameDeclarativeV2RuntimeRootSha256PreimageV1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";
import { beforeAll, describe, expect, it } from "vitest";

import {
  probeDeclarativeV2ColdMaterializationV1,
  type DeclarativeV2ColdMaterializationProbeInputV1,
} from "../src/artifactRuntime/DeclarativeV2ColdMaterializationProbe";
import {
  makeDeclarativeV2RuntimeArtifactR2StoreV1,
  type DeclarativeV2RuntimeArtifactR2BucketV1,
} from "../src/artifactRuntime/DeclarativeV2RuntimeArtifactStore";
import { makeLiveDeclarativeV2RuntimeArtifactSha256V1 } from "../src/artifactRuntime/DeclarativeV2RuntimeArtifactSha256";

const UTF8 = new TextEncoder();
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 1_048_576,
  maximumCanonicalBytes: 1_048_576,
});
const ROOT_BUDGET = Object.freeze({
  maximumDigests: 16,
  maximumPreimageBytes: 1_048_576,
});
const R2_BUDGET = Object.freeze({
  maximumBodyBytes: 1_048_576,
  maximumHashBytes: 1_048_576,
});
const PROBE_BUDGET = Object.freeze({
  maximumGroups: 2,
  maximumModulesPerGroup: 8,
  maximumRawBytesPerGroup: 1_048_576,
  maximumObjects: 16,
  maximumObjectBytes: 4 * 1_048_576,
  maximumCompressedBytesPerGroup: 1_048_576,
  maximumStartupMilliseconds: 1_000,
});

describe("Declarative V2 R2-backed cold materialization", () => {
  beforeAll(() => {
    if (globalThis.crypto === undefined) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      });
    }
  });

  it("publishes immutable objects and cold-materializes only the referenced bodies", async () => {
    const fixture = await makeFixture();
    const coldStore = makeDeclarativeV2RuntimeArtifactR2StoreV1(
      fixture.bucket,
      makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
    );
    const observed: string[] = [];
    const receipts = await Effect.runPromise(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        fixture.input,
        coldStore,
        {
          identity: "worker-loader-compatible/test-v1",
          materialize: request => Effect.sync(() => {
            observed.push(`${request.group}:${request.executionModule}:${request.modules[0]?.path}`);
            return { compressedByteLength: 17, startupMilliseconds: 3 };
          }),
        },
      ),
    ));
    expect(observed).toEqual(["transaction:_flarex/execution.js:orders.js"]);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.frame.candidateSha256).toEqual(fixture.input.candidateSha256);
    expect(receipts[0]?.frame.projectionSha256)
      .toEqual(fixture.input.publication.projections[0]?.reference.sha256);
    expect(receipts[0]?.frame.compressedByteLength).toBe(17n);
    expect(fixture.bucket.objects.size).toBe(6);
  });

  it("fails closed for missing, corrupt, and mismatched R2 authority", async () => {
    const missing = await makeFixture();
    missing.bucket.objects.delete(
      missing.input.publication.projections[0]!.modules[0]!.reference.objectKey,
    );
    const missingResult = await runProbeResult(missing);
    expect(missingResult).toMatchObject({
      _tag: "DeclarativeV2RuntimeArtifactR2NotFoundV1Error",
    });

    const corrupt = await makeFixture();
    const moduleKey = corrupt.input.publication.projections[0]!.modules[0]!.reference.objectKey;
    const bytes = new Uint8Array(corrupt.bucket.objects.get(moduleKey)!);
    bytes[bytes.length - 1] ^= 1;
    corrupt.bucket.objects.set(moduleKey, bytes);
    const corruptResult = await runProbeResult(corrupt);
    expect(corruptResult).toMatchObject({
      _tag: "DeclarativeV2RuntimeArtifactR2CorruptionV1Error",
      reason: "digestMismatch",
    });

    const mismatched = await makeFixture();
    const projection = mismatched.input.publication.projections[0]!;
    const forged = {
      ...mismatched.input,
      publication: {
        ...mismatched.input.publication,
        projections: [{
          ...projection,
          reference: {
            ...projection.reference,
            objectKey: `${projection.reference.objectKey}-forged`,
          },
        }],
      },
    } satisfies DeclarativeV2ColdMaterializationProbeInputV1;
    const mismatchResult = await Effect.runPromise(Effect.result(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        forged,
        mismatched.store,
        materializer(),
      ),
    )));
    expect(Result.isFailure(mismatchResult)).toBe(true);
    if (Result.isFailure(mismatchResult)) {
      expect(mismatchResult.failure).toMatchObject({
        _tag: "DeclarativeV2ColdMaterializationProbeV1Error",
        reason: "authorityMismatch",
      });
    }
  });

  it("snapshots the cold-materialization budget before asynchronous reads", async () => {
    const fixture = await makeFixture();
    const reads = new Map<PropertyKey, number>();
    const budget = new Proxy({ ...PROBE_BUDGET }, {
      get(target, key, receiver) {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        if (count > 1) throw new Error(`budget reread:${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
    });
    const receipts = await Effect.runPromise(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        { ...fixture.input, budget },
        fixture.store,
        materializer(),
      ),
    ));
    expect(receipts).toHaveLength(1);
    expect([...reads.values()].every(count => count === 1)).toBe(true);
  });

  it("rejects short bodies and maps throwing R2 metadata access to typed resource failure", async () => {
    const bytes = UTF8.encode("runtime-object");
    const digestValue = await sha256(bytes);
    let shortBodyCancellations = 0;
    let shortBodyReleases = 0;
    let shortBodyRead = false;
    const shortStore = makeDeclarativeV2RuntimeArtifactR2StoreV1(
      {
        put: async () => null,
        get: async () => ({
          size: bytes.byteLength + 1,
          body: {
            getReader: () => ({
              read: async () => {
                if (shortBodyRead) return { done: true };
                shortBodyRead = true;
                return { done: false, value: bytes };
              },
              cancel: () => {
                shortBodyCancellations += 1;
                return new Promise<never>(() => undefined);
              },
              releaseLock: () => {
                shortBodyReleases += 1;
              },
            }),
          },
        }),
      },
      makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
    );
    const short = await Effect.runPromise(Effect.result(
      shortStore.readImmutableAdmitted(
        "runtime-projection",
        digestValue,
        () => Effect.void,
      ),
    ));
    expect(Result.isFailure(short)).toBe(true);
    if (Result.isFailure(short)) {
      expect(short.failure).toMatchObject({
        _tag: "DeclarativeV2RuntimeArtifactR2CorruptionV1Error",
        reason: "sizeMismatch",
      });
    }
    expect(shortBodyCancellations).toBe(1);
    expect(shortBodyReleases).toBe(1);

    const throwingStore = makeDeclarativeV2RuntimeArtifactR2StoreV1(
      {
        put: async () => null,
        get: async () => Object.defineProperty({}, "size", {
          get() {
            throw new Error("foreign metadata getter");
          },
        }),
      },
      makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
    );
    const throwing = await Effect.runPromise(Effect.result(
      throwingStore.readImmutableAdmitted(
        "runtime-projection",
        digestValue,
        () => Effect.void,
      ),
    ));
    expect(Result.isFailure(throwing)).toBe(true);
    if (Result.isFailure(throwing)) {
      expect(throwing.failure).toMatchObject({
        _tag: "DeclarativeV2RuntimeArtifactR2ResourceV1Error",
        operation: "readBody",
      });
    }

    const throwingBodyStore = makeDeclarativeV2RuntimeArtifactR2StoreV1(
      {
        put: async () => null,
        get: async () => Object.defineProperties({}, {
          size: { value: bytes.byteLength },
          body: {
            get() {
              throw new Error("foreign body getter");
            },
          },
        }),
      },
      makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
    );
    const throwingBody = await Effect.runPromise(Effect.result(
      throwingBodyStore.readImmutableAdmitted(
        "runtime-projection",
        digestValue,
        () => Effect.void,
      ),
    ));
    expect(Result.isFailure(throwingBody)).toBe(true);
    if (Result.isFailure(throwingBody)) {
      expect(throwingBody.failure).toMatchObject({
        _tag: "DeclarativeV2RuntimeArtifactR2ResourceV1Error",
        operation: "readBody",
      });
    }
  });

  it("reconciles a lost put response and replays the exact immutable object", async () => {
    const bucket = new MemoryR2Bucket();
    bucket.failAfterNextPut = true;
    const store = makeDeclarativeV2RuntimeArtifactR2StoreV1(
      bucket,
      makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
    );
    const bytes = UTF8.encode("canonical-runtime-object");
    const digest = await sha256(bytes);
    const first = await Effect.runPromise(
      store.putImmutable("runtime-projection", digest, bytes, R2_BUDGET),
    );
    const replay = await Effect.runPromise(
      store.putImmutable("runtime-projection", digest, bytes, R2_BUDGET),
    );
    expect(first).toEqual(replay);
    expect(bucket.objects.size).toBe(1);
  });

  it("enforces object, raw, compressed, and startup ceilings before receipt publication", async () => {
    const fixture = await makeFixture();
    const objectResult = await Effect.runPromise(Effect.result(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        { ...fixture.input, budget: { ...PROBE_BUDGET, maximumObjects: 1 } },
        fixture.store,
        materializer(),
      ),
    )));
    expect(Result.isFailure(objectResult)).toBe(true);
    const rawResult = await Effect.runPromise(Effect.result(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        { ...fixture.input, budget: { ...PROBE_BUDGET, maximumRawBytesPerGroup: 1 } },
        fixture.store,
        materializer(),
      ),
    )));
    expect(Result.isFailure(rawResult)).toBe(true);
    const compressedResult = await Effect.runPromise(Effect.result(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        fixture.input,
        fixture.store,
        materializer({ compressedByteLength: PROBE_BUDGET.maximumCompressedBytesPerGroup + 1 }),
      ),
    )));
    expect(Result.isFailure(compressedResult)).toBe(true);
    const startupResult = await Effect.runPromise(Effect.result(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        fixture.input,
        fixture.store,
        materializer({ startupMilliseconds: PROBE_BUDGET.maximumStartupMilliseconds + 1 }),
      ),
    )));
    expect(Result.isFailure(startupResult)).toBe(true);
  });

  it("keeps R2 reads and host materialization interruptible and scoped", async () => {
    const stalled = await makeFixture();
    stalled.bucket.stallReads = true;
    const stalledResult = await Effect.runPromise(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        stalled.input,
        stalled.store,
        materializer(),
      ).pipe(Effect.timeoutOption("10 millis")),
    ));
    expect(Option.isNone(stalledResult)).toBe(true);
    expect(stalled.bucket.cancelledReads).toBeGreaterThan(0);

    const fixture = await makeFixture();
    const result = await Effect.runPromise(Effect.scoped(
      probeDeclarativeV2ColdMaterializationV1(
        fixture.input,
        fixture.store,
        {
          identity: "worker-loader-compatible/test-v1",
          materialize: () => Effect.never,
        },
      ).pipe(Effect.timeoutOption("10 millis")),
    ));
    expect(Option.isNone(result)).toBe(true);
  });
});

function materializer(overrides: Partial<{ compressedByteLength: number; startupMilliseconds: number }> = {}) {
  return {
    identity: "worker-loader-compatible/test-v1",
    materialize: () => Effect.succeed({
      compressedByteLength: overrides.compressedByteLength ?? 1,
      startupMilliseconds: overrides.startupMilliseconds ?? 1,
    }),
  };
}

async function runProbeResult(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  const result = await Effect.runPromise(Effect.result(Effect.scoped(
    probeDeclarativeV2ColdMaterializationV1(
      fixture.input,
      fixture.store,
      materializer(),
    ),
  )));
  expect(Result.isFailure(result)).toBe(true);
  return Result.isFailure(result) ? result.failure : undefined;
}

async function makeFixture() {
  const bucket = new MemoryR2Bucket();
  const store = makeDeclarativeV2RuntimeArtifactR2StoreV1(
    bucket,
    makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
  );
  const sourceBytes = UTF8.encode("export const place = () => null;\n");
  const executionSourceBytes = UTF8.encode("export const execute = () => null;\n");
  const moduleFrames = [
    Object.freeze({
      kind: "runtime_projection_module",
      group: "transaction",
      moduleOrdinal: 0n,
      modulePath: "orders.js",
      roles: 1n,
      sourceSha256: await sha256(sourceBytes),
      sourceBytes,
    }),
    Object.freeze({
      kind: "runtime_projection_module",
      group: "transaction",
      moduleOrdinal: 1n,
      modulePath: "_flarex/execution.js",
      roles: 8n,
      sourceSha256: await sha256(executionSourceBytes),
      sourceBytes: executionSourceBytes,
    }),
  ] satisfies ReadonlyArray<DeclarativeV2RuntimeProjectionModuleFrameV1>;
  const moduleObjects = await Promise.all(moduleFrames.map(frame => publish(store, "runtime-projection-module", frame)));
  const rootPreimage = Result.getOrThrow(frameDeclarativeV2RuntimeRootSha256PreimageV1(
    "runtimeProjectionModules",
    "transaction",
    moduleObjects.map(item => item.reference.sha256),
    ROOT_BUDGET,
  ));
  const projectionFrame = Object.freeze({
    kind: "runtime_projection",
    group: "transaction",
    executionModule: "_flarex/execution.js",
    moduleCount: 2n,
    rawByteLength: BigInt(sourceBytes.byteLength + executionSourceBytes.byteLength),
    moduleRootSha256: await sha256(rootPreimage),
  } satisfies DeclarativeV2RuntimeProjectionFrameV1);
  const projectionObject = await publish(store, "runtime-projection", projectionFrame);
  const projectionSetFrame = Object.freeze({
    kind: "runtime_projection_set",
    groupCount: 1n,
    transactionProjectionSha256: projectionObject.reference.sha256,
    edgeActionProjectionSha256: null,
  } satisfies DeclarativeV2RuntimeProjectionSetFrameV1);
  const projectionSetObject = await publish(store, "runtime-projection-set", projectionSetFrame);
  const functionEntry = Object.freeze({
    kind: "function_group_entry",
    functionOrdinal: 0n,
    functionPath: "orders:place",
    executionModule: "orders.js",
    exportName: "place",
    handlerKind: "mutation",
    visibility: "public",
    group: "transaction",
    projectionSha256: projectionObject.reference.sha256,
  } satisfies DeclarativeV2FunctionGroupEntryFrameV1);
  const entryObject = await publish(store, "function-group-entry", functionEntry);
  const functionRootPreimage = Result.getOrThrow(frameDeclarativeV2RuntimeRootSha256PreimageV1(
    "functionGroupEntries",
    null,
    [entryObject.reference.sha256],
    ROOT_BUDGET,
  ));
  const manifestFrame = Object.freeze({
    kind: "function_group_manifest",
    runtimeProjectionSetSha256: projectionSetObject.reference.sha256,
    functionCount: 1n,
    functionRootSha256: await sha256(functionRootPreimage),
    validatorRootSha256: digest(5),
    declaredHandlerSetSha256: digest(6),
  } satisfies DeclarativeV2FunctionGroupManifestFrameV1);
  const manifestObject = await publish(store, "function-group-manifest", manifestFrame);
  const candidate = candidateFixture(
    projectionSetObject.reference.sha256,
    manifestObject.reference.sha256,
    manifestFrame.validatorRootSha256,
    manifestFrame.declaredHandlerSetSha256,
  );
  const input = Object.freeze({
    candidate,
    candidateSha256: await hashFrame(candidate),
    publication: Object.freeze({
      projectionSetReference: projectionSetObject.reference,
      manifestReference: manifestObject.reference,
      manifestFrame,
      projections: Object.freeze([Object.freeze({
        frame: projectionFrame,
        reference: projectionObject.reference,
        modules: Object.freeze(moduleFrames.map((frame, index) => Object.freeze({
          group: frame.group,
          moduleOrdinal: frame.moduleOrdinal,
          modulePath: frame.modulePath,
          roles: frame.roles,
          sourceByteLength: BigInt(frame.sourceBytes.byteLength),
          sourceSha256: frame.sourceSha256,
          reference: moduleObjects[index]!.reference,
        }))),
      })]),
      functionEntries: Object.freeze([Object.freeze({ frame: functionEntry, reference: entryObject.reference })]),
    }),
    budget: PROBE_BUDGET,
  } satisfies DeclarativeV2ColdMaterializationProbeInputV1);
  return { bucket, store, input };
}

async function publish(
  store: ReturnType<typeof makeDeclarativeV2RuntimeArtifactR2StoreV1>,
  kind: Parameters<typeof store.putImmutable>[0],
  frame: Parameters<typeof encodeDeclarativeV2PhysicalFrameV1>[0],
) {
  const bytes = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET)).canonicalBytes;
  const digest = await sha256(bytes);
  const reference = await Effect.runPromise(store.putImmutable(kind, digest, bytes, R2_BUDGET));
  return { reference, bytes };
}

class MemoryR2Bucket implements DeclarativeV2RuntimeArtifactR2BucketV1 {
  readonly objects = new Map<string, Uint8Array>();
  failAfterNextPut = false;
  stallReads = false;
  cancelledReads = 0;
  async put(key: string, value: ArrayBuffer): Promise<unknown> {
    if (!this.objects.has(key)) this.objects.set(key, new Uint8Array(value.slice(0)));
    if (this.failAfterNextPut) {
      this.failAfterNextPut = false;
      throw new Error("lost put response");
    }
    return null;
  }
  async get(key: string): Promise<unknown> {
    const bytes = this.objects.get(key);
    if (bytes === undefined) return null;
    const captured = new Uint8Array(bytes);
    const owner = this;
    return {
      size: captured.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          if (owner.stallReads) return;
          controller.enqueue(captured);
          controller.close();
        },
        cancel() {
          owner.cancelledReads += 1;
        },
      }),
    };
  }
}

function candidateFixture(
  runtimeProjectionSetSha256: Uint8Array,
  functionGroupManifestSha256: Uint8Array,
  validatorRootSha256: Uint8Array,
  declaredHandlerSetSha256: Uint8Array,
): DeclarativeV2CandidateFrameV1 {
  return Object.freeze({
    kind: "candidate", projectId: "project", deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-31T00:00:00.000Z", scopeId: "scope",
    storageGeneration: "flarexdb_v1", storageGenerationFence: 1n, scopeEpoch: "epoch",
    sourceRootSha256: digest(1), sourceSelectorSha256: digest(2), sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3), semanticSelectorSha256: digest(4), semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1", semanticPolicyIdentity: "policy-v1", packageSha256: digest(7),
    artifactSha256: digest(8), artifactRuntimeIdentity: "dynamic-worker", schemaArtifactSha256: digest(9),
    schemaBindingSha256: digest(10), validatorRootSha256, coreLanguageIdentity: "core-v1", abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1", unicodeIdentity: "unicode-v1", parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v1", verifierIdentity: "verifier-v1", declaredHandlerSetSha256,
    deploymentAnalysisCodecIdentity: "analysis-v1", deploymentAnalysisByteLength: 1n,
    deploymentAnalysisSha256: digest(11), deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 1n, deploymentCodegenAnalysisSha256: digest(12),
    runtimeProjectionSetSha256, functionGroupManifestSha256,
    readinessPolicyIdentity: "flarex.readiness/runtime-projection-cold-materialization/v1",
  });
}

async function hashFrame(frame: Parameters<typeof encodeDeclarativeV2PhysicalFrameV1>[0]) {
  return sha256(Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET)).canonicalBytes);
}
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes.slice().buffer));
}
function digest(seed: number): Uint8Array { return new Uint8Array(32).fill(seed); }
