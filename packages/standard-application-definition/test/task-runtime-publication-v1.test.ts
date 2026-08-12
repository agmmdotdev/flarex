import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Brand, Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_ENTRY_ROOT_CODEC_V1,
  TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
  TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ROOT_CODEC_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
  decodeTaskRuntimeEntryRootPreimageV1,
  decodeTaskRuntimeEntryPreimageV1,
  decodeTaskRuntimeGroupManifestPreimageV1,
  decodeTaskRuntimeMaterializationSpecPreimageV1,
  decodeTaskRuntimeMaterializationSpecV1,
  decodeTaskRuntimeModuleRootPreimageV1,
  decodeTaskRuntimeProjectionModuleFramesV1,
  decodeTaskRuntimeProjectionModulePreimageV1,
  decodeTaskRuntimeProjectionPreimageV1,
  encodeTaskRuntimeEntryRootPreimageV1,
  encodeTaskRuntimeEntryPreimageV1,
  encodeTaskRuntimeGroupManifestPreimageV1,
  encodeTaskRuntimeMaterializationSpecPreimageV1,
  encodeTaskRuntimeModuleRootPreimageV1,
  encodeTaskRuntimeProjectionModulePreimageV1,
  encodeTaskRuntimeProjectionPreimageV1,
  hashTaskRuntimeEntryRootV1,
  hashTaskRuntimeGroupManifestFrameV1,
  hashTaskRuntimeMaterializationSpecV1,
  hashTaskRuntimeProjectionFrameV1,
  hashTaskRuntimeProjectionModuleFrameV1,
  hashTaskRuntimeProjectionModuleRootV1,
  makeLiveStandardApplicationTaskSha256V1,
  verifyTaskRuntimeProjectionV1,
  type InvalidTaskRuntimePublicationV1Error,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
  type TaskRuntimeEntryFrameV1,
} from "../src/taskDefinition/v1.js";

const UTF8 = new TextEncoder();
const SHA256 = makeLiveStandardApplicationTaskSha256V1();
const brandDigest = Brand.nominal<TaskDefinitionSha256V1>();
const brandTaskId = Brand.nominal<TaskIdV1>();

