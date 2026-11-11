import { beforeEach, expect, it, vi } from "vitest";
import { executorApplicationProfileFixture } from "./executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./medusaDOTestRunner";

interface FakeRuntime {
  readonly options: unknown;
  readonly ready: Promise<void>;
  readonly dispatchFetch: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
  readonly dispose: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

const fake = vi.hoisted(() => {
  const runtimes: FakeRuntime[] = [];
  return { runtimes, build: vi.fn<(entry: URL) => Promise<string>>(), secret: vi.fn<(keyId: string) => Promise<string>>() };
});

vi.mock("./bundleApplicationWorker", () => ({ bundleApplicationWorker: fake.build }));
vi.mock("./executorApplicationConfiguration", async original => ({
  ...await original<typeof import("./executorApplicationConfiguration")>(), createExecutorApplicationSecretFixture: fake.secret,
}));
vi.mock("miniflare", () => ({ Miniflare: class {
  readonly ready = Promise.resolve();
  readonly dispatchFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
  readonly dispose = vi.fn(async () => {});
  constructor(readonly options: unknown) { fake.runtimes.push(this); }
} }));

beforeEach(() => {
  fake.runtimes.length = 0;
  fake.build.mockReset().mockResolvedValue("worker fixture");
  fake.secret.mockReset().mockResolvedValue("scenario keys");
});

const options = () => ({ profile: executorApplicationProfileFixture(), connectionString: "postgres://fixture",
  privateToken: "private-fixture", className: "NativeFixture", hostname: "native.test",
  headers: { origin: "https://store.test", "x-publishable-api-key": "pk_fixture" } });

function runtimeAt(index: number) {
  const runtime = fake.runtimes[index];
  if (runtime === undefined) throw new Error("Expected a scenario runtime");
  return runtime;
}

it("lazily shares one in-flight build while keeping scenario runtimes, profiles and keys independent", async () => {
  let complete: ((value: string) => void) | undefined;
  fake.build.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  fake.secret.mockResolvedValueOnce("first keys").mockResolvedValueOnce("second keys");
  const suite = createMedusaDOTestSuite(new URL("file:///worker.ts"));
  expect(fake.build).not.toHaveBeenCalled();
  const first = suite.createScenario(options());
  const second = suite.createScenario({ ...options(), profile: { ...options().profile, instanceName: "second-instance" } });
  expect(fake.build).toHaveBeenCalledTimes(1);
  if (complete === undefined) throw new Error("Build was not started");
  complete("shared worker");
  const [left, right] = await Promise.all([first, second]);
  expect(fake.runtimes).toHaveLength(0);
  left.start(); right.start();
  await Promise.all([left.ready(), right.ready()]);
  expect(fake.runtimes).toHaveLength(2);
  expect(runtimeAt(0).options).toMatchObject({ modules: [{ contents: "shared worker" }],
    bindings: { FLAREX_APPLICATION_KEYS: "first keys" }, hyperdrives: { HYPERDRIVE_CACHE_DISABLED: "postgres://fixture" },
    durableObjects: { APPLICATIONS: { className: "NativeFixture", useSQLite: true } } });
  expect(runtimeAt(1).options).toMatchObject({ bindings: { FLAREX_APPLICATION_KEYS: "second keys",
    FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [{ ...options().profile, instanceName: "second-instance" }] }) } });
  await left.stop();
  expect(right.isRunning()).toBe(true);
  left.start(); await left.ready();
  expect(fake.build).toHaveBeenCalledTimes(1);
  await Promise.all([left.stop(), right.stop()]);
});

it("clears a rejected shared build so a later scenario can try again", async () => {
  const failure = new Error("build failed");
  fake.build.mockRejectedValueOnce(failure);
  const suite = createMedusaDOTestSuite(new URL("file:///worker.ts"));
  const attempts = await Promise.allSettled([suite.createScenario(options()), suite.createScenario(options())]);
  expect(attempts).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
  expect(fake.build).toHaveBeenCalledTimes(1);
  expect(fake.secret).not.toHaveBeenCalled();
  const recovered = await suite.createScenario(options());
  expect(fake.build).toHaveBeenCalledTimes(2);
  expect(recovered.isRunning()).toBe(false);
});

