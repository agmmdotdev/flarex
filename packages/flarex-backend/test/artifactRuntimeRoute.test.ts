import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { Cause, Effect, Exit, Result } from "effect";
import { CoreApplicationTransportError, makeCoreApplicationHttpHandler } from "@flarex/executor-http/internal/core-application";
import {
  coreApplicationControlPath,
  coreApplicationDeploymentPath,
  coreApplicationValueToJson,
  encodeCoreApplicationControl,
  encodeCoreApplicationCandidate,
  type CoreApplicationInvocationRequest,
} from "flarex-protocol/internal/core-application";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthConfig } from "flarex-protocol/auth";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "../src/artifactStore";
import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactInvokePayload,
} from "../src/artifactRuntime";
import { decodeExecutionArtifactInvokePayloadBody } from "../src/artifactRuntime/Requests";
import { projectBackendCoreApplicationErrors } from "../src/coreApplicationRuntime";
import {
  createRsaSigningKeys,
  dataJsonUrl,
  signJwt,
} from "./authFixtures";
import { sourceModuleSha256ForTest } from "./sourcePackageHashFixture";
import { coreApplicationCandidateFixture } from "./support/coreApplicationCandidateFixture";
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
  createBackendHarness,
  deployPushJsonHeaders,
  type BackendHarness,
} from "./backendHarness";