describe("task runtime publication V1", () => {
  it("emits exact golden canonical bodies for every new object role", async () => {
    const sourceBytes = UTF8.encode("export const run = () => 1;\n");
    const sourceSha256 = await sha256(sourceBytes);
    const module = moduleFrame({ sourceBytes, sourceSha256 });
    const moduleBytes = succeed(encodeTaskRuntimeProjectionModulePreimageV1(module));
    expect(text(moduleBytes)).toBe(
      `{"codec":"${TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1}","frame":{"artifactModulePath":"tasks/run.mjs","group":"durable_task","kind":"runtime_projection_module","moduleFormat":"es_module","moduleOrdinal":"0","rawByteLength":"28","sourceBytes":"ZXhwb3J0IGNvbnN0IHJ1biA9ICgpID0-IDE7Cg","sourceEnvironment":"isolate","sourceRoles":"8","sourceSha256":"${hex(sourceSha256)}"}}`,
    );

    const moduleFrameSha256 = await sha256(moduleBytes);
    const moduleRootBytes = succeed(encodeTaskRuntimeModuleRootPreimageV1([
      moduleFrameSha256,
    ]));
    expect(text(moduleRootBytes)).toBe(
      `{"codec":"${TASK_RUNTIME_MODULE_ROOT_CODEC_V1}","digests":["${hex(moduleFrameSha256)}"]}`,
    );
    const moduleRootSha256 = await sha256(moduleRootBytes);
    const projection = {
      kind: "task_runtime_projection",
      group: "durable_task",
      executionModule: "tasks/run.mjs",
      moduleCount: 1n,
      rawByteLength: BigInt(sourceBytes.byteLength),
      moduleRootSha256,
    } as const;
    const projectionBytes = succeed(encodeTaskRuntimeProjectionPreimageV1(
      projection,
    ));
    expect(text(projectionBytes)).toBe(
      `{"codec":"${TASK_RUNTIME_PROJECTION_CODEC_V1}","frame":{"executionModule":"tasks/run.mjs","group":"durable_task","kind":"task_runtime_projection","moduleCount":"1","moduleRootSha256":"${hex(moduleRootSha256)}","rawByteLength":"28"}}`,
    );

    const spec = materializationSpec();
    const specBytes = succeed(encodeTaskRuntimeMaterializationSpecPreimageV1(spec));
    expect(text(specBytes)).toBe(
      `{"codec":"${TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1}","spec":{"bridgeAbiIdentity":"${TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1}","compatibilityDate":"2026-08-12","compatibilityFlags":["nodejs_compat"],"kind":"task_runtime_materialization_spec","moduleEntryPolicyIdentity":"${TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1}","runtimeContractIdentity":"${TASK_RUNTIME_CONTRACT_IDENTITY_V1}","runtimeImplementationVersion":"worker-loader-2026.08.12","runtimeProfileIdentity":"${TASK_RUNTIME_PROFILE_IDENTITY_V1}","supportedComputeProfiles":["standard-1x","standard-2x"]}}`,
    );
    const manifest = groupManifest({
      taskRuntimeProjectionSha256: await sha256(projectionBytes),
      taskRuntimeMaterializationSpecSha256: await sha256(specBytes),
    });
    const manifestBytes = succeed(encodeTaskRuntimeGroupManifestPreimageV1(
      manifest,
    ));
    expect(text(manifestBytes)).toBe(
      `{"codec":"${TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1}","frame":{"kind":"task_runtime_group_manifest","taskCatalogSha256":"${hex(manifest.taskCatalogSha256)}","taskCount":"1","taskEntryRootSha256":"${hex(manifest.taskEntryRootSha256)}","taskRuntimeMaterializationSpecSha256":"${hex(manifest.taskRuntimeMaterializationSpecSha256)}","taskRuntimeProjectionSha256":"${hex(manifest.taskRuntimeProjectionSha256)}"}}`,
    );

    expect(decodeTaskRuntimeProjectionModulePreimageV1(moduleBytes)).toEqual(
      expect.objectContaining({ _tag: "Success" }),
    );
    expect(decodeTaskRuntimeProjectionPreimageV1(projectionBytes)).toEqual(
      expect.objectContaining({ _tag: "Success" }),
    );
    expect(decodeTaskRuntimeMaterializationSpecPreimageV1(specBytes)).toEqual(
      expect.objectContaining({ _tag: "Success" }),
    );
    expect(decodeTaskRuntimeGroupManifestPreimageV1(manifestBytes)).toEqual(
      expect.objectContaining({ _tag: "Success" }),
    );
    const entryBytes = succeed(encodeTaskRuntimeEntryPreimageV1(entry(0n, "alpha")));
    expect(decodeTaskRuntimeEntryPreimageV1(entryBytes)).toEqual(
      expect.objectContaining({ _tag: "Success" }),
    );
  });

  it("owns source and digest bytes across decode boundaries", async () => {
    const sourceBytes = UTF8.encode("export default 1");
    const sourceSha256 = await sha256(sourceBytes);
    const input = moduleFrame({ sourceBytes, sourceSha256 });
    const encoded = succeed(encodeTaskRuntimeProjectionModulePreimageV1(input));
    const decoded = succeed(decodeTaskRuntimeProjectionModulePreimageV1(encoded));
    sourceBytes[0] = 0;
    sourceSha256[0] = (sourceSha256[0] ?? 0) ^ 0xff;
    encoded[0] = 0;
    expect(text(decoded.sourceBytes)).toBe("export default 1");
    expect(decoded.sourceSha256[0]).not.toBe(sourceSha256[0]);
  });

  it("rejects hostile records, accessors, excess fields, and reserved paths", async () => {
    const sourceBytes = UTF8.encode("export default 1");
    const sourceSha256 = await sha256(sourceBytes);
    const valid = moduleFrame({ sourceBytes, sourceSha256 });
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1({ ...valid, extra: true }),
      "invalid_shape",
    );
    let getterCalled = false;
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, "sourceBytes", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return sourceBytes;
      },
    });
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1(accessor),
      "invalid_shape",
    );
    expect(getterCalled).toBe(false);
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1({
        ...valid,
        artifactModulePath: "__flarex_task_runtime__/entry.mjs",
      }),
      "reserved_module_path",
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1(revoked.proxy),
      "invalid_shape",
    );
  });

  it("rejects malformed UTF-8 and source length mismatches", async () => {
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    const sourceSha256 = await sha256(invalidUtf8);
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1(moduleFrame({
        sourceBytes: invalidUtf8,
        sourceSha256,
      })),
      "invalid_source_bytes",
    );
    const sourceBytes = UTF8.encode("ok");
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1({
        ...moduleFrame({ sourceBytes, sourceSha256: await sha256(sourceBytes) }),
        rawByteLength: 3n,
      }),
      "source_length_mismatch",
    );

    const hostileBytes = UTF8.encode("safe");
    const hostileFrame = moduleFrame({
      sourceBytes: hostileBytes,
      sourceSha256: await sha256(hostileBytes),
    });
    let byteLengthGetterCalled = false;
    Object.defineProperty(hostileBytes, "byteLength", {
      get: () => {
        byteLengthGetterCalled = true;
        throw new Error("must not read caller byteLength");
      },
    });
    expect(encodeTaskRuntimeProjectionModulePreimageV1(hostileFrame)).toEqual(
      expect.objectContaining({ _tag: "Success" }),
    );
    expect(byteLengthGetterCalled).toBe(false);

    const detachedBytes = UTF8.encode("detached");
    const detachedFrame = {
      ...moduleFrame({
        sourceBytes: detachedBytes,
        sourceSha256: await sha256(detachedBytes),
      }),
      rawByteLength: BigInt(detachedBytes.byteLength),
    };
    structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
    expectFailure(
      encodeTaskRuntimeProjectionModulePreimageV1(detachedFrame),
      "invalid_source_bytes",
    );
  });

  it("enforces exact UTF-8 path ordering, contiguous ordinals, and uniqueness", async () => {
    const firstBytes = UTF8.encode("export const first = 1");
    const secondBytes = UTF8.encode("export const second = 2");
    const first = moduleFrame({
      artifactModulePath: "\ue000.mjs",
      sourceBytes: firstBytes,
      sourceSha256: await sha256(firstBytes),
    });
    const second = moduleFrame({
      artifactModulePath: "😀.mjs",
      moduleOrdinal: 1n,
      sourceBytes: secondBytes,
      sourceSha256: await sha256(secondBytes),
    });
    expect(succeed(decodeTaskRuntimeProjectionModuleFramesV1([first, second])))
      .toHaveLength(2);
    expectFailure(
      decodeTaskRuntimeProjectionModuleFramesV1([
        { ...second, moduleOrdinal: 0n },
        { ...first, moduleOrdinal: 1n },
      ]),
      "unordered_modules",
    );
    expectFailure(
      decodeTaskRuntimeProjectionModuleFramesV1([
        first,
        { ...first, moduleOrdinal: 1n },
      ]),
      "duplicate_module_path",
    );
    expectFailure(
      decodeTaskRuntimeProjectionModuleFramesV1([
        { ...first, moduleOrdinal: 1n },
      ]),
      "invalid_ordinal",
    );
  });

  it("hashes and verifies one correlated projection without trusting supplied roots", async () => {
    const sourceBytes = UTF8.encode("export const run = () => 1");
    const module = moduleFrame({
      sourceBytes,
      sourceSha256: await sha256(sourceBytes),
    });
    const hashed = await Effect.runPromise(hashTaskRuntimeProjectionModuleRootV1(
      [module],
      SHA256,
    ));
    const projection = {
      kind: "task_runtime_projection",
      group: "durable_task",
      executionModule: module.artifactModulePath,
      moduleCount: 1n,
      rawByteLength: BigInt(sourceBytes.byteLength),
      moduleRootSha256: hashed.moduleRootSha256,
    } as const;
    const verified = await Effect.runPromise(verifyTaskRuntimeProjectionV1(
      projection,
      [module],
      SHA256,
    ));
    expect(verified.projectionSha256).toHaveLength(32);
    expect(verified.rawByteLength).toBe(BigInt(sourceBytes.byteLength));

    const digestMismatch = await Effect.runPromiseExit(
      hashTaskRuntimeProjectionModuleRootV1([
        { ...module, sourceSha256: digest(99) },
      ], SHA256),
    );
    expectFailureExit(digestMismatch, "source_digest_mismatch");
    const missingExecution = await Effect.runPromiseExit(
      verifyTaskRuntimeProjectionV1(
        { ...projection, executionModule: "tasks/missing.mjs" },
        [module],
        SHA256,
      ),
    );
    expectFailureExit(missingExecution, "missing_execution_module");
    const functionOnlyModule = { ...module, sourceRoles: 1 };
    const functionOnlyRoot = await Effect.runPromise(
      hashTaskRuntimeProjectionModuleRootV1([functionOnlyModule], SHA256),
    );
    const wrongExecutionRole = await Effect.runPromiseExit(
      verifyTaskRuntimeProjectionV1(
        { ...projection, moduleRootSha256: functionOnlyRoot.moduleRootSha256 },
        [functionOnlyModule],
        SHA256,
      ),
    );
    expectFailureExit(wrongExecutionRole, "missing_execution_module");
    const wrongRoot = await Effect.runPromiseExit(
      verifyTaskRuntimeProjectionV1(
        { ...projection, moduleRootSha256: digest(1) },
        [module],
        SHA256,
      ),
    );
    expectFailureExit(wrongRoot, "invalid_root");
  });

  it("requires deterministic materialization policy and sorted profile evidence", () => {
    const decoded = succeed(decodeTaskRuntimeMaterializationSpecV1(
      materializationSpec(),
    ));
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.compatibilityFlags)).toBe(true);
    expect(Object.isFrozen(decoded.supportedComputeProfiles)).toBe(true);

    expectFailure(
      decodeTaskRuntimeMaterializationSpecV1(materializationSpec({
        supportedComputeProfiles: ["standard-2x", "standard-1x"],
      })),
      "unordered_compute_profiles",
    );
    expectFailure(
      decodeTaskRuntimeMaterializationSpecV1(materializationSpec({
        supportedComputeProfiles: ["standard-1x", "standard-1x"],
      })),
      "duplicate_compute_profile",
    );
    expectFailure(
      decodeTaskRuntimeMaterializationSpecV1(materializationSpec({
        compatibilityDate: "2026-02-30",
      })),
      "invalid_compatibility",
    );
    expectFailure(
      decodeTaskRuntimeMaterializationSpecV1(materializationSpec({
        supportedComputeProfiles: Array.from(
          { length: MAX_TASK_RUNTIME_COMPUTE_PROFILES_V1 + 1 },
          (_, index) => `profile-${index.toString().padStart(3, "0")}`,
        ),
      })),
      "invalid_compute_profile",
    );
  });

  it("rejects noncanonical role and root preimages", async () => {
    const sourceBytes = UTF8.encode("export default 1");
    const module = moduleFrame({
      sourceBytes,
      sourceSha256: await sha256(sourceBytes),
    });
    const canonical = succeed(encodeTaskRuntimeProjectionModulePreimageV1(module));
    const padded = UTF8.encode(` ${text(canonical)}`);
    expectFailure(
      decodeTaskRuntimeProjectionModulePreimageV1(padded),
      "noncanonical_preimage",
    );
    expectFailure(
      decodeTaskRuntimeProjectionModulePreimageV1(new Uint8Array([0xff])),
      "invalid_shape",
    );
    const entryBytes = succeed(encodeTaskRuntimeEntryPreimageV1(entry(0n, "alpha")));
    expect(
      Result.isFailure(decodeTaskRuntimeEntryPreimageV1(UTF8.encode(` ${text(entryBytes)}`))),
    ).toBe(true);

    const root = succeed(encodeTaskRuntimeModuleRootPreimageV1([digest(1)]));
    const uppercase = UTF8.encode(text(root).replace(/[a-f]/u, (value) =>
      value.toUpperCase()
    ));
    expectFailure(decodeTaskRuntimeModuleRootPreimageV1(uppercase), "invalid_shape");
    expectFailure(encodeTaskRuntimeModuleRootPreimageV1([]), "invalid_root");
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expectFailure(encodeTaskRuntimeModuleRootPreimageV1(revoked.proxy), "invalid_root");
  });

  it("defines the canonical empty task-entry root and rejects unordered entries", async () => {
    const emptyBytes = succeed(encodeTaskRuntimeEntryRootPreimageV1([]));
    expect(text(emptyBytes)).toBe(
      `{"codec":"${TASK_RUNTIME_ENTRY_ROOT_CODEC_V1}","digests":[]}`,
    );
    expect(succeed(decodeTaskRuntimeEntryRootPreimageV1(emptyBytes))).toEqual([]);
    const emptyRoot = await Effect.runPromise(hashTaskRuntimeEntryRootV1([], SHA256));
    expect(hex(emptyRoot)).toBe("d3bfd21a6351438acf02a4cd27a74638a8dffe98dfb93203c1bfc2d22669593c");

    const entries = [entry(0n, "alpha"), entry(1n, "beta")];
    const root = await Effect.runPromise(hashTaskRuntimeEntryRootV1(entries, SHA256));
    expect(root).toHaveLength(32);
    const unordered = await Effect.runPromiseExit(hashTaskRuntimeEntryRootV1([
      entry(0n, "beta"),
      entry(1n, "alpha"),
    ], SHA256));
    expectFailureExit(unordered, "invalid_root");
  });

  it("changes every object digest when a committed field changes", async () => {
    const sourceBytes = UTF8.encode("export default 1");
    const module = moduleFrame({
      sourceBytes,
      sourceSha256: await sha256(sourceBytes),
    });
    const moduleDigest = await Effect.runPromise(
      hashTaskRuntimeProjectionModuleFrameV1(module, SHA256),
    );
    const changedModuleDigest = await Effect.runPromise(
      hashTaskRuntimeProjectionModuleFrameV1({ ...module, sourceRoles: 1 }, SHA256),
    );
    expect(bytesEqualFullScan(moduleDigest, changedModuleDigest)).toBe(false);

    const moduleRoot = await Effect.runPromise(
      hashTaskRuntimeProjectionModuleRootV1([module], SHA256),
    );
    const projection = {
      kind: "task_runtime_projection",
      group: "durable_task",
      executionModule: module.artifactModulePath,
      moduleCount: 1n,
      rawByteLength: BigInt(sourceBytes.byteLength),
      moduleRootSha256: moduleRoot.moduleRootSha256,
    } as const;
    const projectionDigest = await Effect.runPromise(
      hashTaskRuntimeProjectionFrameV1(projection, SHA256),
    );
    const changedProjectionDigest = await Effect.runPromise(
      hashTaskRuntimeProjectionFrameV1({
        ...projection,
        executionModule: "tasks/other.mjs",
      }, SHA256),
    );
    expect(bytesEqualFullScan(projectionDigest, changedProjectionDigest)).toBe(false);

    const spec = materializationSpec();
    const specDigest = await Effect.runPromise(hashTaskRuntimeMaterializationSpecV1(
      spec,
      SHA256,
    ));
    const changedSpecDigest = await Effect.runPromise(
      hashTaskRuntimeMaterializationSpecV1({
        ...spec,
        runtimeImplementationVersion: "worker-loader-2026.08.13",
      }, SHA256),
    );
    expect(bytesEqualFullScan(specDigest, changedSpecDigest)).toBe(false);

    const manifest = groupManifest();
    const manifestDigest = await Effect.runPromise(
      hashTaskRuntimeGroupManifestFrameV1(manifest, SHA256),
    );
    const changedManifestDigest = await Effect.runPromise(
      hashTaskRuntimeGroupManifestFrameV1({
        ...manifest,
        taskRuntimeProjectionSha256: digest(42),
      }, SHA256),
    );
    expect(bytesEqualFullScan(manifestDigest, changedManifestDigest)).toBe(false);
  });
});

