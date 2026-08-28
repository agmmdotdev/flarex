import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
  NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
  NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
  NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
  ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  admitIsolateTaskRuntimePublicationV1,
  admitNodeTaskRuntimeArtifactV1,
  decodeNodeTaskRuntimeArtifactV1,
  decodeNodeTaskRuntimeArtifactPreimageV1,
  decodeTaskRuntimeComputeProfileCatalogV1,
  decodeTaskRuntimeComputeProfileCatalogPreimageV1,
  encodeNodeTaskRuntimeArtifactPreimageV1,
  encodeTaskRuntimeComputeProfileCatalogPreimageV1,
  hashCanonicalTaskManifestV1,
  makeStandardApplicationTaskSha256V1,
  nodeTaskRuntimeArtifactObjectKeyV1,
  type TaskDefinitionSha256V1,
} from "../src/taskDefinition/v1";

const nodeSmall = profile("node-1x");
const nodeLarge = profile("node-2x");
const isolateSmall = profile("standard-1x");
const isolateLarge = profile("standard-2x");
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

describe("task runtime family V1", () => {
  it("admits an ordered, owned runtime profile catalog", () => {
    const inputCapabilities: Record<string, string> = capabilities();
    const input = catalog([
      nodePolicy(nodeSmall),
      { ...isolatePolicy(isolateSmall), capabilities: inputCapabilities },
    ]);
    const decoded = success(decodeTaskRuntimeComputeProfileCatalogV1(input));

    inputCapabilities.outbound = "allowed";
    expect(decoded.profiles[1]!.capabilities.outbound).toBe("denied");
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.profiles)).toBe(true);
    expect(Object.isFrozen(decoded.profiles[0])).toBe(true);
    expect(Object.isFrozen(decoded.profiles[0]!.capabilities)).toBe(true);
  });

  it("rejects unordered, duplicate, ABI-mismatched, and permissive profiles", () => {
    expect(failure(decodeTaskRuntimeComputeProfileCatalogV1(catalog([
      isolatePolicy(isolateSmall),
      nodePolicy(nodeSmall),
    ])))).toMatchObject({ reason: "unordered_compute_profiles" });
    expect(failure(decodeTaskRuntimeComputeProfileCatalogV1(catalog([
      isolatePolicy(isolateSmall),
      isolatePolicy(isolateSmall),
    ])))).toMatchObject({ reason: "duplicate_compute_profile" });
    expect(failure(decodeTaskRuntimeComputeProfileCatalogV1(catalog([{
      ...nodePolicy(nodeSmall),
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    }])))).toMatchObject({ reason: "invalid_runtime_contract" });
    expect(failure(decodeTaskRuntimeComputeProfileCatalogV1(catalog([{
      ...nodePolicy(nodeSmall),
      capabilities: {
        ...capabilities(),
        outbound: "allowed",
      },
    }])))).toMatchObject({ reason: "invalid_capability_policy" });
  });

  it("decodes an owned content-addressed Node artifact contract", () => {
    const input = artifact();
    const originalDigestByte = input.bundle.sha256[0];
    const decoded = success(decodeNodeTaskRuntimeArtifactV1(input));

    input.bundle.sha256[0] = 0xff;
    input.modules[0]!.sourceSha256[0] = 0xff;
    expect(decoded.bundle.sha256[0]).toBe(originalDigestByte);
    expect(decoded.bundle.objectKey).toBe(
      nodeTaskRuntimeArtifactObjectKeyV1("node_bundle", digest(0x31)),
    );
    expect(decoded.bundle.objectKey).not.toContain("$");
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.modules)).toBe(true);
    expect(Object.isFrozen(decoded.bundle)).toBe(true);
  });

  it("round-trips canonical catalog and Node artifact publication bytes", () => {
    const catalogBytes = success(
      encodeTaskRuntimeComputeProfileCatalogPreimageV1(catalog([
        nodePolicy(nodeSmall),
        nodePolicy(nodeLarge),
      ])),
    );
    expect(success(
      decodeTaskRuntimeComputeProfileCatalogPreimageV1(catalogBytes),
    ).profiles.map(value => value.computeProfile)).toEqual([
      nodeSmall,
      nodeLarge,
    ]);

    const artifactBytes = success(encodeNodeTaskRuntimeArtifactPreimageV1(
      artifact(),
    ));
    expect(success(decodeNodeTaskRuntimeArtifactPreimageV1(artifactBytes)))
      .toMatchObject({
        kind: "node_task_runtime_artifact",
        runtimeFamily: "node",
        supportedComputeProfiles: [nodeSmall, nodeLarge],
      });

    const noncanonical = new Uint8Array(artifactBytes.byteLength + 1);
    noncanonical.set(artifactBytes);
    noncanonical[noncanonical.length - 1] = 0x20;
    expect(failure(decodeNodeTaskRuntimeArtifactPreimageV1(noncanonical)))
      .toMatchObject({ reason: "noncanonical_preimage" });
  });

  it("admits a Node artifact while keeping dispatch provider-disabled", async () => {
    const manifestValue = manifest(nodeSmall);
    const catalogValue = catalog([
      nodePolicy(nodeSmall),
      nodePolicy(nodeLarge),
    ]);
    const admitted = success(await Effect.runPromise(Effect.result(
      admitNodeTaskRuntimeArtifactV1({
      ...await admissionAuthority(manifestValue, catalogValue),
      manifest: manifestValue,
      computeProfileCatalog: catalogValue,
      }, sha256),
    )));

    expect(admitted.admission).toMatchObject({
      runtimeFamily: "node",
      initialComputeProfile: nodeSmall,
      reachableComputeProfiles: [nodeSmall],
    });
    expect(admitted.dispatchReadiness).toBe("blocked_provider_disabled");
    expect(Object.isFrozen(admitted.admission.reachableComputeProfiles))
      .toBe(true);
    const firstRead = admitted.readArtifact();
    firstRead.candidateSha256[0] = 0xff;
    firstRead.modules[0]!.sourceSha256[0] = 0xff;
    expect(admitted.readArtifact().candidateSha256[0]).toBe(0x11);
    expect(admitted.readArtifact().modules[0]!.sourceSha256[0]).toBe(0x41);
    expect(admitted.nodeTaskRuntimeArtifactSha256Hex).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rejects family changes, missing artifact support, and duration overflow", async () => {
    const nodeManifest = manifest(nodeSmall);
    const mixedCatalog = catalog([
      nodePolicy(nodeSmall),
      isolatePolicy(nodeLarge),
    ]);
    expect(failure(await Effect.runPromise(Effect.result(
      admitNodeTaskRuntimeArtifactV1({
      ...await admissionAuthority(nodeManifest, mixedCatalog),
      manifest: nodeManifest,
      computeProfileCatalog: mixedCatalog,
      }, sha256),
    )))).toMatchObject({ reason: "runtime_family_mismatch" });

    const nodeCatalog = catalog([
      nodePolicy(nodeSmall),
      nodePolicy(nodeLarge),
    ]);
    const nodeAuthority = await admissionAuthority(nodeManifest, nodeCatalog);
    const missingInitialArtifact = {
      ...nodeAuthority.artifact,
      supportedComputeProfiles: [nodeLarge],
    };
    expect(failure(await Effect.runPromise(Effect.result(
      admitNodeTaskRuntimeArtifactV1({
      ...nodeAuthority,
      manifest: nodeManifest,
      artifact: missingInitialArtifact,
      computeProfileCatalog: nodeCatalog,
      }, sha256),
    )))).toMatchObject({ reason: "profile_not_found" });

    const longManifest = { ...nodeManifest, maximumDurationInSeconds: 901 };
    expect(failure(await Effect.runPromise(Effect.result(
      admitNodeTaskRuntimeArtifactV1({
      ...await admissionAuthority(longManifest, nodeCatalog),
      manifest: longManifest,
      computeProfileCatalog: nodeCatalog,
      }, sha256),
    )))).toMatchObject({
      reason: "duration_exceeded",
      observed: 901,
      maximum: 900,
    });
  });

  it("authenticates Node artifact revision, candidate, and manifest digest", async () => {
    const manifestValue = manifest(nodeSmall);
    const catalogValue = catalog([
      nodePolicy(nodeSmall),
      nodePolicy(nodeLarge),
    ]);
    const authority = await admissionAuthority(manifestValue, catalogValue);
    for (const change of [{
      applicationRevisionId: "revision-other",
    }, {
      candidateSha256: digest(0x77),
    }, {
      artifact: {
        ...authority.artifact,
        canonicalTaskManifestSha256: digest(0x66),
      },
    }]) {
      expect(failure(await Effect.runPromise(Effect.result(
        admitNodeTaskRuntimeArtifactV1({
          ...authority,
          ...change,
          manifest: manifestValue,
          computeProfileCatalog: catalogValue,
        }, sha256),
      )))).toMatchObject({ reason: "manifest_mismatch" });
    }

    const changedCatalog = catalog([
      { ...nodePolicy(nodeSmall), maximumDurationInSeconds: 899 },
      nodePolicy(nodeLarge),
    ]);
    expect(failure(await Effect.runPromise(Effect.result(
      admitNodeTaskRuntimeArtifactV1({
        ...authority,
        manifest: manifestValue,
        computeProfileCatalog: changedCatalog,
      }, sha256),
    )))).toMatchObject({ reason: "catalog_mismatch" });
  });

  it("keeps every Worker materialization profile inside the isolate family", () => {
    const isolateManifest = manifest(isolateSmall);
    expect(success(admitIsolateTaskRuntimePublicationV1(
      isolateManifest,
      catalog([
        isolatePolicy(isolateSmall),
        isolatePolicy(isolateLarge),
      ]),
      [isolateSmall, isolateLarge],
    ))).toMatchObject({
      runtimeFamily: "isolate",
      reachableComputeProfiles: [isolateSmall],
    });

    expect(failure(admitIsolateTaskRuntimePublicationV1(
      isolateManifest,
      catalog([
        isolatePolicy(isolateSmall),
        nodePolicy(isolateLarge),
      ]),
      [isolateSmall, isolateLarge],
    ))).toMatchObject({ reason: "runtime_family_mismatch" });
  });

  it("does not invoke accessors while rejecting untrusted catalog input", () => {
    let invoked = false;
    const input = Object.defineProperty({}, "version", {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    Object.defineProperty(input, "profiles", {
      enumerable: true,
      value: [],
    });

    expect(failure(decodeTaskRuntimeComputeProfileCatalogV1(input)))
      .toMatchObject({ reason: "invalid_shape" });
    expect(invoked).toBe(false);
  });

  it("captures admission input before hashing and never invokes outer accessors", async () => {
    const manifestValue = manifest(nodeSmall);
    const catalogValue = catalog([
      nodePolicy(nodeSmall),
      nodePolicy(nodeLarge),
    ]);
    const authority = await admissionAuthority(manifestValue, catalogValue);
    const input = {
      ...authority,
      manifest: manifestValue,
      computeProfileCatalog: catalogValue,
    };
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    const releasePromise = new Promise<void>(resolve => {
      release = resolve;
    });
    let first = true;
    const delayedSha256 = makeStandardApplicationTaskSha256V1(async bytes => {
      if (first) {
        first = false;
        started();
        await releasePromise;
      }
      return globalThis.crypto.subtle.digest("SHA-256", bytes);
    });
    const pending = Effect.runPromise(admitNodeTaskRuntimeArtifactV1(
      input,
      delayedSha256,
    ));
    await startedPromise;
    input.artifact.candidateSha256[0] = 0xff;
    input.artifact.modules[0]!.sourceSha256[0] = 0xff;
    release();
    const admitted = await pending;
    expect(admitted.readArtifact().candidateSha256[0]).toBe(0x11);
    expect(admitted.readArtifact().modules[0]!.sourceSha256[0]).toBe(0x41);

    let invoked = false;
    const accessorInput = { ...input };
    Object.defineProperty(accessorInput, "manifest", {
      enumerable: true,
      get() {
        invoked = true;
        return manifestValue;
      },
    });
    expect(failure(await Effect.runPromise(Effect.result(
      admitNodeTaskRuntimeArtifactV1(accessorInput, sha256),
    )))).toMatchObject({ reason: "invalid_shape" });
    expect(invoked).toBe(false);
  });
});

