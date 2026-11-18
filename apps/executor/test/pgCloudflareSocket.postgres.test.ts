import { spawn, type ChildProcess } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { build, defaultClientConditions, type Plugin } from "vite";
import { expect, it } from "vitest";

import { PostgresTlsObservation } from "./support/pgCloudflarePostgresProtocol";

const databaseUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;
const caFile = process.env.FLAREX_POSTGRES_TLS_CA_FILE;
const decodeObservation = Schema.decodeUnknownSync(Schema.fromJsonString(PostgresTlsObservation));
const decodeRuntime = Schema.decodeUnknownSync(Schema.Struct({
  default: Schema.NonEmptyString, version: Schema.Literal("1.20260929.1"),
}));
const decodeListening = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
  event: Schema.Literal("listen"), socket: Schema.Literals(["trusted-http", "untrusted-http"]),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
})));

it.skipIf(!databaseUrl || !caFile)("negotiates PostgreSQL STARTTLS in pinned workerd and rejects an untrusted CA", async () => {
  if (databaseUrl === undefined || caFile === undefined) throw new Error("PostgreSQL STARTTLS fixture inputs are required.");
  const endpoint = new URL(databaseUrl);
  if (endpoint.hostname !== "127.0.0.1") throw new Error("This bounded STARTTLS witness requires an owned IPv4 loopback PostgreSQL endpoint.");
  const ca = await readFile(caFile, "utf8");
  const directory = await mkdtemp(join(tmpdir(), "flarex-pg-starttls-"));
  const applicationName = `flarex-starttls-${crypto.randomUUID()}`;
  let child: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  let primary: Readonly<{ cause: unknown }> | undefined;
  const processFailures: unknown[] = [];
  let stdout = "";
  let stderr = "";
  try {
    const fromExecutor = createRequire(import.meta.url);
    const fromMiniflare = createRequire(fromExecutor.resolve("miniflare"));
    const selectedRuntime: unknown = fromMiniflare("workerd");
    const runtime = decodeRuntime(selectedRuntime);
    await writeFile(join(directory, "worker.js"), await bundleWorker());
    await writeFile(join(directory, "ca.pem"), ca);
    await writeFile(join(directory, "config.capnp"), configuration(databaseUrl, applicationName));
    child = spawn(runtime.default, ["serve", join(directory, "config.capnp"), "config", "--experimental", "--control-fd=3"], {
      stdio: ["ignore", "pipe", "pipe", "pipe"], windowsHide: true,
    });
    const active = child;
    childClosed = new Promise(resolveClosed => { active.once("close", () => { resolveClosed(); }); });
    active.on("error", cause => { processFailures.push(cause); });
    active.stdout?.setEncoding("utf8").on("data", (text: string) => { stdout += text; });
    active.stderr?.setEncoding("utf8").on("data", (text: string) => { stderr += text; });
    const control = active.stdio[3];
    if (!(control instanceof Readable)) throw new Error("Missing owned workerd control pipe.");
    const ports = await waitForListeners(active, control);
    const request = async (name: "trusted-http" | "untrusted-http") => {
      const port = ports.get(name);
      if (port === undefined) throw new Error("Missing owned STARTTLS listener.");
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(10_000) });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return decodeObservation(text);
    };
    const assertTrusted = (observation: ReturnType<typeof decodeObservation>) => {
      expect(observation.cause).toBeNull();
      expect(observation).toMatchObject({ ok: true, actualDriver: true, sslResponses: 1, sslConnectEvents: 1,
        queriesStarted: 1, endCalls: 1, nativeEndFulfilled: true, streamCloses: 1,
        clientEnds: 1, clientErrors: [], errorsAfterEnd: 0, errorListenersAfterEnd: 0 });
      expect(observation.row).toMatchObject({ value: 1, ssl: true, superuser: false, bypass: false,
        applicationName: `${applicationName}-trusted` });
    };
    assertTrusted(await request("trusted-http"));
    const untrusted = await request("untrusted-http");
    expect(untrusted).toMatchObject({ ok: false, actualDriver: true, sslResponses: 1, sslConnectEvents: 1,
      row: null, queriesStarted: 0, endCalls: 1, nativeEndFulfilled: true,
      streamCloses: 1, clientEnds: 1, errorsAfterEnd: 0, errorListenersAfterEnd: 0 });
    // Pinned workerd jsg/util.c++ projects disconnected TLS failures to an
    // opaque network error. Keep the full Cause without inventing a reason.
    expect(untrusted.cause).not.toBeNull();
    expect(untrusted.cause?.trim().length ?? 0).toBeGreaterThan(0);
    // The same server and trusted path remain healthy after the empty-CA case.
    assertTrusted(await request("trusted-http"));
    expect(active.exitCode).toBeNull();
    expect(active.signalCode).toBeNull();
  } catch (cause) {
    primary = { cause };
    throw cause;
  } finally {
    const cleanupFailures: unknown[] = [];
    if (child !== undefined) {
      if (child.exitCode === null && child.signalCode === null && !child.kill("SIGKILL")) {
        cleanupFailures.push(new Error("Could not stop owned STARTTLS workerd process."));
      }
      if (childClosed !== undefined) await childClosed;
    }
    // mkdtemp's exact owned child is the only recursively removed directory.
    const resolved = resolve(directory);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith("flarex-pg-starttls-")) {
      cleanupFailures.push(new Error("Refusing cleanup outside the owned STARTTLS temporary directory."));
    } else {
      try { await rm(resolved, { recursive: true, force: true }); }
      catch (cause) { cleanupFailures.push(cause); }
    }
    const failures = [...processFailures, ...cleanupFailures];
    if (primary !== undefined || failures.length !== 0) throw new AggregateError(
      [...(primary === undefined ? [] : [primary.cause]), ...failures],
      `PostgreSQL STARTTLS witness failed. Owned runtime stdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}, 30_000);

function configuration(url: string, applicationName: string): string {
  const worker = (name: string, outbound: string) => `(name=${JSON.stringify(name)},worker=(
    modules=[(name="worker.js",esModule=embed "worker.js")],compatibilityDate="2026-06-14",
    compatibilityFlags=["nodejs_compat"],globalOutbound=${JSON.stringify(outbound)},
    bindings=[(name="DATABASE_URL",text=${JSON.stringify(url)}),
              (name="APPLICATION_NAME",text=${JSON.stringify(`${applicationName}-${name}`)})]))`;
  return `using Workerd = import "/workerd/workerd.capnp";
    const config :Workerd.Config = (
      services=[${worker("trusted", "trusted-network")},${worker("untrusted", "untrusted-network")},
        (name="trusted-network",network=(allow=["127.0.0.1/32"],
          tlsOptions=(trustBrowserCas=false,trustedCertificates=[embed "ca.pem"]))),
        (name="untrusted-network",network=(allow=["127.0.0.1/32"],
          tlsOptions=(trustBrowserCas=false,trustedCertificates=[])))],
      sockets=[(name="trusted-http",address="127.0.0.1:0",http=(),service="trusted"),
               (name="untrusted-http",address="127.0.0.1:0",http=(),service="untrusted")]);`;
}

async function waitForListeners(child: ChildProcess, control: Readable): Promise<Map<string, number>> {
  const lines = createInterface(control);
  const ports = new Map<string, number>();
  return new Promise((resolvePorts, reject) => {
    const complete = (cause?: unknown) => {
      clearTimeout(deadline);
      lines.close();
      child.off("exit", exited);
      child.off("error", errored);
      if (cause === undefined) resolvePorts(ports); else reject(cause);
    };
    const exited = () => { complete(new Error("Owned workerd exited before STARTTLS listeners were ready.")); };
    const errored = (cause: Error) => { complete(cause); };
    const deadline = setTimeout(() => { complete(new Error("Owned workerd STARTTLS listener startup timed out.")); }, 10_000);
    child.once("exit", exited);
    child.once("error", errored);
    lines.on("line", line => {
      try {
        const message = decodeListening(line);
        ports.set(message.socket, message.port);
        if (ports.size === 2) complete();
      } catch (cause) { complete(cause); }
    });
  });
}

async function bundleWorker(): Promise<string> {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const workspaceResolution: Plugin = { name: "postgres-starttls-workspace-resolution", resolveId(id) {
    if (id.startsWith("@flarex/")) return fileURLToPath(import.meta.resolve(id));
    return undefined;
  } };
  const output = await build({ configFile: false, logLevel: "silent", plugins: [workspaceResolution],
    resolve: { conditions: ["workerd", ...defaultClientConditions] },
    build: { write: false, target: "es2022", lib: {
      entry: fileURLToPath(new URL("./pgCloudflareSocket.postgres.worker.ts", import.meta.url)),
      formats: ["es"], fileName: "worker",
    }, rolldownOptions: {
      external: id => id.startsWith("cloudflare:") || builtins.has(id),
      output: { banner: 'import { createRequire as createRuntimeRequire } from "node:module";\nconst require = createRuntimeRequire("file:///worker.js");' },
    } } });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Missing actual PostgreSQL STARTTLS worker bundle.");
  return worker.code;
}
