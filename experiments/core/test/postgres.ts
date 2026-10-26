import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = (name: string) => process.platform === "win32"
  ? join(process.env.FLAREX_EXPERIMENT_POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin", `${name}.exe`)
  : name;

/** Own a separate cluster; no existing service/database is stopped or reset. */
export async function startPostgres() {
  const root = await mkdtemp(join(tmpdir(), "flarex-core-pg-"));
  const command = (name: string, args: string[]) => exec(binary(name), args, { windowsHide: true, timeout: 60_000 });
  let started = false;
  const close = async () => {
    if (started) { await command("pg_ctl", ["-D", root, "-m", "fast", "-w", "stop"]); started = false; }
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
    await command("initdb", ["-D", root, "-U", "exp_owner", "--auth=trust", "--no-locale", "-E", "UTF8"]);
    await writeFile(join(root, "experiment-owner.json"), JSON.stringify({ root, port, purpose: "experimental core validation" }));
    await command("pg_ctl", ["-D", root, "-l", join(root, "server.log"), "-o", `-p ${port} -h 127.0.0.1`, "-w", "start"]);
    started = true;
    return { connectionString: `postgres://exp_owner@127.0.0.1:${port}/postgres`, close };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "PostgreSQL acquisition and cleanup failed", { cause }); }
    throw cause;
  }
}
