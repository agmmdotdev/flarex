import { describe, expect, it } from "vitest";
import { Cause } from "effect";
import { CoreApplicationTransportError } from "@flarex/executor-http/internal/core-application";
import { ExecutorApplicationGatewayBodyError, makeApplicationExecutorGateway, type ExecutorApplicationGatewayEnv } from "../src/applicationGateway";
import { executorApplicationConfigurationFixture } from "./support/executorApplicationConfiguration";

function fixture() {
  let legacyCalls = 0;
  const names: string[] = [];
  const forwarded: Request[] = [];
  const legacyForwarded: Request[] = [];
  const configured = executorApplicationConfigurationFixture();
  const env: ExecutorApplicationGatewayEnv = {
    FLAREX_EXECUTOR_TOKEN: "gateway-private-token",
    HYPERDRIVE_CACHE_DISABLED: { connectionString: "postgres://unused.invalid/application" },
    FLAREX_APPLICATION_PROFILES: configured.FLAREX_APPLICATION_PROFILES,
    APPLICATIONS: { getByName(name) {
      names.push(name);
      return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        forwarded.push(new Request(input, init));
        return Response.json({ forwarded: name });
      } };
    } },
  };
  const gateway = makeApplicationExecutorGateway({ fetch: async request => {
    legacyCalls += 1;
    legacyForwarded.push(request);
    return Response.json({ legacy: true });
  } });
  const request = (path: string, body?: unknown, token = "gateway-private-token") => new Request(
    `https://executor.test${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  );
  const legacyEnv = (maximumLegacyRequestBytes: number) => ({ ...env,
    FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [configured.profile], maximumLegacyRequestBytes,
      legacyProfiles: [{ kind: "legacy_session", deploymentId: "deployment_named_legacy" }] }) });
  return { env, gateway, profile: configured.profile, names, forwarded, legacyForwarded, legacyEnv, request,
    legacyCalls: () => legacyCalls };
}

describe("configured application gateway", () => {
  it("exposes only trusted control inventory before a source is installed", async () => {
    const f = fixture();
    const response = await f.gateway.fetch(f.request(`/applications/${f.profile.deploymentId}/control`), f.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ format: "flarex.core-application.control", version: 1, kind: "core",
      route: { deploymentId: f.profile.deploymentId, scopeUuid: f.profile.scopeUuid, epochUuid: f.profile.epochUuid },
      maximumPushRequestBytes: f.profile.http.maximumRegistrationRequestBytes });
    expect(f.names).toEqual([]);
    expect(f.legacyCalls()).toBe(0);
  });

  it("routes the complete candidate lifecycle to the same canonical owner and retires direct registration", async () => {
    const f = fixture();
    const path = `/applications/${f.profile.deploymentId}`;
    const id = encodeURIComponent("proposal:public");
    for (const [route, body] of [[`${path}/push/start`, { sourcePackage: {} }],
      [`${path}/push/${id}`, undefined], [`${path}/push/${id}/finish`, { activate: true }],
      [`${path}/push/${id}/abandon`, { reason: "cancel" }], [`${path}/deployment`, undefined]] as const)
      expect((await f.gateway.fetch(f.request(route, body), f.env)).status).toBe(200);
    expect(f.names).toEqual(Array(5).fill(f.profile.canonicalName));
    expect((await f.gateway.fetch(f.request(`${path}/register`, {}), f.env)).status).toBe(404);
    expect((await f.gateway.fetch(f.request(`${path}/push/start`), f.env)).status).toBe(405);
    expect(f.legacyCalls()).toBe(0);
  });

  it("authenticates before reading registration or allocating a named object", async () => {
    const f = fixture();
    const env = { ...f.env, get FLAREX_APPLICATION_PROFILES(): string { throw new Error("Configuration read before admission"); } };
    const response = await f.gateway.fetch(f.request("/applications/unknown/profile", undefined, "wrong"), env);
    expect(response.status).toBe(401);
    expect(f.names).toEqual([]);
    expect(f.legacyCalls()).toBe(0);
  });

  it("routes profile and whole calls through the same configured canonical owner", async () => {
    const f = fixture();
    const path = `/applications/${encodeURIComponent(f.profile.deploymentId)}`;
    await f.gateway.fetch(f.request(`${path}/profile`), f.env);
    const body = { format: "flarex.core-application.request", version: 1, kind: "query", functionPath: "users:read",
      requestKey: "request:gateway", sourceArtifactRootSha256: "01".repeat(32), sourcePackageHash: "02".repeat(32),
      auth: { kind: "anonymous" }, args: {} };
    await f.gateway.fetch(f.request(`${path}/invoke`, body), f.env);
    await f.gateway.fetch(f.request(`${path}/push/start`, { sourcePackage: {} }), f.env);
    expect(f.names).toEqual(Array(3).fill(f.profile.canonicalName));
    expect(await f.forwarded[1]?.json()).toEqual(body);
    expect(f.legacyCalls()).toBe(0);
  });

  it("does not downgrade an absent or withdrawn registration to legacy storage", async () => {
    const f = fixture();
    const env = { ...f.env, FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [] }) };
    const response = await f.gateway.fetch(f.request(`/applications/${f.profile.deploymentId}/profile`), env);
    expect(response.status).toBe(503);
    expect(f.names).toEqual([]);
    expect(f.legacyCalls()).toBe(0);
  });

  it("classifies and serves only an explicitly named legacy storage profile", async () => {
    const f = fixture();
    const deploymentId = "deployment_named_legacy";
    const env = { ...f.env, FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [],
      maximumLegacyRequestBytes: 1024, legacyProfiles: [{ kind: "legacy_session", deploymentId }] }) };
    const profile = await f.gateway.fetch(f.request(`/applications/${deploymentId}/profile`), env);
    expect(await profile.json()).toEqual({ format: "flarex.core-application.profile", version: 1, kind: "legacy", deploymentId });
    const invoke = await f.gateway.fetch(f.request("/invoke/start", { deploymentId }), env);
    expect(invoke.status).toBe(200);
    expect(f.legacyCalls()).toBe(1);
    expect(f.names).toEqual([]);
  });

  it("refuses the session protocol for a Core app before the legacy resource owner", async () => {
    const f = fixture();
    for (const route of ["prepare", "start", "syscall", "finish", "abort"]) {
      const response = await f.gateway.fetch(f.request(`/invoke/${route}`, { deploymentId: f.profile.deploymentId }), f.env);
      expect(response.status).toBe(409);
    }
    expect(f.legacyCalls()).toBe(0);
    expect(f.names).toEqual([]);
  });

  it("requires a trusted legacy body budget before reading a selector or allocating resources", async () => {
    const f = fixture();
    const env = { ...f.env, FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [],
      legacyProfiles: [{ kind: "legacy_session", deploymentId: "deployment_named_legacy" }] }) };
    const request = f.request("/invoke/start", {});
    Object.defineProperty(request, "body", { get: () => { throw new Error("Invalid configuration must not read the body"); } });
    expect((await f.gateway.fetch(request, env)).status).toBe(503);
    expect(f.legacyCalls()).toBe(0);
    expect(f.names).toEqual([]);
  });

  it("bounds actual chunked selector bytes and cancels the original stream without a tee", async () => {
    const f = fixture();
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ start: controller => {
      controller.enqueue(new TextEncoder().encode('{"deploymentId":'));
      controller.enqueue(new Uint8Array(256));
    }, cancel: () => { cancelled++; } });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half",
      headers: { authorization: "Bearer gateway-private-token", "content-length": "1" } };
    const request = new Request("https://executor.test/invoke/start", init);
    Object.defineProperty(request, "clone", { value: () => { throw new Error("Routing must not tee the body"); } });
    expect((await f.gateway.fetch(request, f.legacyEnv(128))).status).toBe(413);
    expect(cancelled).toBe(1);
    expect(body.locked).toBe(false);
    expect(f.legacyCalls()).toBe(0);
    expect(f.names).toEqual([]);
  });

  it("refuses malformed or selector-free legacy JSON before either resource owner", async () => {
    const f = fixture();
    for (const body of ["{", "{}"])
      expect((await f.gateway.fetch(new Request("https://executor.test/invoke/start", { method: "POST", body,
        headers: { authorization: "Bearer gateway-private-token" } }), f.legacyEnv(128))).status).toBe(400);
    expect(f.legacyCalls()).toBe(0);
    expect(f.names).toEqual([]);
  });

  it("forwards permitted legacy bytes exactly, including negative zero and source spelling", async () => {
    const f = fixture();
    const bytes = new TextEncoder().encode(' \n{"deploymentId":"deployment_named_legacy","args":{"zero":-0,"escaped":"\\u0061","text":"å"},"number":1e+00}\r\n');
    const request = new Request("https://executor.test/invoke/start", { method: "POST", body: bytes,
      headers: { authorization: "Bearer gateway-private-token", "x-invocation": "exact" } });
    Object.defineProperty(request, "clone", { value: () => { throw new Error("Routing must not tee the body"); } });
    expect((await f.gateway.fetch(request, f.legacyEnv(256))).status).toBe(200);
    expect(f.legacyForwarded).toHaveLength(1);
    const forwarded = f.legacyForwarded[0];
    if (forwarded === undefined) throw new Error("Expected one retained-parser request.");
    expect(new Uint8Array(await forwarded.arrayBuffer())).toEqual(bytes);
    expect(forwarded.headers.get("x-invocation")).toBe("exact");
    expect(request.bodyUsed).toBe(true);
    expect(f.names).toEqual([]);
  });

  it("cancels a pending original read on request abort and retains interruption", async () => {
    const f = fixture();
    const abort = new AbortController();
    let started: () => void = () => { throw new Error("Read start observer is unavailable"); };
    const entered = new Promise<void>(resolve => { started = resolve; });
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ pull: () => {
      started();
      return new Promise<void>(() => {});
    }, cancel: () => { cancelled++; } });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half", signal: abort.signal,
      headers: { authorization: "Bearer gateway-private-token" } };
    const outcome = f.gateway.fetch(new Request("https://executor.test/invoke/start", init), f.legacyEnv(128))
      .catch((cause: unknown) => cause);
    await entered;
    abort.abort();
    const refused = await outcome;
    expect(refused).toBeInstanceOf(ExecutorApplicationGatewayBodyError);
    if (!(refused instanceof ExecutorApplicationGatewayBodyError)) throw new Error("Expected the full gateway Cause.");
    expect(refused.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(cancelled).toBe(1);
    expect(body.locked).toBe(false);
    expect(f.legacyCalls()).toBe(0);
    expect(f.names).toEqual([]);
  });

  it("retains a routing bound refusal together with failed cancellation", async () => {
    const f = fixture();
    const cleanup = new Error("Routing stream cancellation failed");
    const body = new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(new Uint8Array(256)),
      cancel: () => Promise.reject(cleanup) });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half",
      headers: { authorization: "Bearer gateway-private-token" } };
    const refused = await f.gateway.fetch(new Request("https://executor.test/invoke/start", init), f.legacyEnv(128))
      .catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(ExecutorApplicationGatewayBodyError);
    if (!(refused instanceof ExecutorApplicationGatewayBodyError)) throw new Error("Expected the full gateway Cause.");
    const failures = refused.cause.reasons.flatMap(reason => Cause.isFailReason(reason)
      && reason.error instanceof CoreApplicationTransportError ? [reason.error] : []);
    expect(failures.map(error => error.reason)).toEqual(["bodyTooLarge", "bodyReadFailed"]);
    expect(failures[1]?.cause).toBe(cleanup);
    expect(body.locked).toBe(false);
    expect(f.legacyCalls()).toBe(0);
    expect(f.names).toEqual([]);
  });

  it("refuses invalid routes, methods, configuration and absent bindings without fallback", async () => {
    const f = fixture();
    const path = `/applications/${f.profile.deploymentId}`;
    expect((await f.gateway.fetch(f.request(`${path}/unknown`), f.env)).status).toBe(404);
    expect((await f.gateway.fetch(f.request(`${path}/invoke`), f.env)).status).toBe(405);
    expect((await f.gateway.fetch(f.request("/applications/%zz/profile"), f.env)).status).toBe(400);
    expect((await f.gateway.fetch(f.request(`${path}/profile`), { ...f.env, FLAREX_APPLICATION_PROFILES: "{}" })).status).toBe(503);
    const { APPLICATIONS: _namespace, ...withoutNamespace } = f.env;
    expect((await f.gateway.fetch(f.request(`${path}/profile`), withoutNamespace)).status).toBe(503);
    expect(f.names).toEqual([]);
    expect(f.legacyCalls()).toBe(0);
  });

  it("keeps metadata, health and retained stale-session recovery at their existing owner", async () => {
    const f = fixture();
    for (const path of ["/health", "/internal/v1/query-sync/source/read-after", "/invoke/abort-stale"])
      expect((await f.gateway.fetch(f.request(path), f.env)).status).toBe(200);
    expect(f.legacyCalls()).toBe(3);
    expect(f.names).toEqual([]);
  });
});
