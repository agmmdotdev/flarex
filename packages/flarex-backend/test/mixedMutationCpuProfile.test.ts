import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureMixedMutationCpuProfile, MixedMutationCpuDiagnosticFailure } from
  "./support/mixedMutationCpuProfile";

const state = vi.hoisted(() => ({
  events: [] as string[],
  files: new Map<string, string | Uint8Array>(),
  connectFailure: undefined as unknown,
  startFailure: undefined as unknown,
  stopFailure: undefined as unknown,
  disconnectFailure: undefined as unknown,
  failStart: false,
  failConnect: false,
  failStop: false,
  failDisconnect: false,
  profile: undefined as unknown,
}));

vi.mock("node:inspector/promises", () => ({ Session: class {
  connect() {
    state.events.push("connect");
    if (state.failConnect) throw state.connectFailure;
  }
  async post(method: string) {
    state.events.push(method);
    if (method === "Profiler.start" && state.failStart) throw state.startFailure;
    if (method === "Profiler.stop") {
      if (state.failStop) throw state.stopFailure;
      return { profile: state.profile };
    }
    return {};
  }
  disconnect() {
    state.events.push("disconnect");
    if (state.failDisconnect) throw state.disconnectFailure;
  }
} }));

vi.mock("node:fs/promises", () => ({
  mkdir: async () => { state.events.push("mkdir"); },
  writeFile: async (file: string, value: string | Uint8Array) => {
    state.events.push("writeFile");
    state.files.set(file, value);
  },
}));

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const outputDirectory = join(repositoryRoot, "work", "validation", "cpu-unit");
const input = {
  id: "mixedWorkflow-warm-0-1", workload: "mixedWorkflow" as const,
  temperature: "warm" as const, root: repositoryRoot, outputDirectory,
  revision: "revision", workingDiffSha256: "working-diff",
  sourceHashes: { "packages/example.ts": "source-hash" },
};

beforeEach(() => {
  state.events = [];
  state.files.clear();
  state.failStart = false;
  state.failConnect = false;
  state.failStop = false;
  state.failDisconnect = false;
  state.startFailure = undefined;
  state.connectFailure = undefined;
  state.stopFailure = undefined;
  state.disconnectFailure = undefined;
  state.profile = { nodes: [
    { id: 1, callFrame: { functionName: "local", scriptId: "1",
      url: pathToFileURL(join(repositoryRoot, "packages", "example.ts")).href,
      lineNumber: 1, columnNumber: 1 }, hitCount: 1, children: [2] },
    { id: 2, callFrame: { functionName: "external", scriptId: "2",
      url: pathToFileURL(join(repositoryRoot, "..", "private.ts")).href,
      lineNumber: 1, columnNumber: 1 }, hitCount: 1 },
  ], startTime: 1, endTime: 2, samples: [1, 2], timeDeltas: [1, 1] };
});