describe("backend artifact runtime route", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("preserves transport provenance and simultaneous defects while refusing a malformed successful response", async () => {
    const original = new CoreApplicationTransportError({ reason: "invalidResponse", status: 200, cause: new Error("malformed wire") });
    const defect = new Error("independent defect");
    const result = await Effect.runPromiseExit(projectBackendCoreApplicationErrors(Effect.failCause(
      Cause.combine(Cause.fail(original), Cause.die(defect)),
    )));
    expect(Exit.isFailure(result) && result.cause.reasons).toMatchObject([
      { _tag: "Fail", error: { status: 503, cause: original } }, { _tag: "Die", defect },
    ]);
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

  it("routes registered Core calls directly with verified identity, exact values and one caller key", async () => {
    const deploymentId = "core-runtime-route";
    const keys = await createRsaSigningKeys("core-http");
    const token = await signJwt({ privateKey: keys.privateKey, kid: keys.jwk.kid, payload: {
      iss: "https://issuer.example.com", sub: "core-user", aud: "flarex-http",
      exp: Math.floor(Date.now() / 1000) + 60,
    } });
    const { profile, candidate, control } = await coreApplicationCandidateFixture(deploymentId,
      customJwtConfig(dataJsonUrl({ keys: [keys.jwk] })));
    const calls: CoreApplicationInvocationRequest[] = [];
    let lookups = 0;
    let artifactCalls = 0;
    const exact = { counter: 9_007_199_254_740_993n, bytes: new Uint8Array([0, 128, 255]).buffer, signedZero: -0 };
    const encoded = Result.getOrThrow(coreApplicationValueToJson(exact));
    const handle = makeCoreApplicationHttpHandler({ route: profile.route,
      authorize: request => Effect.succeed(request.headers.get("authorization") === "Bearer core-secret"),
      execute: request => {
        calls.push(request);
        return Effect.succeed(request.kind === "query"
          ? { kind: "query" as const, value: exact, evaluation: { timestamp: 9_007_199_254_740_993n, reads: [] } }
          : { kind: "mutation" as const, value: exact, disposition: "published" as const, publishedTimestamp: 9_007_199_254_740_995n });
      }, maximumRequestBytes: 1_048_576, maximumResponseBytes: 1_048_576 });
    const harness = await createBackendHarness({
      bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret",
        FLAREX_TRUSTED_EXECUTION_IDENTITY: "true", FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN: "trusted-core-secret" },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_EXECUTOR: request => {
          if (new URL(request.url).pathname === coreApplicationControlPath(deploymentId)) {
            lookups++;
            expect(request.headers.get("authorization")).toBe("Bearer core-secret");
            return Response.json(Result.getOrThrow(encodeCoreApplicationControl(control)));
          }
          if (new URL(request.url).pathname === coreApplicationDeploymentPath(deploymentId))
            return Response.json(Result.getOrThrow(encodeCoreApplicationCandidate(candidate)));
          return Effect.runPromise(handle(request));
        },
        FLAREX_ARTIFACT_RUNTIME: async () => { artifactCalls++; return Response.json({ value: "wrong runtime" }); },
      },
    });
    harnesses.push(harness);

    for (const [path, kind, idempotencyKey] of [
      ["users:get", "query", "core-query-key"], ["users:create", "mutation", "core-mutation-key"],
    ] as const) {
      const response = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ path, kind, args: { payload: encoded }, idempotencyKey,
          identity: { kind: "anonymous" } }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ value: encoded });
    }
    expect(calls).toHaveLength(2);
    expect(lookups).toBe(2);
    expect(calls.map(call => call.requestKey)).toEqual(["core-query-key", "core-mutation-key"]);
    expect(calls.map(call => call.functionPath)).toEqual(["users:get", "users:create"]);
    expect(calls[0]?.args).toEqual({ payload: exact });
    expect(calls[0]?.auth).toMatchObject({ kind: "user", user: {
      subject: "core-user", issuer: "https://issuer.example.com", tokenIdentifier: "https://issuer.example.com|core-user",
    } });
    expect(calls[0]?.sourceArtifactRootSha256).toBe(profile.sourceArtifactRootSha256);

    const unauthorized = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer invalid-jwt" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: {} }),
    });
    expect(unauthorized.status).toBe(401);
    expect(lookups).toBe(3);
    expect(calls).toHaveLength(2);

    const omitted = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "users:get", kind: "query" }),
    });
    expect(omitted.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.args).toEqual({});
    expect(calls[2]?.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    const explicitNull = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: null }),
    });
    expect(explicitNull.status).toBe(400);
    await expect(explicitNull.json()).resolves.toEqual({ error: "Invalid Core application arguments." });
    expect(calls).toHaveLength(3);
    const partitioned = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: {}, partitionKey: "other-partition" }),
    });
    expect(partitioned.status).toBe(400);
    await expect(partitioned.json()).resolves.toEqual({ error: "Core application execution does not admit partition routing." });
    expect(calls).toHaveLength(3);
    const trustedIdentity = { kind: "user", user: { subject: "trusted-core-user",
      issuer: "https://trusted.example.com", tokenIdentifier: "https://trusted.example.com|trusted-core-user" } } as const;
    const trusted = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json",
        "x-flarex-trusted-execution-identity": JSON.stringify(trustedIdentity),
        "x-flarex-trusted-execution-identity-token": "trusted-core-secret" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: {}, idempotencyKey: "trusted-core-key" }),
    });
    expect(trusted.status).toBe(200);
    expect(calls).toHaveLength(4);
    expect(calls[3]?.auth).toEqual(trustedIdentity);
    expect(calls[3]?.requestKey).toBe("trusted-core-key");
    expect(artifactCalls).toBe(0);
  });

  it("uses the retained artifact runtime only for an explicit legacy profile", async () => {
    const deploymentId = "explicit-legacy-profile";
    let lookups = 0;
    let artifactCalls = 0;
    const harness = await createBackendHarness({
      bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      r2Buckets: ["ARTIFACTS"], serviceBindings: {
        FLAREX_EXECUTOR: async request => {
          expect(new URL(request.url).pathname).toBe(coreApplicationControlPath(deploymentId));
          lookups++;
          return Response.json(Result.getOrThrow(encodeCoreApplicationControl({
            format: "flarex.core-application.control", version: 1, kind: "legacy", deploymentId,
          })));
        },
        FLAREX_ARTIFACT_RUNTIME: async () => { artifactCalls++; return Response.json({ value: "legacy artifact" }); },
      },
    });
    harnesses.push(harness);
    await activateRuntimeDeployment(harness, deploymentId, testSourcePackage());
    lookups = 0;
    const response = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: {}, partitionKey: "retained-partition" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value: "legacy artifact" });
    expect(lookups).toBe(1);
    expect(artifactCalls).toBe(1);
  });

  it("refuses stale Core source and lookup or invocation failure without artifact fallback", async () => {
    const deploymentId = "core-runtime-refusal";
    const { candidate, control } = await coreApplicationCandidateFixture(deploymentId);
    let mode: "stale" | "lookup-failure" | "invoke-failure" | "malformed-success" | "oversized-success" = "stale";
    let invokes = 0;
    let artifactCalls = 0;
    const harness = await createBackendHarness({
      bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      r2Buckets: ["ARTIFACTS"], serviceBindings: {
        FLAREX_EXECUTOR: async request => {
          if (new URL(request.url).pathname === coreApplicationControlPath(deploymentId)) {
            if (mode === "lookup-failure") return Response.json({ error: "untrusted internal detail" }, { status: 503 });
            return Response.json(Result.getOrThrow(encodeCoreApplicationControl(control)));
          }
          if (new URL(request.url).pathname === coreApplicationDeploymentPath(deploymentId))
            return Response.json(Result.getOrThrow(encodeCoreApplicationCandidate(mode === "stale"
              ? { ...candidate, sourcePackageHash: "e".repeat(64) } : candidate)));
          invokes++;
          if (mode === "malformed-success") return new Response("{malformed", { status: 200 });
          if (mode === "oversized-success") return new Response(new Uint8Array(32 * 1024 * 1024 + 1), { status: 200 });
          return Response.json({ format: "flarex.core-application.failure", version: 1,
            error: { code: "source_changed", message: "Core source changed before invocation." } }, { status: 409 });
        },
        FLAREX_ARTIFACT_RUNTIME: async () => { artifactCalls++; return Response.json({ value: "wrong runtime" }); },
      },
    });
    harnesses.push(harness);
    const invoke = () => harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: {}, idempotencyKey: "stable-core-key" }),
    });
    const stale = await invoke();
    expect(stale.status).toBe(503);
    await expect(stale.json()).resolves.toEqual({ error: "Core application deployment metadata is unavailable." });
    expect(invokes).toBe(0);
    mode = "lookup-failure";
    const unavailable = await invoke();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("untrusted internal detail");
    expect(invokes).toBe(0);
    mode = "invoke-failure";
    const failed = await invoke();
    expect(failed.status).toBe(409);
    await expect(failed.json()).resolves.toEqual({ error: "Core source changed before invocation." });
    expect(invokes).toBe(1);
    for (const invalidSuccess of ["malformed-success", "oversized-success"] as const) {
      mode = invalidSuccess;
      const invalid = await invoke();
      expect(invalid.status).toBe(503);
      await expect(invalid.json()).resolves.toEqual({ error: "Core application executor request failed." });
    }
    expect(invokes).toBe(3);
    expect(artifactCalls).toBe(0);
  });

  it("requires the configured Core binding instead of running an artifact", async () => {
    const deploymentId = "core-runtime-missing-binding";
    let artifactCalls = 0;
    const harness = await createBackendHarness({
      bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      r2Buckets: ["ARTIFACTS"], serviceBindings: {
        FLAREX_ARTIFACT_RUNTIME: async () => { artifactCalls++; return Response.json({ value: "wrong runtime" }); },
      },
    });
    harnesses.push(harness);
    const response = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/invoke`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "users:get", kind: "query", args: {} }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Core application executor is not configured." });
    expect(artifactCalls).toBe(0);
  });
});

async function activateRuntimeDeployment(harness: BackendHarness, deploymentId: string, sourcePackage: PushSourcePackage) {
  const started = await startPush(harness, deploymentId, { sourcePackage, analysis: testAnalysis() });
  const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
  await new R2BackendExecutionArtifactStore(r2BucketLike(bucket)).put(sourcePackage);
  expect((await finishPush(harness, deploymentId, started.pushId)).state).toBe("activated");
}

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: deployPushJsonHeaders(),
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
      headers: deployPushJsonHeaders(),
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
    sourceModuleDigestFormat: "sha256-framed-v1",
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: sourceModuleSha256ForTest("export default {};"),
        source: "export default {};",
      },
      {
        path: "users.js",
        environment: "isolate",
        sha256: sourceModuleSha256ForTest("export const get = {};"),
        source: "export const get = {};",
      },
      ...(options.authConfigModule === undefined
        ? []
        : [{
            path: options.authConfigModule,
            environment: "isolate",
            sha256: sourceModuleSha256ForTest("export default {};"),
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
