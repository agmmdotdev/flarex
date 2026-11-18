import { Effect, Result } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { coreApplicationControlPath, coreApplicationDeploymentPath, coreApplicationPushPath, coreApplicationPushStartPath,
  encodeCoreApplicationCandidate, encodeCoreApplicationControl } from "flarex-protocol/internal/core-application";
import { decodePublicActiveDeploymentStatusEffect, decodePushStatusEffect } from "flarex-protocol/deployment";
import { createBackendHarness, deployPushJsonHeaders, type BackendHarness } from "./backendHarness";
import { coreApplicationCandidateFixture } from "./support/coreApplicationCandidateFixture";
import { deploymentObjectName } from "../src/routing";
import { projectBackendCoreApplicationCandidate } from "../src/publicCoreApplicationMetadata";
import backendWorker from "../src/worker";
import type { Env } from "../src/types";

describe("public Core deployment routing", () => {
  const harnesses: BackendHarness[] = [];
  afterAll(async () => { await Promise.all(harnesses.map(harness => harness.dispose())); });

  it("projects the actual analyzed ordinary manifest", async () => {
    const fixture = await coreApplicationCandidateFixture("core-projection");
    const projected = await Effect.runPromise(projectBackendCoreApplicationCandidate(fixture.candidate));
    expect(projected.active.sourcePackageHash).toBe(fixture.candidate.sourcePackageHash);
  });

  it("forwards source-only lifecycle calls and projects genuine manifest metadata without legacy analysis", async () => {
    const deploymentId = "public-core-lifecycle";
    const fixture = await coreApplicationCandidateFixture(deploymentId);
    const pending = { ...fixture.candidate, state: "pending" as const, indexesReady: false };
    const calls: { path: string; body: unknown }[] = [];
    let legacyAnalyzerCalls = 0;
    const replies = new Map<string, Response>([
      [coreApplicationControlPath(deploymentId), Response.json(Result.getOrThrow(encodeCoreApplicationControl(fixture.control)))],
      [coreApplicationPushStartPath(deploymentId), Response.json(Result.getOrThrow(encodeCoreApplicationCandidate(pending)))],
      [coreApplicationPushPath(deploymentId, fixture.candidate.pushId), Response.json(Result.getOrThrow(encodeCoreApplicationCandidate(pending)))],
      [`${coreApplicationPushPath(deploymentId, fixture.candidate.pushId)}/finish`, Response.json(Result.getOrThrow(encodeCoreApplicationCandidate(fixture.candidate)))],
      [coreApplicationDeploymentPath(deploymentId), Response.json(Result.getOrThrow(encodeCoreApplicationCandidate(fixture.candidate)))],
    ]);
    const harness = await createBackendHarness({ bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      serviceBindings: {
        FLAREX_EXECUTOR: async request => {
          expect(request.headers.get("authorization")).toBe("Bearer core-secret");
          const path = new URL(request.url).pathname;
          calls.push({ path, body: request.method === "POST" ? await request.json() : null });
          return replies.get(path)?.clone() ?? Response.json({ error: "Unexpected request" }, { status: 500 });
        },
        FLAREX_ANALYZER: async () => { legacyAnalyzerCalls++; return Response.json({ error: "Legacy analysis is not a Core authority" }, { status: 500 }); },
      },
    });
    harnesses.push(harness);
    const start = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/push/start`, {
      method: "POST", headers: deployPushJsonHeaders(), body: JSON.stringify({ sourcePackage: fixture.sourcePackage }),
    });
    expect(start.status, await start.clone().text()).toBe(200);
    const started = await Effect.runPromise(decodePushStatusEffect(await start.json()));
    expect(started).toMatchObject({ storageProfile: "core_application", pushId: fixture.candidate.pushId, state: "analyzed", indexesReady: false });
    expect(started.codegenAnalysis?.functions.flatMap(module => module.functions.map(fn => `${fn.moduleName}:${fn.exportName}`)))
      .toEqual(fixture.manifest.functions.map(fn => fn.path));
    expect(started.analysis?.schema.tables.map(table => ({ tableId: table.tableId, name: table.name })))
      .toEqual(fixture.manifest.schema.tables.map(table => ({ tableId: table.tableId, name: table.name })));
    expect(calls.find(call => call.path === coreApplicationPushStartPath(deploymentId))?.body).toEqual({ sourcePackage: fixture.sourcePackage });
    const status = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/push/${fixture.candidate.pushId}`);
    expect(status.status).toBe(200);
    const finish = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/push/${fixture.candidate.pushId}/finish`, {
      method: "POST", headers: deployPushJsonHeaders(), body: "{}",
    });
    expect(finish.status, await finish.clone().text()).toBe(200);
    expect(await finish.json()).toMatchObject({ result: "activated", push: { state: "activated", indexesReady: true } });
    const active = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/deployment`);
    expect(active.status, await active.clone().text()).toBe(200);
    const decoded = await Effect.runPromise(decodePublicActiveDeploymentStatusEffect(await active.json()));
    expect(decoded).toMatchObject({ storageProfile: "core_application", sourcePackageHash: fixture.candidate.sourcePackageHash });
    expect(decoded).not.toHaveProperty("executionArtifactRef");
    expect(legacyAnalyzerCalls).toBe(0);
    // No SQLite candidate was created while the actual public route ran.
    const deployments = await harness.mf.getDurableObjectNamespace("DEPLOYMENTS");
    const legacy = await deployments.getByName(deploymentObjectName(deploymentId))
      .fetch(`https://deployment.internal/push/${fixture.candidate.pushId}`);
    expect(legacy.status).toBe(404);
  });

  it("authorizes and bounds public mutation bodies before source processing", async () => {
    const deploymentId = "public-core-bounds";
    const fixture = await coreApplicationCandidateFixture(deploymentId);
    const paths: string[] = [];
    const harness = await createBackendHarness({ bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      serviceBindings: { FLAREX_EXECUTOR: async request => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        return Response.json(Result.getOrThrow(encodeCoreApplicationControl({ ...fixture.control, maximumPushRequestBytes: 128 })));
      } },
    });
    harnesses.push(harness);
    const endpoint = `http://flarex.test/deployments/${deploymentId}/push/start`;
    const denied = await harness.mf.dispatchFetch(endpoint, { method: "POST", body: "{" });
    expect(denied.status).toBe(401);
    expect(paths).toEqual([]);
    const oversized = await harness.mf.dispatchFetch(endpoint, { method: "POST", headers: deployPushJsonHeaders(), body: "x".repeat(129) });
    expect(oversized.status).toBe(413);
    const malformed = await harness.mf.dispatchFetch(endpoint, { method: "POST", headers: deployPushJsonHeaders(), body: "{" });
    expect(malformed.status).toBe(400);
    const analyzed = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/push/start-analyzed`, {
      method: "POST", headers: deployPushJsonHeaders(), body: JSON.stringify({ sourcePackage: {}, analysis: {} }),
    });
    expect(analyzed.status).toBe(409);
    expect(paths).toEqual(Array(3).fill(coreApplicationControlPath(deploymentId)));
    for (const path of ["partitions/p/example", "executions/start", "sync", "scheduler"])
      expect((await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/${path}`)).status).toBe(409);
    expect(paths).toEqual(Array(7).fill(coreApplicationControlPath(deploymentId)));
    const profile = await harness.mf.dispatchFetch(`http://flarex.test/deployments/${deploymentId}/profile`);
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({ storageProfile: "core_application" });
  });

  it("never falls back to SQLite discovery for an unready or malformed Core deployment", async () => {
    const deploymentId = "public-core-unready";
    const fixture = await coreApplicationCandidateFixture(deploymentId);
    let activeReply: Response = Response.json(null);
    const harness = await createBackendHarness({ bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      serviceBindings: { FLAREX_EXECUTOR: async request => new URL(request.url).pathname === coreApplicationControlPath(deploymentId)
        ? Response.json(Result.getOrThrow(encodeCoreApplicationControl(fixture.control))) : activeReply.clone() },
    });
    harnesses.push(harness);
    const endpoint = `http://flarex.test/deployments/${deploymentId}/deployment`;
    expect((await harness.mf.dispatchFetch(endpoint)).status).toBe(404);
    activeReply = Response.json(Result.getOrThrow(encodeCoreApplicationCandidate({ ...fixture.candidate,
      sourceArtifactRootSha256: "f".repeat(64) })));
    const corrupted = await harness.mf.dispatchFetch(endpoint);
    expect(corrupted.status).toBe(503);
    expect(await corrupted.json()).toEqual({ error: "Core application deployment metadata is unavailable." });
  });

  it("propagates public request cancellation to an in-flight private source request", async () => {
    const deploymentId = "public-core-cancel";
    const fixture = await coreApplicationCandidateFixture(deploymentId);
    let announce: (() => void) | undefined;
    const entered = new Promise<void>(resolve => { announce = resolve; });
    const controller = new AbortController();
    const paths: string[] = [];
    let aborted = 0;
    let artifactCalls = 0;
    const harness = await createBackendHarness({ bindings: { FLAREX_EXECUTOR_TRANSPORT: "core_application", FLAREX_EXECUTOR_TOKEN: "core-secret" },
      serviceBindings: { FLAREX_EXECUTOR: async () => Response.json({ error: "Observed private fetch should be intercepted" }, { status: 500 }),
        FLAREX_ARTIFACT_RUNTIME: async () => { artifactCalls++; return Response.json({ error: "Unexpected fallback" }, { status: 500 }); } },
    });
    harnesses.push(harness);
    const bindings = await harness.mf.getBindings<Env>();
    const source = bindings.FLAREX_EXECUTOR;
    if (source === undefined) throw new Error("The native private service binding is missing.");
    const observed = new Proxy(source, { get(target, property, receiver) {
      if (property !== "fetch") return Reflect.get(target, property, receiver);
      return async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === coreApplicationControlPath(deploymentId))
          return Response.json(Result.getOrThrow(encodeCoreApplicationControl(fixture.control)));
        if (path !== coreApplicationPushStartPath(deploymentId)) throw new Error("Cancellation reached an unexpected private operation.");
        await new Promise<never>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => { aborted++; reject(request.signal.reason); }, { once: true });
          if (announce === undefined) throw new Error("The private request observer is not initialized.");
          announce();
        });
        throw new Error("Cancelled source request unexpectedly completed.");
      };
    } });
    const pending = backendWorker.fetch(new Request(`http://flarex.test/deployments/${deploymentId}/push/start`, {
      method: "POST", headers: deployPushJsonHeaders(), body: JSON.stringify({ sourcePackage: fixture.sourcePackage }), signal: controller.signal,
    }), { ...bindings, FLAREX_EXECUTOR: observed });
    try {
      await Promise.race([entered, pending.then(async response => { throw new Error(await response.clone().text()); })]);
      controller.abort(new Error("Public request disconnected."));
      const response = await pending;
      expect(response.status).toBe(500);
      await response.arrayBuffer();
      expect(aborted).toBe(1);
      expect(paths).toEqual([coreApplicationControlPath(deploymentId), coreApplicationPushStartPath(deploymentId)]);
      expect(artifactCalls).toBe(0);
    } finally { controller.abort(); await pending; }
  });
});