function artifact(
  canonicalTaskManifestSha256 = digest(0x22),
  computeProfileCatalogSha256 = digest(0x23),
) {
  const bundleSha256 = digest(0x31);
  return {
    version: 1 as const,
    kind: "node_task_runtime_artifact" as const,
    runtimeFamily: "node" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
    moduleEntryPolicyIdentity:
      NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
    nodeRuntimeAbiIdentity: "nodejs-24-linux-x64",
    moduleFormat: "es_module" as const,
    architecturePolicy: "portable_javascript" as const,
    nativeModules: "denied" as const,
    applicationRevisionId: "revision-orders-v3",
    candidateSha256: digest(0x11),
    taskId: "tasks.orders.process",
    canonicalTaskManifestSha256,
    computeProfileCatalogSha256,
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    executionModule: "index.js",
    modules: [{
      moduleOrdinal: 0n,
      artifactModulePath: "index.js",
      sourceRoles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      rawByteLength: 100n,
      sourceSha256: digest(0x41),
    }, {
      moduleOrdinal: 1n,
      artifactModulePath: "tasks/orders.js",
      sourceRoles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      rawByteLength: 200n,
      sourceSha256: digest(0x42),
    }],
    bundle: {
      storeIdentity: NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
      kind: "node_bundle" as const,
      codecIdentity: NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
      objectKey: nodeTaskRuntimeArtifactObjectKeyV1(
        "node_bundle",
        bundleSha256,
      ),
      byteLength: 8_192n,
      sha256: bundleSha256,
    },
    dependencies: null,
    supportedComputeProfiles: [nodeSmall, nodeLarge],
  };
}