function moduleFrame(overrides: Readonly<{
  readonly artifactModulePath?: string;
  readonly moduleOrdinal?: bigint;
  readonly sourceBytes: Uint8Array;
  readonly sourceSha256: TaskDefinitionSha256V1;
}>) {
  return {
    kind: "runtime_projection_module",
    group: "durable_task",
    moduleOrdinal: overrides.moduleOrdinal ?? 0n,
    artifactModulePath: overrides.artifactModulePath ?? "tasks/run.mjs",
    sourceRoles: 8,
    sourceEnvironment: "isolate",
    moduleFormat: "es_module",
    rawByteLength: BigInt(overrides.sourceBytes.byteLength),
    sourceSha256: overrides.sourceSha256,
    sourceBytes: overrides.sourceBytes,
  } as const;
}

function materializationSpec(overrides: Readonly<{
  readonly compatibilityDate?: string;
  readonly supportedComputeProfiles?: ReadonlyArray<string>;
}> = {}) {
  return {
    kind: "task_runtime_materialization_spec",
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    compatibilityDate: overrides.compatibilityDate ?? "2026-08-12",
    compatibilityFlags: ["nodejs_compat"],
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    supportedComputeProfiles: overrides.supportedComputeProfiles ?? [
      "standard-1x",
      "standard-2x",
    ],
    moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  } as const;
}

