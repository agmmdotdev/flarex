import { Result } from "effect";
import {
  encodeCanonicalJson,
  type JsonObject,
} from "flarex-protocol/json";
import { describe, expect, it } from "vitest";
import {
  DeclarativeV2ArtifactUploadHostConfigurationV1Error,
  DeclarativeV2ArtifactUploadHostSemanticSelectorV1Error,
  makeDeclarativeV2ArtifactUploadHostV1,
} from "../src/declarativeV2/ArtifactUploadHost";
import type {
  DeploymentSqlStorage,
  DeploymentTransactionStorage,
} from "../src/deployment/Store";
import { deploymentObjectName } from "../src/routing";
import {
  captureSemanticArtifactV1RootConfiguration,
  type SemanticArtifactV1RootConfiguration,
} from "../src/semanticArtifactV1/RootConfiguration";
import type { Env } from "../src/types";

const SEMANTIC_UPLOAD_ID = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";

describe("declarative v2 artifact upload host construction", () => {
  it("composes only real deployment-scoped capabilities without eager I/O", () => {
    const fixture = hostFixture();
    const result = makeDeclarativeV2ArtifactUploadHostV1(fixture.options);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(fixture.sqlCalls()).toBe(0);
    expect(fixture.r2Calls()).toBe(0);
    expect(Object.isFrozen(result.success)).toBe(true);
    expect(Object.isFrozen(result.success.source)).toBe(true);
    expect(Object.isFrozen(result.success.sourceCheckpointReader)).toBe(true);
    expect(Object.isFrozen(result.success.finalizedSourceProofs)).toBe(true);

    const semantic = result.success.makeSemanticUploadCore(SEMANTIC_UPLOAD_ID);
    expect(Result.isSuccess(semantic)).toBe(true);
    if (Result.isSuccess(semantic)) {
      expect(Object.isFrozen(semantic.success)).toBe(true);
    }
    const invalid = result.success.makeSemanticUploadCore("not-a-selector");
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toEqual(
        new DeclarativeV2ArtifactUploadHostSemanticSelectorV1Error({
          reason: "invalidSemanticUploadId",
        }),
      );
    }
    expect(fixture.sqlCalls()).toBe(0);
    expect(fixture.r2Calls()).toBe(0);
  });

  it("fails closed for every missing required host value", () => {
    const cases = [
      {
        mutate: (env: Env) => {
          Reflect.deleteProperty(env, "ARTIFACTS");
        },
        reason: "missingArtifactsBinding",
      },
      {
        mutate: (env: Env) => {
          Reflect.deleteProperty(
            env,
            "FLAREX_SEMANTIC_ARTIFACT_V1_ROOT_CONFIGURATION",
          );
        },
        reason: "missingSemanticRootConfiguration",
      },
      {
        mutate: (env: Env) => {
          Reflect.deleteProperty(
            env,
            "FLAREX_SOURCE_ARTIFACT_V2_FINALIZED_READ_MAXIMUM_STORED_BYTES",
          );
        },
        reason: "missingFinalizedSourceStoredBytes",
      },
    ] as const;
    for (const entry of cases) {
      const fixture = hostFixture();
      entry.mutate(fixture.options.env);
      expect(configurationReason(
        makeDeclarativeV2ArtifactUploadHostV1(fixture.options),
      )).toBe(entry.reason);
      expect(fixture.sqlCalls()).toBe(0);
      expect(fixture.r2Calls()).toBe(0);
    }
  });

  it("rejects a mismatched deployment object before reading configuration", () => {
    const fixture = hostFixture();
    const result = makeDeclarativeV2ArtifactUploadHostV1({
      ...fixture.options,
      durableObjectName: deploymentObjectName("deployment-b"),
    });
    expect(configurationReason(result)).toBe("deploymentObjectNameMismatch");
    expect(fixture.sqlCalls()).toBe(0);
    expect(fixture.r2Calls()).toBe(0);
  });

  it("rejects malformed artifact bindings before constructing stores", () => {
    const malformedBindings: ReadonlyArray<unknown> = [
      null,
      "artifact-bucket",
      {},
      { get: async () => null },
      { put: async () => null },
    ];
    for (const binding of malformedBindings) {
      const fixture = hostFixture();
      Reflect.set(fixture.options.env, "ARTIFACTS", binding);
      expect(configurationReason(
        makeDeclarativeV2ArtifactUploadHostV1(fixture.options),
      )).toBe("invalidArtifactsBinding");
      expect(fixture.sqlCalls()).toBe(0);
      expect(fixture.r2Calls()).toBe(0);
    }

    const fixture = hostFixture();
    const hostileBinding = Object.defineProperty({}, "get", {
      get: () => {
        throw new Error("binding inspection failed");
      },
    });
    Reflect.set(fixture.options.env, "ARTIFACTS", hostileBinding);
    expect(configurationReason(
      makeDeclarativeV2ArtifactUploadHostV1(fixture.options),
    )).toBe("invalidArtifactsBinding");
    expect(fixture.sqlCalls()).toBe(0);
    expect(fixture.r2Calls()).toBe(0);
  });

  it("rejects malformed, noncanonical, extra, and blank semantic root pins", () => {
    const extra = {
      ...semanticRootConfiguration(),
      unexpectedIdentity: "must-fail",
    };
    const blank = {
      ...semanticRootConfiguration(),
      semanticModelIdentity: "",
    };
    const cases = [
      "{",
      JSON.stringify(semanticRootConfiguration()),
      canonicalJson(extra),
      canonicalJson(blank),
    ];
    for (const value of cases) {
      const fixture = hostFixture();
      fixture.options.env.FLAREX_SEMANTIC_ARTIFACT_V1_ROOT_CONFIGURATION =
        value;
      expect(configurationReason(
        makeDeclarativeV2ArtifactUploadHostV1(fixture.options),
      )).toBe("invalidSemanticRootConfiguration");
      expect(fixture.sqlCalls()).toBe(0);
      expect(fixture.r2Calls()).toBe(0);
    }
  });

  it("accepts only exact positive safe-integer stored-row ceiling text", () => {
    for (const value of [
      "",
      "0",
      "01",
      " 100",
      "1.5",
      String(Number.MAX_SAFE_INTEGER + 1),
      100_000,
    ]) {
      const fixture = hostFixture();
      Reflect.set(
        fixture.options.env,
        "FLAREX_SOURCE_ARTIFACT_V2_FINALIZED_READ_MAXIMUM_STORED_BYTES",
        value,
      );
      expect(configurationReason(
        makeDeclarativeV2ArtifactUploadHostV1(fixture.options),
      )).toBe("invalidFinalizedSourceStoredBytes");
    }
  });

  it("retains the existing authorizer configuration gate", () => {
    const fixture = hostFixture();
    Reflect.deleteProperty(fixture.options.env, "FLAREX_EXECUTOR");
    const result = makeDeclarativeV2ArtifactUploadHostV1(fixture.options);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "DeploymentProjectScopeLookupConfigurationV1Error",
        reason: "missingExecutorServiceBinding",
      });
    }
    expect(fixture.sqlCalls()).toBe(0);
    expect(fixture.r2Calls()).toBe(0);
  });

  it("rejects an invalid deployment identity before reading configuration", () => {
    const fixture = hostFixture();
    const result = makeDeclarativeV2ArtifactUploadHostV1({
      ...fixture.options,
      deploymentId: "",
    });
    expect(configurationReason(result)).toBe("invalidDeploymentId");
    expect(fixture.sqlCalls()).toBe(0);
    expect(fixture.r2Calls()).toBe(0);
  });

  it("captures root pins once, in field order, into owned frozen evidence", () => {
    const input = semanticRootConfiguration();
    let modelReads = 0;
    Object.defineProperty(input, "semanticModelIdentity", {
      enumerable: true,
      get: () => {
        modelReads += 1;
        return modelReads === 1 ? "semantic-model-v1" : null;
      },
    });
    const captured = captureSemanticArtifactV1RootConfiguration(input);
    expect(Result.isSuccess(captured)).toBe(true);
    expect(modelReads).toBe(1);
    if (Result.isSuccess(captured)) {
      expect(Object.isFrozen(captured.success)).toBe(true);
      expect(captured.success.semanticModelIdentity).toBe("semantic-model-v1");
    }

    let laterReads = 0;
    const invalidFirst = semanticRootConfiguration();
    Object.defineProperties(invalidFirst, {
      semanticModelIdentity: {
        enumerable: true,
        value: "",
      },
      semanticCodecIdentity: {
        enumerable: true,
        get: () => {
          laterReads += 1;
          throw new Error("later root field must remain unread");
        },
      },
    });
    const failure = captureSemanticArtifactV1RootConfiguration(invalidFirst);
    expect(Result.isFailure(failure)).toBe(true);
    if (Result.isFailure(failure)) {
      expect(failure.failure).toMatchObject({
        _tag: "SemanticArtifactV1RootConfigurationError",
        field: "semanticModelIdentity",
      });
    }
    expect(laterReads).toBe(0);
  });
});