describe("request-scoped Node CPU diagnostic", () => {
  it("disconnects after profiler startup failure without invoking the request", async () => {
    const failure = new Error("start failed");
    state.failStart = true;
    state.startFailure = failure;
    const invoke = vi.fn(async () => "result");
    const result = await captureMixedMutationCpuProfile(input, invoke,
      () => undefined).catch((cause: unknown) => cause);
    if (!(result instanceof MixedMutationCpuDiagnosticFailure))
      throw new Error("Expected setup diagnostic failure");
    expect(result.hasPrimaryFailure).toBe(false);
    expect(result.secondaryFailures).toEqual([{ stage: "setup", name: "Error" }]);
    expect(result.errors).toEqual([failure]);
    expect(invoke).not.toHaveBeenCalled();
    expect(state.events).toEqual(["connect", "Profiler.enable", "Profiler.start", "disconnect"]);
  });

  it("identifies connect failure as diagnostic setup before invocation", async () => {
    const failure = new Error("connect failed");
    state.failConnect = true;
    state.connectFailure = failure;
    const invoke = vi.fn(async () => "result");
    const result = await captureMixedMutationCpuProfile(input, invoke,
      () => undefined).catch((cause: unknown) => cause);
    if (!(result instanceof MixedMutationCpuDiagnosticFailure))
      throw new Error("Expected setup diagnostic failure");
    expect(result.hasPrimaryFailure).toBe(false);
    expect(result.secondaryFailures).toEqual([{ stage: "setup", name: "Error" }]);
    expect(result.errors).toEqual([failure]);
    expect(invoke).not.toHaveBeenCalled();
    expect(state.events).toEqual(["connect"]);
  });

  it("retains an undefined invocation failure alongside a stop failure", async () => {
    const stopFailure = new Error("stop failed");
    state.failStop = true;
    state.stopFailure = stopFailure;
    const failure = await captureMixedMutationCpuProfile(input,
      async () => { throw undefined; }, () => undefined).catch((cause: unknown) => cause);
    if (!(failure instanceof MixedMutationCpuDiagnosticFailure))
      throw new Error("Expected combined failure");
    expect(failure.errors).toEqual([undefined, stopFailure]);
    expect(failure.hasPrimaryFailure).toBe(true);
    expect(failure.secondaryFailures).toEqual([{ stage: "stop", name: "Error" }]);
    expect(state.events.at(-1)).toBe("disconnect");
  });

  it("retains invocation and disconnect failures together", async () => {
    const invocationFailure = new Error("request failed");
    const disconnectFailure = new Error("disconnect failed");
    state.failDisconnect = true;
    state.disconnectFailure = disconnectFailure;
    const failure = await captureMixedMutationCpuProfile(input,
      async () => { throw invocationFailure; }, () => undefined).catch((cause: unknown) => cause);
    if (!(failure instanceof MixedMutationCpuDiagnosticFailure))
      throw new Error("Expected combined failure");
    expect(failure.errors).toEqual([invocationFailure, disconnectFailure]);
    expect(failure.primaryFailure).toBe(invocationFailure);
    expect(failure.secondaryFailures).toEqual([{ stage: "disconnect", name: "Error" }]);
  });

  it("reports a missing profile even if the wall callback also fails", async () => {
    state.profile = undefined;
    const wallFailure = new Error("wall failed");
    const result = await captureMixedMutationCpuProfile(input, async () => "result",
      () => { throw wallFailure; }).catch((cause: unknown) => cause);
    if (!(result instanceof MixedMutationCpuDiagnosticFailure))
      throw new Error("Expected combined diagnostic failure");
    expect(result.hasPrimaryFailure).toBe(false);
    expect(result.errors[0]).toBe(wallFailure);
    expect(result.secondaryFailures).toEqual([
      { stage: "recordWall", name: "Error" }, { stage: "stop", name: "Error" },
    ]);
    expect(state.events.at(-1)).toBe("disconnect");
  });

  it("writes sanitized native profiles after the measured invocation", async () => {
    let wallMs: number | null = null;
    const result = await captureMixedMutationCpuProfile(input, async () => {
      state.events.push("invoke");
      return "result";
    }, elapsed => {
      expect(state.events).not.toContain("writeFile");
      wallMs = elapsed;
      state.events.push("recordWall");
    });
    expect(result).toBe("result");
    expect(wallMs).toBeGreaterThanOrEqual(0);
    expect(state.events.indexOf("recordWall")).toBeLessThan(state.events.indexOf("writeFile"));
    const profile = JSON.parse(String(state.files.get(join(outputDirectory, "cpu",
      `${input.id}.cpuprofile`))));
    expect(profile.nodes[0].callFrame.url).toBe("./packages/example.ts");
    expect(profile.nodes[1].callFrame.url).toBe("[external]");
    const sidecar = JSON.parse(String(state.files.get(join(outputDirectory, "cpu", `${input.id}.json`))));
    expect(sidecar).toMatchObject({ id: input.id, workload: "mixedWorkflow",
      sourceHashes: input.sourceHashes, nodeHostOnly: true });
    expect(sidecar.invocationWallMs).toBe(wallMs);
    expect(sidecar.profileWindow).toContain("Inspector start/stop");
    expect(sidecar.profileSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
