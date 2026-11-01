import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  coreApplicationInvocationPath, coreApplicationProfilePath, encodeCoreApplicationInvocationSuccess,
  type CoreApplicationCoreProfile, type CoreApplicationInvocationResult, type CoreApplicationInvocationSuccess,
  type CoreApplicationCandidate, coreApplicationControlPath, coreApplicationPushStartPath, coreApplicationPushPath,
} from "flarex-protocol/internal/core-application";
import { captureDocumentObject } from "flarex-protocol/document-value";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { makeCoreApplicationClient, makeCoreApplicationHttpHandler, lookupCoreApplicationProfile,
  lookupCoreApplicationControl, makeCoreApplicationDeploymentClient,
  CoreApplicationTransportError, decodeCoreApplicationJsonBody, readCoreApplicationBodyBytes,
  type CoreApplicationClientInvocation, type CoreApplicationTransport } from "../src/coreApplication";

const profile: CoreApplicationCoreProfile = { format: "flarex.core-application.profile", version: 1, kind: "core",
  route: { deploymentId: "core-http", scopeUuid: "11000000-0000-4000-8000-000000000001",
    epochUuid: "11000000-0000-4000-8000-000000000002" },
  sourceArtifactRootSha256: "a".repeat(64), sourcePackageHash: "b".repeat(64) };
const input = (): CoreApplicationClientInvocation => ({ kind: "query",
  functionPath: TransactionFunctionPathV1Schema.make("items:read"), requestKey: TransactionRequestKeyV1Schema.make("request-1"),
  auth: { kind: "anonymous" }, args: Result.getOrThrow(captureDocumentObject({ exact: 9007199254740993n })) });
const query: CoreApplicationInvocationResult = { kind: "query", value: 9007199254740993n,
  evaluation: { timestamp: 9007199254740993n, reads: [{ indexId: new Uint8Array(16).fill(1), intervals: [{ start: null, end: null }] }] } };
const result = (): CoreApplicationInvocationSuccess => ({ ...query,
  format: "flarex.core-application.response", version: 1, route: profile.route,
  functionPath: input().functionPath, requestKey: input().requestKey });