it("returns raw HTTP responses and supports explicit missing, invalid and overridden credentials", async () => {
  const scenario = await createMedusaDOTestSuite(new URL("file:///worker.ts")).createScenario({ ...options(), headers: {
    ...options().headers, Authorization: "Bearer inherited", "Content-Type": "text/plain",
  } });
  scenario.start();
  const runtime = runtimeAt(0);
  const response = new Response('{"native":true}', { status: 400, headers: { "access-control-allow-origin": "https://store.test" } });
  runtime.dispatchFetch.mockResolvedValueOnce(response);
  const controller = new AbortController();
  expect(await scenario.request("/store/products", { method: "POST", body: { title: "Fixture" }, signal: controller.signal })).toBe(response);
  expect(response.status).toBe(400);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://store.test");
  expect(await response.json()).toEqual({ native: true });
  const [url, init] = runtime.dispatchFetch.mock.calls[0] ?? [];
  expect(url).toBe("https://native.test/store/products");
  expect(init).toMatchObject({ method: "POST", body: '{"title":"Fixture"}', signal: controller.signal });
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-fixture");
  expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  await scenario.request("/store/products", { private: false,
    headers: { origin: undefined, "x-publishable-api-key": undefined, "content-type": undefined } });
  const denied = new Headers(runtime.dispatchFetch.mock.calls[1]?.[1]?.headers);
  expect([...denied]).toEqual([]);
  await scenario.request("/store/products", { headers: { authorization: "Bearer invalid", "x-publishable-api-key": "pk_invalid" } });
  expect(new Headers(runtime.dispatchFetch.mock.calls[2]?.[1]?.headers).get("x-publishable-api-key")).toBe("pk_invalid");
  expect(new Headers(runtime.dispatchFetch.mock.calls[2]?.[1]?.headers).get("authorization")).toBe("Bearer invalid");
  await scenario.stop();
});

it("keeps lease observations around private close and disposal, shares drain and blocks overlap", async () => {
  const order: string[] = [];
  let finishDisposal: (() => void) | undefined;
  let reentrantStop: Promise<void> | undefined;
  const scenario = await createMedusaDOTestSuite(new URL("file:///worker.ts")).createScenario({ ...options(), closeHooks: {
    beforeClose: async () => { order.push("before"); reentrantStop = scenario.stop(); }, afterClose: async () => { order.push("closed"); },
    afterDispose: async () => { order.push("disposed"); },
  } });
  scenario.start();
  runtimeAt(0).dispatchFetch.mockImplementation(async url => { order.push(url); return new Response("{}"); });
  runtimeAt(0).dispose.mockImplementation(() => new Promise(resolve => { finishDisposal = resolve; }));
  const stopping = scenario.stop();
  expect(scenario.stop()).toBe(stopping);
  expect(scenario.isRunning()).toBe(true);
  expect(() => scenario.start()).toThrow("has not drained");
  expect(() => scenario.request("/store/products")).toThrow("stopped or draining");
  await vi.waitFor(() => { expect(finishDisposal).toBeDefined(); });
  expect(reentrantStop).toBe(stopping);
  expect(order).toEqual(["before", "https://native.test/__proof/close", "closed"]);
  expect(runtimeAt(0).dispatchFetch.mock.calls[0]?.[1]?.headers).toEqual({ authorization: "Bearer private-fixture" });
  if (finishDisposal === undefined) throw new Error("Disposal was not started");
  finishDisposal(); await stopping;
  expect(order.at(-1)).toBe("disposed");
  expect(scenario.isRunning()).toBe(false);
  await scenario.stop();
  expect(runtimeAt(0).dispose).toHaveBeenCalledTimes(1);
});

it("attempts all cleanup after diagnostic and close failures and quarantines uncertain disposal", async () => {
  const before = new Error("lease observation failed"), dispose = new Error("dispose failed"), after = new Error("later observation failed");
  const afterClose = vi.fn(async () => {}), afterDispose = vi.fn(async () => { throw after; });
  const scenario = await createMedusaDOTestSuite(new URL("file:///worker.ts")).createScenario({ ...options(), closeHooks: {
    beforeClose: async () => { throw before; }, afterClose, afterDispose,
  } });
  scenario.start();
  runtimeAt(0).dispatchFetch.mockResolvedValue(new Response("private close refused", { status: 500 }));
  runtimeAt(0).dispose.mockRejectedValue(dispose);
  const stopping = scenario.stop();
  await expect(stopping).rejects.toMatchObject({ errors: [before, new Error("private close refused"), dispose, after] });
  expect(scenario.stop()).toBe(stopping);
  await expect(scenario.stop()).rejects.toMatchObject({ errors: [before, new Error("private close refused"), dispose, after] });
  expect(afterClose).not.toHaveBeenCalled();
  expect(afterDispose).toHaveBeenCalledTimes(1);
  expect(scenario.isRunning()).toBe(true);
  expect(() => scenario.start()).toThrow("has not drained");
  expect(() => scenario.request("/store/products")).toThrow("stopped or draining");
});
