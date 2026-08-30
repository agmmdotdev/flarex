import { Result } from "effect";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import { FrameworkSchemaArtifactError } from
  "../src/frameworkSchema/artifact/errors";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactCaptureInput,
} from "../src/frameworkSchema/artifact/model";
import {
  getPreparedFrameworkSchemaArtifactAdmissionEvidence,
  prepareFrameworkSchemaArtifactAdmission,
  type PreparedFrameworkSchemaArtifactAdmission,
} from "../src/frameworkSchema/artifact/repository";
import { runEffect } from "./effectTestRuntime";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private framework schema artifact admission preparation", () => {
  it("keeps preparation pure, typed, opaque, and capture-authenticated", async () => {
    expectTypeOf<ReturnType<
      typeof prepareFrameworkSchemaArtifactAdmission
    >>().toEqualTypeOf<Result.Result<
      PreparedFrameworkSchemaArtifactAdmission,
      FrameworkSchemaArtifactError
    >>();

    const artifact = await captureArtifact();
    vi.stubGlobal("crypto", Object.freeze({}));
    const encode = vi.spyOn(TextEncoder.prototype, "encode")
      .mockImplementation(() => {
        throw new Error("preparation must not encode");
      });

    const prepared = Result.getOrThrow(
      prepareFrameworkSchemaArtifactAdmission(artifact),
    );

    expect(encode).not.toHaveBeenCalled();
    expect(Object.isFrozen(prepared)).toBe(true);
    const tokenKeys = Reflect.ownKeys(prepared);
    expect(tokenKeys).toHaveLength(1);
    expect(typeof tokenKeys[0]).toBe("symbol");
  });

  it("retains detached canonical and digest evidence at both handoffs", async () => {
    const artifact = await captureArtifact({
      dependencies: [{
        deploymentId: "deployment-main",
        owner: "payload",
        lineageId: "lineage-dependency",
        artifactSha256: "a".repeat(64),
      }],
    });
    const firstCaptureEvidence = requireCaptureEvidence(artifact);
    const expectedCanonicalBytes = new TextEncoder().encode(
      artifact.canonicalJson,
    );
    const expectedDigestBytes = new Uint8Array(Buffer.from(
      artifact.identity.artifactSha256,
      "hex",
    ));

    expect(firstCaptureEvidence.canonicalBytes).toEqual(
      expectedCanonicalBytes,
    );
    expect(firstCaptureEvidence.artifactSha256Bytes).toEqual(
      expectedDigestBytes,
    );
    firstCaptureEvidence.canonicalBytes.fill(0);
    firstCaptureEvidence.artifactSha256Bytes.fill(0);
    const secondCaptureEvidence = requireCaptureEvidence(artifact);
    expect(secondCaptureEvidence.canonicalBytes).toEqual(
      expectedCanonicalBytes,
    );
    expect(secondCaptureEvidence.artifactSha256Bytes).toEqual(
      expectedDigestBytes,
    );

    const prepared = Result.getOrThrow(
      prepareFrameworkSchemaArtifactAdmission(artifact),
    );
    const firstAdmissionEvidence = Result.getOrThrow(
      getPreparedFrameworkSchemaArtifactAdmissionEvidence(prepared),
    );

    expect(firstAdmissionEvidence).toMatchObject({
      artifact,
      canonicalByteLength: expectedCanonicalBytes.byteLength,
      frameFormat: FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
      frameVersion: FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
    });
    expect(firstAdmissionEvidence.identity).toEqual(artifact.identity);
    expect(firstAdmissionEvidence.identity).not.toBe(artifact.identity);
    expect(firstAdmissionEvidence.dependencies).toEqual(artifact.dependencies);
    expect(firstAdmissionEvidence.dependencies).not.toBe(artifact.dependencies);
    expect(firstAdmissionEvidence.dependencies[0]).not.toBe(
      artifact.dependencies[0],
    );
    expect(Object.isFrozen(firstAdmissionEvidence)).toBe(true);
    expect(Object.isFrozen(firstAdmissionEvidence.identity)).toBe(true);
    expect(Object.isFrozen(firstAdmissionEvidence.dependencies)).toBe(true);
    expect(Object.isFrozen(firstAdmissionEvidence.dependencies[0])).toBe(true);
    expect(firstAdmissionEvidence.canonicalBytes).toEqual(
      expectedCanonicalBytes,
    );
    expect(firstAdmissionEvidence.artifactSha256Bytes).toEqual(
      expectedDigestBytes,
    );

    firstAdmissionEvidence.canonicalBytes.fill(1);
    firstAdmissionEvidence.artifactSha256Bytes.fill(1);
    const secondAdmissionEvidence = Result.getOrThrow(
      getPreparedFrameworkSchemaArtifactAdmissionEvidence(prepared),
    );
    expect(secondAdmissionEvidence.canonicalBytes).toEqual(
      expectedCanonicalBytes,
    );
    expect(secondAdmissionEvidence.artifactSha256Bytes).toEqual(
      expectedDigestBytes,
    );
    expect(secondAdmissionEvidence.identity).not.toBe(
      firstAdmissionEvidence.identity,
    );
    expect(secondAdmissionEvidence.dependencies).not.toBe(
      firstAdmissionEvidence.dependencies,
    );
  });

  it("issues a fresh prepared capability for each authentic preparation", async () => {
    const artifact = await captureArtifact();
    const first = Result.getOrThrow(
      prepareFrameworkSchemaArtifactAdmission(artifact),
    );
    const second = Result.getOrThrow(
      prepareFrameworkSchemaArtifactAdmission(artifact),
    );

    expect(first).not.toBe(second);
    expect(Result.isSuccess(
      getPreparedFrameworkSchemaArtifactAdmissionEvidence(first),
    )).toBe(true);
    expect(Result.isSuccess(
      getPreparedFrameworkSchemaArtifactAdmissionEvidence(second),
    )).toBe(true);
  });

  it("rejects copied and structural artifact forgeries before property access", async () => {
    const artifact = await captureArtifact();
    let proxyPropertyReads = 0;
    const proxy = new Proxy(artifact, {
      get(target, property, receiver) {
        proxyPropertyReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        proxyPropertyReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        proxyPropertyReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const forgeries: readonly unknown[] = [
      { ...artifact },
      structuredClone(artifact),
      Object.freeze({
        identity: artifact.identity,
        codec: artifact.codec,
        provenance: artifact.provenance,
        capabilities: artifact.capabilities,
        dependencies: artifact.dependencies,
        payload: artifact.payload,
        canonicalJson: artifact.canonicalJson,
      }),
      proxy,
    ];

    for (const forgery of forgeries) {
      const result = Reflect.apply(
        prepareFrameworkSchemaArtifactAdmission,
        undefined,
        [forgery],
      );
      expectAdmissionInputFailure(result);
    }
    expect(proxyPropertyReads).toBe(0);
  });

  it("rejects copied and structural prepared-token forgeries before property access", async () => {
    const prepared = Result.getOrThrow(
      prepareFrameworkSchemaArtifactAdmission(await captureArtifact()),
    );
    let proxyPropertyReads = 0;
    const proxy = new Proxy(prepared, {
      get(target, property, receiver) {
        proxyPropertyReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        proxyPropertyReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        proxyPropertyReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const forgeries: readonly unknown[] = [
      { ...prepared },
      Object.freeze({}),
      proxy,
    ];

    for (const forgery of forgeries) {
      const result = Reflect.apply(
        getPreparedFrameworkSchemaArtifactAdmissionEvidence,
        undefined,
        [forgery],
      );
      expectAdmissionInputFailure(result);
    }
    expect(proxyPropertyReads).toBe(0);
  });
});

async function captureArtifact(
  overrides: Partial<FrameworkSchemaArtifactCaptureInput> = {},
): Promise<FrameworkSchemaArtifact> {
  return runEffect(captureFrameworkSchemaArtifact({
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: "lineage-main",
    payloadCodec: { format: "json", version: 1 },
    provenance: { source: "compiler" },
    capabilities: [],
    dependencies: [],
    payload: { tables: ["posts"] },
    ...overrides,
  }));
}

function requireCaptureEvidence(
  artifact: FrameworkSchemaArtifact,
) {
  const evidence = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (evidence === undefined) {
    throw new Error("Expected authentic capture evidence.");
  }
  return evidence;
}

function expectAdmissionInputFailure(
  result: Result.Result<unknown, FrameworkSchemaArtifactError>,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactError",
      operation: "admit",
      reason: "invalidInput",
      message: "Framework schema artifact admission input is invalid",
      retryable: false,
    });
    expect(Object.hasOwn(result.failure, "cause")).toBe(false);
  }
}
