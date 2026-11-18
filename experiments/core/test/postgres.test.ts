import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { expect, it, vi } from "vitest";
import { postgresControl, startPostgres } from "./postgres.ts";

const disposal = vi.hoisted((): { armed: boolean; root: string | undefined; stopped: boolean; removed: boolean; initiating: Error } =>
  ({ armed: false, root: undefined, stopped: false, removed: false, initiating: new Error("controller-output-disposal-witness") }));

vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args); const path = args[0];
      if (typeof path !== "string" || !path.endsWith("pg_ctl.log")) return handle;
      const fail = disposal.armed;
      if (fail) { disposal.armed = false; disposal.root = dirname(path); }
      if (disposal.root !== dirname(path)) return handle;
      const dispose = handle[Symbol.asyncDispose].bind(handle);
      vi.spyOn(handle, Symbol.asyncDispose).mockImplementationOnce(async () => {
        await dispose();
        if (fail) throw disposal.initiating;
        // Test containment only: refuse directory deletion if a regression
        // skips stopping the real daemon launched by this witness.
        disposal.stopped = (await actual.readFile(join(dirname(path), "server.log"), "utf8"))
          .includes("LOG:  database system is shut down");
      });
      return handle;
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (args[0] === disposal.root && !disposal.stopped) throw new Error("Fixture guard refuses deleting a live daemon directory");
      await actual.rm(...args);
      if (args[0] === disposal.root) disposal.removed = true;
    },
  };
});

const withDirectory = async (work: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), "flarex-pg-control-test-"));
  try { await work(root); }
  finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.startsWith(join(tmpdir(), "flarex-pg-control-test-")))
      throw new Error("Unexpected owned controller-test path");
    await rm(root, { recursive: true, force: true });
  }
};

it("retains a real controller's nonzero exit and file-backed diagnostic output", async () => withDirectory(async root => {
  await expect(postgresControl(root, ["-D", root, "status"])).rejects.toMatchObject({
    message: expect.stringMatching(/PostgreSQL control failed[\s\S]*pg_ctl/),
    cause: expect.objectContaining({ message: expect.stringMatching(/pg_ctl exited: code=[1-9]/) }),
  });
  expect(await readFile(join(root, "pg_ctl.log"), "utf8")).toContain("pg_ctl");
}));

it.skipIf(process.platform !== "win32")("preserves a real process-acquisition failure", async () => withDirectory(async root => {
  vi.stubEnv("FLAREX_EXPERIMENT_POSTGRES_BIN", root);
  try {
    await expect(postgresControl(root, ["status"])).rejects.toMatchObject({
      message: "PostgreSQL control failed\n", cause: expect.objectContaining({ code: "ENOENT" }),
    });
  } finally { vi.unstubAllEnvs(); }
}));

it("stops a real daemon when output disposal rejects after its controller exits successfully", async () => {
  disposal.armed = true;
  await using cleanup = { [Symbol.asyncDispose]: async () => {
    disposal.armed = false;
    if (disposal.root !== undefined && !disposal.removed) {
      if (!resolve(disposal.root).startsWith(resolve(tmpdir()) + sep) || !disposal.root.startsWith(join(tmpdir(), "flarex-core-pg-")))
        throw new Error("Unexpected owned startup-witness path");
      await postgresControl(disposal.root, ["-D", disposal.root, "-m", "fast", "-w", "stop"]);
      await rm(disposal.root, { recursive: true, force: true });
    }
  } };
  await expect(startPostgres(true)).rejects.toBe(disposal.initiating);
  expect(disposal.stopped).toBe(true);
  expect(disposal.removed).toBe(true);
  if (disposal.root === undefined) throw new Error("Missing real startup witness");
  await expect(stat(disposal.root)).rejects.toMatchObject({ code: "ENOENT" });
});