function groupManifest(overrides: Readonly<{
  readonly taskRuntimeProjectionSha256?: TaskDefinitionSha256V1;
  readonly taskRuntimeMaterializationSpecSha256?: TaskDefinitionSha256V1;
}> = {}) {
  return {
    kind: "task_runtime_group_manifest",
    taskCatalogSha256: digest(1),
    taskCount: 1n,
    taskEntryRootSha256: digest(2),
    taskRuntimeProjectionSha256:
      overrides.taskRuntimeProjectionSha256 ?? digest(3),
    taskRuntimeMaterializationSpecSha256:
      overrides.taskRuntimeMaterializationSpecSha256 ?? digest(4),
  } as const;
}

function entry(taskOrdinal: bigint, taskId: string): TaskRuntimeEntryFrameV1 {
  return {
    kind: "task_runtime_entry",
    taskOrdinal,
    taskId: brandTaskId(taskId),
    canonicalTaskManifestSha256: digest(5 + Number(taskOrdinal)),
    logicalExecutionModule: `src/${taskId}.ts`,
    artifactExecutionModule: `tasks/${taskId}.mjs`,
    exportName: "run",
    group: "durable_task",
    projectionSha256: digest(8),
  };
}

async function sha256(bytes: Uint8Array): Promise<TaskDefinitionSha256V1> {
  return await Effect.runPromise(SHA256(bytes, {
    maximumInputBytes: 16 * 1_024 * 1_024,
  }).pipe(Effect.map(brandDigest)));
}

function digest(seed: number): TaskDefinitionSha256V1 {
  return brandDigest(Uint8Array.from({ length: 32 }, (_, index) =>
    (seed + index) & 0xff
  ));
}

function succeed<A, E>(result: Result.Result<A, E>): A {
  return Result.getOrThrow(result);
}

function expectFailure(
  result: Result.Result<unknown, InvalidTaskRuntimePublicationV1Error>,
  reason: InvalidTaskRuntimePublicationV1Error["reason"],
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
}

function expectFailureExit(
  exit: Exit.Exit<unknown, unknown>,
  reason: InvalidTaskRuntimePublicationV1Error["reason"],
): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: { reason },
    });
  }
}

function hex(bytes: Uint8Array): string {
  return encodeBytesToLowercaseHex(bytes);
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
