import { execFile, spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = (name: string) => process.platform === "win32"
  ? join(process.env.FLAREX_EXPERIMENT_POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin", `${name}.exe`)
  : name;

/** Node subprocess boundary, including its output-file lifetime. */
export async function postgresControl(root: string, args: string[]) {
  // On Windows pg_ctl's daemon inherits pipe handles after the controller
  // exits. execFile then waits for its 60s timer to close those unused pipes.
  // File-backed output preserves diagnostics without waiting on the daemon.
  const log = join(root, "pg_ctl.log");
  await using output = await open(log, "a");
  try {
    await new Promise<void>((done, reject) => {
      const child = spawn(binary("pg_ctl"), args, { windowsHide: true, timeout: 60_000,
        stdio: ["ignore", output.fd, output.fd] });
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`pg_ctl exited: code=${code}, signal=${signal}`)));
    });
  } catch (cause) {
    let evidence: string;
    try { evidence = await readFile(log, "utf8"); }
    catch (diagnostic) { throw new AggregateError([cause, diagnostic], "PostgreSQL control and diagnostic read failed", { cause }); }
    throw new Error(`PostgreSQL control failed\n${evidence}`, { cause });
  }
}

/** Own a separate cluster; no existing service/database is stopped or reset. */
export async function startPostgres(durationLogging = false) {
  const root = await mkdtemp(join(tmpdir(), "flarex-core-pg-"));
  const control = (args: string[]) => postgresControl(root, args);
  let stopRequired = false;
  const close = async () => {
    // Controller failure, including output disposal, does not prove that its
    // daemon never started. A failed stop preserves the directory and evidence.
    if (stopRequired) { await control(["-D", root, "-m", "fast", "-w", "stop"]); stopRequired = false; }
    if (!resolve(root).startsWith(resolve(tmpdir()) + "/") && process.platform !== "win32") throw new Error("Unexpected owned cluster path");
    if (!root.startsWith(join(tmpdir(), "flarex-core-pg-"))) throw new Error("Unexpected owned cluster path");
    await rm(root, { recursive: true, force: true });
  };
  try {
    const server = createServer();
    await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing temporary PostgreSQL port");
    const port = address.port;
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await exec(binary("initdb"), ["-D", root, "-U", "exp_owner", "--auth=trust", "--no-locale", "-E", "UTF8"], { windowsHide: true, timeout: 60_000 });
    if (durationLogging) await writeFile(join(root, "postgresql.auto.conf"),
      "log_duration = on\nlog_line_prefix = 'fx_duration|%p|%l|'\nlc_messages = 'C'\n");
    await writeFile(join(root, "experiment-owner.json"), JSON.stringify({ root, port, purpose: "experimental core validation" }));
    stopRequired = true;
    await control(["-D", root, "-l", join(root, "server.log"), "-o", `-p ${port} -h 127.0.0.1`, "-w", "start"]);
    const durationMark = async () => {
      if (!durationLogging) throw new Error("Server duration logging is disabled");
      return (await readFile(join(root, "server.log"))).byteLength;
    };
    const durationWindow = async (offset: number) => {
      if (!durationLogging) throw new Error("Server duration logging is disabled");
      return (await readFile(join(root, "server.log"))).subarray(offset).toString("utf8");
    };
    return { connectionString: `postgres://exp_owner@127.0.0.1:${port}/postgres`, close, durationMark, durationWindow };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], `PostgreSQL acquisition and cleanup failed; retained ${root}`, { cause }); }
    throw cause;
  }
}