function manifest(
  initialComputeProfile: TaskComputeProfileRefV1,
  escalationComputeProfile?: TaskComputeProfileRefV1,
) {
  return {
    version: 1 as const,
    taskId: "tasks.orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator: { type: "any" as const },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1 as const,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: escalationComputeProfile === undefined
        ? { kind: "disabled" as const }
        : {
          kind: "escalate_once" as const,
          computeProfile: escalationComputeProfile,
        },
    },
    maximumDurationInSeconds: 300,
    computeProfile: initialComputeProfile,
    queue: { kind: "default" as const },
  };
}

function catalog(profiles: ReadonlyArray<unknown>) {
  return { version: 1 as const, profiles: [...profiles] };
}

function isolatePolicy(computeProfile: TaskComputeProfileRefV1) {
  return {
    computeProfile,
    runtimeFamily: "isolate" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    resourceClassIdentity: "standard-1x",
    maximumDurationInSeconds: 900,
    capabilities: capabilities(),
    provider: {
      state: "enabled" as const,
      providerIdentity: ISOLATE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
      placement: "cloudflare_worker" as const,
    },
  };
}

function nodePolicy(computeProfile: TaskComputeProfileRefV1) {
  return {
    computeProfile,
    runtimeFamily: "node" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
    resourceClassIdentity: "node-standard-1x",
    maximumDurationInSeconds: 900,
    capabilities: capabilities(),
    provider: {
      state: "disabled" as const,
      providerIdentity: NODE_TASK_COMPUTE_PROVIDER_IDENTITY_V1,
      placement: "unconfigured" as const,
    },
  };
}

