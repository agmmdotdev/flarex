import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthConfig } from "flarex-protocol/auth";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "../src/artifactStore";
import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactInvokePayload,
} from "../src/artifactRuntime";
import { decodeExecutionArtifactInvokePayloadBody } from "../src/artifactRuntime/Requests";
import {
  createRsaSigningKeys,
  dataJsonUrl,
  signJwt,
} from "./authFixtures";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  Env,
  FinishPushResponse,
  PushSourcePackage,
  PushSourceModule,
  PushStatus,
} from "../src/types";
import {
  ANALYZED_START_TEST_AUTHORIZATION,
  createBackendHarness,
  type BackendHarness,
} from "./backendHarness";

describe("backend artifact runtime route", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("loads the active R2 source package before routing public invoke to the runtime binding", async () => {
    const runtimeCalls: Array<{
      artifactId: string | null;
      sourcePackageHash: string | null;
      body: ExecutionArtifactInvokePayload;
    }> = [];
    const keys = await createRsaSigningKeys("http-rs");
    const token = await signJwt({
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_http",
        aud: "flarex-http",
        exp: Math.floor(Date.now() / 1000) + 60,
        email: "ada@example.com",
      },
    });
    const harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "route-secret",
        FLAREX_TRUSTED_EXECUTION_IDENTITY: "true",
        FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN: "trusted-secret",
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_ARTIFACT_RUNTIME: createExecutionArtifactRuntimeService({
          capabilityToken: "route-secret",
          materializer: {
            materialize: async payload => ({
              invoke: async invokePayload => {
                runtimeCalls.push({
                  artifactId: payload.ref.artifactId,
                  sourcePackageHash: payload.ref.sourcePackageHash,
                  body: await decodeRuntimePayload(invokePayload),
                });
                return {
                  value: {
                    runtime: "artifact",
                    path: invokePayload.request.path,
                  },
                };
              },
            }),
          },
        }),
      },
    });
    harnesses.push(harness);

    const sourcePackage = testSourcePackage({
      authConfig: customJwtConfig(dataJsonUrl({ keys: [keys.jwk] })),
      authConfigModule: "_flarex/auth.config.js",
    });
    const start = await startPush(harness, "artifact-runtime-route", {
      sourcePackage,
      analysis: testAnalysis(),
    });
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await new R2BackendExecutionArtifactStore(bucket as unknown as R2BucketLike)
      .put(sourcePackage);
    const finish = await finishPush(harness, "artifact-runtime-route", start.pushId);
    expect(finish.state).toBe("activated");

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
          identity: {
            kind: "user",
            user: {
              tokenIdentifier: "public-body|user-1",
              subject: "public-body-user-1",
              issuer: "https://untrusted.example.com",
            },
          },
        }),
      },
    );
    const responseBody = await response.json();
    expect(response.ok).toBe(true);
    expect(responseBody).toEqual({
      value: { runtime: "artifact", path: "users:get" },
    });

    const createResponse = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "users:create",
          kind: "mutation",
          args: { name: "Ada" },
        }),
      },
    );
    const createBody = await createResponse.json();
    expect(createResponse.ok).toBe(true);
    expect(createBody).toEqual({
      value: { runtime: "artifact", path: "users:create" },
    });

    const omittedArgsResponse = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
        }),
      },
    );
    const omittedArgsBody = await omittedArgsResponse.json();
    expect(omittedArgsResponse.ok).toBe(true);
    expect(omittedArgsBody).toEqual({
      value: { runtime: "artifact", path: "users:get" },
    });

    const trustedIdentity = {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
      },
    } as const;
    const trustedResponse = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-trusted-execution-identity": JSON.stringify(trustedIdentity),
          "x-flarex-trusted-execution-identity-token": "trusted-secret",
        },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    const trustedBody = await trustedResponse.json();
    expect(trustedResponse.ok).toBe(true);
    expect(trustedBody).toEqual({
      value: { runtime: "artifact", path: "users:get" },
    });

    const trustedMissingToken = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-trusted-execution-identity": JSON.stringify(trustedIdentity),
        },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    expect(trustedMissingToken.status).toBe(400);
    await expect(trustedMissingToken.json()).resolves.toEqual({
      error: "Trusted execution identity token is invalid.",
    });

    const bearerResponse = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    const bearerBody = await bearerResponse.json();
    expect(bearerResponse.ok).toBe(true);
    expect(bearerBody).toEqual({
      value: { runtime: "artifact", path: "users:get" },
    });

    const invalidBearerResponse = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer not-a-jwt",
        },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    expect(invalidBearerResponse.status).toBe(401);
    await expect(invalidBearerResponse.json()).resolves.toEqual({
      error: "Authentication failed.",
    });

    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    expect(runtimeCalls).toEqual([
      {
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId: "artifact-runtime-route",
          identity: { kind: "anonymous" },
          ref,
          sourcePackage,
          request: {
            path: "users:get",
            kind: "query",
            partitionKey: "user:1",
            args: { id: "1:user" },
          },
        },
      },
      {
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId: "artifact-runtime-route",
          identity: { kind: "anonymous" },
          ref,
          sourcePackage,
          request: {
            path: "users:create",
            kind: "mutation",
            args: { name: "Ada" },
          },
        },
      },
      {
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId: "artifact-runtime-route",
          identity: { kind: "anonymous" },
          ref,
          sourcePackage,
          request: {
            path: "users:get",
            kind: "query",
            partitionKey: "user:1",
            args: null,
          },
        },
      },
      {
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId: "artifact-runtime-route",
          identity: trustedIdentity,
          ref,
          sourcePackage,
          request: {
            path: "users:get",
            kind: "query",
            partitionKey: "user:1",
            args: { id: "1:user" },
          },
        },
      },
      {
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId: "artifact-runtime-route",
          identity: {
            kind: "user",
            user: {
              tokenIdentifier: "https://issuer.example.com|user_http",
              subject: "user_http",
              issuer: "https://issuer.example.com",
              email: "ada@example.com",
            },
          },
          ref,
          sourcePackage,
          request: {
            path: "users:get",
            kind: "query",
            partitionKey: "user:1",
            args: { id: "1:user" },
          },
        },
      },
    ]);
  });

  it("does not drop verified HTTP identity in the direct-invoke fallback", async () => {
    const keys = await createRsaSigningKeys("http-direct-rs");
    const token = await signJwt({
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_http_direct",
        aud: "flarex-http",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
    });
    const harness = await createBackendHarness({
      r2Buckets: ["ARTIFACTS"],
    });
    harnesses.push(harness);

    const sourcePackage = testSourcePackage({
      authConfig: customJwtConfig(dataJsonUrl({ keys: [keys.jwk] })),
      authConfigModule: "_flarex/auth.config.js",
    });
    const start = await startPush(harness, "artifact-runtime-http-direct", {
      sourcePackage,
      analysis: testAnalysis(),
    });
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await new R2BackendExecutionArtifactStore(r2BucketLike(bucket))
      .put(sourcePackage);
    const finish = await finishPush(harness, "artifact-runtime-http-direct", start.pushId);
    expect(finish.state).toBe("activated");

    const trustedIdentity = {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
      },
    } as const;
    const trustedWithoutOptIn = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-http-direct/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-trusted-execution-identity": JSON.stringify(trustedIdentity),
        },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    expect(trustedWithoutOptIn.status).toBe(400);
    await expect(trustedWithoutOptIn.json()).resolves.toEqual({
      error: "Trusted execution identity header is disabled for this deployment.",
    });

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-http-direct/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Authenticated HTTP invoke requires an execution artifact runtime.",
    });
  });
});

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: {
        authorization: ANALYZED_START_TEST_AUTHORIZATION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  expect(response.ok).toBe(true);
  const finish = await response.json() as FinishPushResponse;
  expect(finish.result).toBe("activated");
  return finish.push;
}

function testAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "users:get",
          kind: "query",
          args: {
            type: "object",
            value: {
              id: { fieldType: { type: "id", tableName: "users" }, optional: false },
            },
          },
          returns: null,
          partition: {
            type: "partition",
            table: "users",
            selector: "byId",
            partitionField: "_id",
            argField: "id",
          },
        },
        {
          path: "users:create",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: null,
          partition: {
            type: "partitionCreateRoot",
            table: "users",
            partitionField: "_id",
          },
        },
      ],
    },
  };
}

function testSourcePackage(options: {
  authConfig?: AuthConfig;
  authConfigModule?: string;
} = {}): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "users.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const get = {};",
      },
      ...(options.authConfigModule === undefined
        ? []
        : [{
            path: options.authConfigModule,
            environment: "isolate",
            sha256: "c".repeat(64),
            source: "export default {};",
          } satisfies PushSourceModule]),
    ],
    functions: ["users.js"],
    execution: "_flarex/execution.js",
    ...(options.authConfig === undefined ? {} : { authConfig: options.authConfig }),
    ...(options.authConfigModule === undefined ? {} : { authConfigModule: options.authConfigModule }),
  };
}

function customJwtConfig(jwks: string): AuthConfig {
  return {
    providers: [
      {
        type: "customJwt",
        issuer: "https://issuer.example.com",
        jwks,
        algorithm: "RS256",
        applicationID: "flarex-http",
      },
    ],
  };
}

function decodeRuntimePayload(value: unknown): Promise<ExecutionArtifactInvokePayload> {
  return Effect.runPromise(decodeExecutionArtifactInvokePayloadBody(value));
}

function r2BucketLike(value: unknown): R2BucketLike {
  if (!isR2BucketLike(value)) {
    throw new Error("Miniflare ARTIFACTS bucket does not implement the R2 artifact store API.");
  }
  return value;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    typeof value.put === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
  );
}