describe("Core whole-function HTTP boundary", () => {
  it("separates configured control inventory from a ready persisted application", async () => {
    const configured = await Effect.runPromise(lookupCoreApplicationControl({ deploymentId: profile.route.deploymentId,
      capabilityToken: "capability", transport: { fetch: async request => {
        expect(new URL(request.url).pathname).toBe(coreApplicationControlPath(profile.route.deploymentId));
        expect(request.headers.get("authorization")).toBe("Bearer capability");
        return Response.json({ format: "flarex.core-application.control", version: 1, kind: "core", route: profile.route,
          maximumPushRequestBytes: 8192 });
      } } }));
    expect(configured).toMatchObject({ kind: "core", maximumPushRequestBytes: 8192 });
    const wrong = await Effect.runPromise(lookupCoreApplicationControl({ deploymentId: profile.route.deploymentId,
      capabilityToken: "capability", transport: { fetch: async () => Response.json({ format: "flarex.core-application.control", version: 1,
        kind: "legacy", deploymentId: "other" }) } }).pipe(Effect.flip));
    expect(wrong.reason).toBe("invalidResponse");
  });

  it("binds candidate lifecycle calls to one route and proposal without retries", async () => {
    const candidate: CoreApplicationCandidate = { format: "flarex.core-application.candidate", version: 1, route: profile.route,
      pushId: "proposal:one", state: "validated", sourceArtifactRootSha256: profile.sourceArtifactRootSha256,
      sourcePackageHash: profile.sourcePackageHash, canonicalManifest: "{}", sourcePackage: { modules: [], functions: [], execution: "app.js" },
      createdAt: 1, updatedAt: 2, indexesReady: true };
    const paths: string[] = [];
    const bodies: unknown[] = [];
    const client = makeCoreApplicationDeploymentClient({ deploymentId: profile.route.deploymentId, expectedRoute: profile.route,
      capabilityToken: "capability", transport: { fetch: async request => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (request.method === "POST") bodies.push(await request.json());
        return Response.json(path.endsWith("/abandon") ? { ...candidate, state: "abandoned" } : candidate);
      } } });
    expect(await Effect.runPromise(client.start(candidate.sourcePackage))).toEqual(candidate);
    expect(await Effect.runPromise(client.read(candidate.pushId))).toEqual(candidate);
    expect(await Effect.runPromise(client.finish(candidate.pushId, { activate: false }))).toEqual(candidate);
    expect(await Effect.runPromise(client.abandon(candidate.pushId, { reason: "cancel" }))).toEqual({ ...candidate, state: "abandoned" });
    expect(paths).toEqual([coreApplicationPushStartPath(profile.route.deploymentId),
      coreApplicationPushPath(profile.route.deploymentId, candidate.pushId),
      `${coreApplicationPushPath(profile.route.deploymentId, candidate.pushId)}/finish`,
      `${coreApplicationPushPath(profile.route.deploymentId, candidate.pushId)}/abandon`]);
    expect(bodies).toEqual([{ sourcePackage: candidate.sourcePackage }, { activate: false }, { reason: "cancel" }]);
    const corrupt = makeCoreApplicationDeploymentClient({ deploymentId: profile.route.deploymentId, capabilityToken: "capability",
      transport: { fetch: async () => Response.json({ ...candidate, pushId: "other" }) } });
    expect((await Effect.runPromise(corrupt.finish(candidate.pushId).pipe(Effect.flip))).reason).toBe("invalidResponse");
    const absent = makeCoreApplicationDeploymentClient({ deploymentId: profile.route.deploymentId, capabilityToken: "capability",
      transport: { fetch: async () => Response.json(null) } });
    expect(await Effect.runPromise(absent.active())).toBeNull();
    expect((await Effect.runPromise(absent.finish(candidate.pushId).pipe(Effect.flip))).reason).toBe("invalidResponse");
  });

  it("executes once through an authenticated bound route and preserves real evaluation", async () => {
    let calls = 0;
    const handler = makeCoreApplicationHttpHandler({ route: profile.route, maximumRequestBytes: 4096, maximumResponseBytes: 4096,
      authorize: request => Effect.succeed(request.headers.get("authorization") === "Bearer capability"),
      execute: request => Effect.sync(() => {
        calls += 1;
        expect(request.args.exact).toBe(9007199254740993n);
        expect(request.sourceArtifactRootSha256).toBe(profile.sourceArtifactRootSha256);
        return query;
      }),
    });
    const client = makeCoreApplicationClient({ profile, capabilityToken: "capability",
      transport: { fetch: request => Effect.runPromise(handler(request)) } });
    const response = await Effect.runPromise(client.invoke(input()));
    expect(response).toEqual(result());
    expect(calls).toBe(1);
  });

  it("authenticates before reading the request body or executing", async () => {
    let reads = 0, calls = 0;
    const request = new Request(`https://executor${coreApplicationInvocationPath(profile.route.deploymentId)}`, { method: "POST", body: "{}" });
    Object.defineProperty(request, "body", { get: () => { reads += 1; throw new Error("Body must stay unread"); } });
    const handler = makeCoreApplicationHttpHandler({ route: profile.route, maximumRequestBytes: 32, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(false), execute: () => Effect.sync(() => { calls += 1; return query; }) });
    expect((await Effect.runPromise(handler(request))).status).toBe(401);
    expect(reads).toBe(0);
    expect(calls).toBe(0);
  });

  it("rejects malformed and oversized streamed requests without a function call", async () => {
    let calls = 0, cancelled = false;
    const handler = makeCoreApplicationHttpHandler({ route: profile.route, maximumRequestBytes: 8, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.sync(() => { calls += 1; return query; }) });
    const path = `https://executor${coreApplicationInvocationPath(profile.route.deploymentId)}`;
    expect((await Effect.runPromise(handler(new Request(path, { method: "POST", body: "{" })))).status).toBe(400);
    const body = new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(new Uint8Array(16)),
      cancel: () => { cancelled = true; } });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
    expect((await Effect.runPromise(handler(new Request(path, init)))).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(calls).toBe(0);
  });

  it("does not retry a mutation after an uncertain transport acknowledgement", async () => {
    let calls = 0;
    const keys: string[] = [];
    const client = makeCoreApplicationClient({ profile, capabilityToken: "capability", transport: {
      fetch: async request => { calls += 1; const body: unknown = await request.json();
        expect(body).toMatchObject({ kind: "mutation", requestKey: "request-1" });
        keys.push(input().requestKey);
        throw new Error("Acknowledgement lost after execution"); },
    } });
    const failure = await Effect.runPromise(client.invoke({ ...input(), kind: "mutation" }).pipe(Effect.flip));
    expect(failure.reason).toBe("requestFailed");
    expect(calls).toBe(1);
    expect(keys).toEqual(["request-1"]);
  });

  it("retains a body-bound violation together with a failed stream cancellation", async () => {
    const cleanup = new Error("Reader cancellation failed");
    const body = new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(new Uint8Array(16)),
      cancel: () => Promise.reject(cleanup) });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
    const handler = makeCoreApplicationHttpHandler({ route: profile.route, maximumRequestBytes: 8, maximumResponseBytes: 4096,
      authorize: () => Effect.succeed(true), execute: () => Effect.succeed(query) });
    const exit = await Effect.runPromiseExit(handler(new Request(
      `https://executor${coreApplicationInvocationPath(profile.route.deploymentId)}`, init)));
    if (Exit.isSuccess(exit)) throw new Error("Cleanup failure must not become a client response");
    const failures = exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason)
      && reason.error instanceof CoreApplicationTransportError ? [reason.error] : []);
    expect(failures.map(failure => failure.reason)).toEqual(["bodyTooLarge", "bodyReadFailed"]);
    expect(failures[1]?.cause).toBe(cleanup);
  });

  it("captures bounded bytes once without normalizing the JSON representation", async () => {
    const bytes = new TextEncoder().encode(' \n{"zero":-0,"escaped":"\\u0061","number":1e+00}\r\n');
    const captured = await Effect.runPromise(readCoreApplicationBodyBytes(new Response(bytes), bytes.byteLength));
    expect(captured).toEqual(bytes);
    expect(Result.getOrThrow(decodeCoreApplicationJsonBody(captured))).toEqual({ zero: -0, escaped: "a", number: 1 });
    expect(Result.isFailure(decodeCoreApplicationJsonBody(new Uint8Array([0xff])))).toBe(true);
  });

  it("preserves both response-size refusal and cancellation failure in the client projection", async () => {
    const cleanup = new Error("Response reader cancellation failed");
    const body = new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(new Uint8Array(16)),
      cancel: () => Promise.reject(cleanup) });
    const exit = await Effect.runPromiseExit(lookupCoreApplicationProfile({ deploymentId: profile.route.deploymentId,
      capabilityToken: "capability", maximumResponseBytes: 8, transport: { fetch: async () => new Response(body) } }));
    if (Exit.isSuccess(exit)) throw new Error("Expected complete client read failure.");
    const failures = exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason)
      && reason.error instanceof CoreApplicationTransportError ? [reason.error] : []);
    expect(failures.map(failure => failure.reason)).toEqual(["invalidResponse", "invalidResponse"]);
    expect(failures.map(failure => failure.cause)).toMatchObject([{ reason: "bodyTooLarge" }, { reason: "bodyReadFailed", cause: cleanup }]);
    expect(body.locked).toBe(false);
  });

  it("preserves a response reader defect alongside its typed bound failure", async () => {
    const defect = new Error("Response reader release defect");
    const body = new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(new Uint8Array(16)) });
    const getReader = body.getReader.bind(body);
    Object.defineProperty(body, "getReader", { value: () => {
      const reader = getReader();
      const release = reader.releaseLock.bind(reader);
      Object.defineProperty(reader, "releaseLock", { value: () => { release(); throw defect; } });
      return reader;
    } });
    const exit = await Effect.runPromiseExit(lookupCoreApplicationProfile({ deploymentId: profile.route.deploymentId,
      capabilityToken: "capability", maximumResponseBytes: 8, transport: { fetch: async () => new Response(body) } }));
    if (Exit.isSuccess(exit)) throw new Error("Expected complete client read failure.");
    expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toMatchObject([
      { reason: "invalidResponse", cause: { reason: "bodyTooLarge" } },
    ]);
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(body.locked).toBe(false);
  });

  it("preserves interruption and a typed response cleanup failure", async () => {
    const abort = new AbortController();
    const cleanup = new Error("Interrupted response cancellation failed");
    let started: () => void = () => { throw new Error("Missing reader observer"); };
    const entered = new Promise<void>(resolve => { started = resolve; });
    const body = new ReadableStream<Uint8Array>({ pull: () => {
      started();
      return new Promise<void>(() => {});
    }, cancel: () => Promise.reject(cleanup) });
    const outcome = Effect.runPromiseExit(lookupCoreApplicationProfile({ deploymentId: profile.route.deploymentId,
      capabilityToken: "capability", maximumResponseBytes: 8, transport: { fetch: async () => new Response(body) } }), { signal: abort.signal });
    await entered;
    abort.abort();
    const exit = await outcome;
    if (Exit.isSuccess(exit)) throw new Error("Expected interrupted client read.");
    expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toMatchObject([
      { reason: "bodyReadFailed", cause: cleanup },
    ]);
    expect(body.locked).toBe(false);
  });

  it("keeps a response-bound failure distinct after the function has executed", async () => {
    let calls = 0;
    let serverFailure: unknown;
    const handler = makeCoreApplicationHttpHandler({ route: profile.route, maximumRequestBytes: 4096, maximumResponseBytes: 8,
      authorize: () => Effect.succeed(true), execute: () => Effect.sync(() => { calls += 1; return query; }) });
    const client = makeCoreApplicationClient({ profile, capabilityToken: "capability", transport: {
      fetch: request => Effect.runPromise(handler(request).pipe(
        Effect.tapError(failure => Effect.sync(() => { serverFailure = failure; })))),
    } });
    const failed = await Effect.runPromise(client.invoke(input()).pipe(Effect.flip));
    expect(failed.reason).toBe("requestFailed");
    expect(serverFailure).toMatchObject({ reason: "responseTooLarge" });
    expect(calls).toBe(1);
  });

  it.each(["route", "epoch", "function", "key", "kind"] as const)("rejects mismatched response %s", async change => {
    const original = result();
    const wrong: CoreApplicationInvocationSuccess = change === "route" ? { ...original, route: { ...profile.route, deploymentId: "other" } }
      : change === "epoch" ? { ...original, route: { ...profile.route, epochUuid: "11000000-0000-4000-8000-000000000003" } }
        : change === "function" ? { ...original, functionPath: TransactionFunctionPathV1Schema.make("items:other") }
          : change === "key" ? { ...original, requestKey: TransactionRequestKeyV1Schema.make("other") }
            : { format: original.format, version: original.version, route: original.route, functionPath: original.functionPath,
              requestKey: original.requestKey, kind: "mutation", value: original.value, disposition: "published", publishedTimestamp: 1n };
    const client = makeCoreApplicationClient({ profile, capabilityToken: "capability", transport: {
      fetch: async () => Response.json(Result.getOrThrow(encodeCoreApplicationInvocationSuccess(wrong))),
    } });
    expect((await Effect.runPromise(client.invoke(input()).pipe(Effect.flip))).reason).toBe("invalidResponse");
  });

  it("retains HTTP status and accepts messages only from the redacted failure contract", async () => {
    const transport: CoreApplicationTransport = { fetch: async () => Response.json({ secret: "database password" }, { status: 503 }) };
    const client = makeCoreApplicationClient({ profile, capabilityToken: "capability", transport });
    const failure = await Effect.runPromise(client.invoke(input()).pipe(Effect.flip));
    expect(failure).toMatchObject({ reason: "httpFailure", status: 503, message: "Core application request failed." });
    expect(JSON.stringify(failure)).not.toContain("database password");
    const projected = makeCoreApplicationClient({ profile, capabilityToken: "capability", transport: {
      fetch: async () => Response.json({ format: "flarex.core-application.failure", version: 1,
        error: { code: "not_ready", message: "Application is not ready." } }, { status: 409 }),
    } });
    expect(await Effect.runPromise(projected.invoke(input()).pipe(Effect.flip)))
      .toMatchObject({ reason: "httpFailure", status: 409, code: "not_ready", message: "Application is not ready." });
  });

  it("requires an explicit authoritative profile and never treats a lookup failure as legacy", async () => {
    const lookup = (body: unknown, status = 200) => lookupCoreApplicationProfile({ deploymentId: profile.route.deploymentId,
      capabilityToken: "capability", transport: { fetch: async request => {
        expect(new URL(request.url).pathname).toBe(coreApplicationProfilePath(profile.route.deploymentId));
        return Response.json(body, { status });
      } } });
    expect(await Effect.runPromise(lookup(profile))).toEqual(profile);
    expect((await Effect.runPromise(lookup({ ...profile, route: { ...profile.route, deploymentId: "other" } }).pipe(Effect.flip))).reason)
      .toBe("invalidResponse");
    expect((await Effect.runPromise(lookup({ error: "not ready" }, 409).pipe(Effect.flip))).reason).toBe("httpFailure");
    expect(await Effect.runPromise(lookup({ format: "flarex.core-application.profile", version: 1,
      kind: "legacy", deploymentId: profile.route.deploymentId }))).toMatchObject({ kind: "legacy" });
  });
});