function capabilities() {
  return {
    outbound: "denied" as const,
    filesystem: "none" as const,
    nativeModules: "denied" as const,
    environmentVariables: "platform_only" as const,
    secrets: "denied" as const,
    childProcesses: "denied" as const,
  };
}

function profile(value: string): TaskComputeProfileRefV1 {
  return Brand.nominal<TaskComputeProfileRefV1>()(value);
}

function digest(byte: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
}

async function admissionAuthority(
  manifestValue: unknown,
  catalogValue: unknown,
) {
  const canonicalTaskManifestSha256 = await Effect.runPromise(
    hashCanonicalTaskManifestV1(manifestValue, sha256),
  );
  const catalogBytes = success(
    encodeTaskRuntimeComputeProfileCatalogPreimageV1(catalogValue),
  );
  // SAFETY: the Standard Application SHA-256 capability validates 32 bytes.
  const computeProfileCatalogSha256 = await Effect.runPromise(sha256(
    catalogBytes,
    { maximumInputBytes: catalogBytes.byteLength },
  )) as TaskDefinitionSha256V1;
  return {
    applicationRevisionId: "revision-orders-v3",
    candidateSha256: digest(0x11),
    artifact: artifact(
      canonicalTaskManifestSha256,
      computeProfileCatalogSha256,
    ),
  };
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function failure<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Failure {
  if (Result.isSuccess(result)) throw new Error("Expected failure");
  return result.failure;
}
