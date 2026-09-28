import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Profiler } from "node:inspector";
import { Session } from "node:inspector/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type CpuProfileInput = Readonly<{
  id: string;
  workload: "mixedWorkflow" | "standaloneWorkflow";
  temperature: "warm" | "warmup" | "cold";
  root: string;
  outputDirectory: string;
  revision: string;
  workingDiffSha256: string;
  sourceHashes: Readonly<Record<string, string>>;
}>;

type SecondaryFailure = Readonly<{ stage: "setup" | "recordWall" | "stop" | "write" | "disconnect" | "capture";
  cause: unknown }>;

function secondaryName(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "NonErrorFailure";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(name) ? name : "UnclassifiedFailure";
}

export class MixedMutationCpuDiagnosticFailure extends AggregateError {
  readonly primaryFailure: unknown;
  readonly hasPrimaryFailure: boolean;
  readonly secondaryFailures: readonly Readonly<{ stage: SecondaryFailure["stage"]; name: string }>[];

  constructor(primaryFailure: unknown, hasPrimaryFailure: boolean,
    secondary: readonly SecondaryFailure[]) {
    super([...(hasPrimaryFailure ? [primaryFailure] : []), ...secondary.map(item => item.cause)],
      "Request and CPU diagnostic failures");
    this.primaryFailure = primaryFailure;
    this.hasPrimaryFailure = hasPrimaryFailure;
    this.secondaryFailures = secondary.map(item => ({ stage: item.stage,
      name: secondaryName(item.cause) }));
  }
}

function sanitizeUrl(url: string, root: string): string {
  if (url === "" || url.startsWith("node:")) return url;
  let filename: string;
  try { filename = url.startsWith("file:") ? fileURLToPath(url) : url; }
  catch { return "[external]"; }
  if (!isAbsolute(filename)) return "[generated]";
  const local = relative(root, filename).replaceAll("\\", "/");
  return local === "" ? "." : local !== ".." && !local.startsWith("../") && !isAbsolute(local)
    ? `./${local}` : "[external]";
}

/** A Node-host-only diagnostic. Its setup, stop and file writes are outside the recorded request wall. */
export async function captureMixedMutationCpuProfile<A>(input: CpuProfileInput,
  invoke: () => Promise<A>, recordWall: (wallMs: number) => void): Promise<A> {
  if (!/^[A-Za-z0-9-]+$/.test(input.id)) throw new Error("Invalid CPU profile sample ID");
  const session = new Session();
  let connected = false;
  let completion: Readonly<{ kind: "ok"; value: A }> | Readonly<{ kind: "failed"; failure: unknown }> | undefined;
  const secondary: SecondaryFailure[] = [];
  let invocationWallMs: number | null = null;
  try {
    session.connect();
    connected = true;
    await session.post("Profiler.enable");
    await session.post("Profiler.start");
    const started = performance.now();
    try { completion = { kind: "ok", value: await invoke() }; }
    catch (cause) { completion = { kind: "failed", failure: cause }; }
    invocationWallMs = performance.now() - started;
    try { recordWall(invocationWallMs); }
    catch (cause) { secondary.push({ stage: "recordWall", cause }); }

    let profile: Profiler.Profile | undefined;
    let stopFailed = false;
    try { profile = (await session.post("Profiler.stop")).profile; }
    catch (cause) { stopFailed = true; secondary.push({ stage: "stop", cause }); }
    if (profile === undefined && !stopFailed)
      secondary.push({ stage: "stop", cause: new Error("CPU profiler returned no profile") });
    if (profile !== undefined) {
      try {
        const sanitized = { ...profile, nodes: profile.nodes.map(node => ({ ...node,
          callFrame: { ...node.callFrame, url: sanitizeUrl(node.callFrame.url, input.root) } })) };
        const data = Buffer.from(JSON.stringify(sanitized) + "\n");
        const directory = join(input.outputDirectory, "cpu");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${input.id}.cpuprofile`), data);
        await writeFile(join(directory, `${input.id}.json`), JSON.stringify({
          format: "flarex.mixed-mutation-node-cpu-diagnostic",
          id: input.id, workload: input.workload, temperature: input.temperature,
          revision: input.revision, workingDiffSha256: input.workingDiffSha256,
          sourceHashes: input.sourceHashes,
          profileSha256: createHash("sha256").update(data).digest("hex"),
          invocationWallMs,
          nodeHostOnly: true, observerOverhead: "included; not a latency acceptance sample",
          profileWindow: "includes Node Inspector start/stop sampling overhead outside invocation wall",
          missing: ["separate Workerd CPU", "allocation accounting", "async wait stacks"],
        }, null, 2) + "\n");
      } catch (cause) { secondary.push({ stage: "write", cause }); }
    }
  } catch (cause) {
    if (completion === undefined) secondary.push({ stage: "setup", cause });
    else secondary.push({ stage: "capture", cause });
  } finally {
    if (connected) {
      try { session.disconnect(); }
      catch (cause) { secondary.push({ stage: "disconnect", cause }); }
    }
  }
  if (completion === undefined) throw new MixedMutationCpuDiagnosticFailure(undefined,
    false, secondary);
  if (completion.kind === "failed") {
    if (secondary.length > 0) throw new MixedMutationCpuDiagnosticFailure(completion.failure,
      true, secondary);
    throw completion.failure;
  }
  if (secondary.length > 0) throw new MixedMutationCpuDiagnosticFailure(undefined,
    false, secondary);
  return completion.value;
}