function hostFixture() {
  let sqlCalls = 0;
  let r2Calls = 0;
  const sql = {
    exec: () => {
      sqlCalls += 1;
      throw new Error("host construction must not read SQLite");
    },
  } as unknown as DeploymentSqlStorage;
  const storage = {
    sql,
    transaction: async <A>(closure: () => Promise<A>): Promise<A> =>
      await closure(),
  } as unknown as DeploymentTransactionStorage;
  const bucket = {
    put: async () => {
      r2Calls += 1;
      return null;
    },
    get: async () => {
      r2Calls += 1;
      return null;
    },
  } as unknown as R2Bucket;
  const env = {
    ARTIFACTS: bucket,
    FLAREX_ANALYZED_START_TOKEN: "push-secret",
    FLAREX_EXECUTOR: {
      fetch: async () => new Response(),
    },
    FLAREX_EXECUTOR_TOKEN: "executor-secret",
    FLAREX_PROJECT_ID: "project-a",
    FLAREX_SEMANTIC_ARTIFACT_V1_ROOT_CONFIGURATION: canonicalJson(
      semanticRootConfiguration(),
    ),
    FLAREX_SOURCE_ARTIFACT_V2_FINALIZED_READ_MAXIMUM_STORED_BYTES:
      "100000",
  } as unknown as Env;
  return {
    options: {
      deploymentId: "deployment-a",
      durableObjectName: deploymentObjectName("deployment-a"),
      storage,
      env,
    },
    r2Calls: () => r2Calls,
    sqlCalls: () => sqlCalls,
  };
}

function semanticRootConfiguration():
  SemanticArtifactV1RootConfiguration & JsonObject {
  return {
    semanticModelIdentity: "semantic-model-v1",
    semanticCodecIdentity: "semantic-codec-v1",
    semanticPolicyIdentity: "semantic-policy-v1",
    coreLanguageIdentity: "core-language-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-v1",
    parserTableIdentity: "parser-table-v1",
    trustedToolingIdentity: "trusted-tooling-v1",
    ingressProtocolIdentity: "ingress-protocol-v1",
    ingressConfigurationIdentity: "ingress-configuration-v1",
  };
}

function canonicalJson(value: JsonObject): string {
  return encodeCanonicalJson(value, () => {
    throw new Error("test JSON lost membership");
  });
}

function configurationReason(
  result: ReturnType<typeof makeDeclarativeV2ArtifactUploadHostV1>,
): DeclarativeV2ArtifactUploadHostConfigurationV1Error["reason"] | undefined {
  return Result.isFailure(result) &&
      result.failure instanceof
        DeclarativeV2ArtifactUploadHostConfigurationV1Error
    ? result.failure.reason
    : undefined;
}
