import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { FlarexGeneratedOutputTypecheckOptions } from "../src/generatedTypecheck";
import { runFlarexDevCli } from "../src/cli";
import type { DeploymentAnalysis } from "../src/analyze";
import type { SourcePackage } from "../src/sourcePackage";
import { createMinimalFlarexProject } from "./fixtures";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

class StringWriter {
  value = "";

  write(chunk: string): void {
    this.value += chunk;
  }
}

describe("runFlarexDevCli", () => {
  it("runs codegen and generated-output typecheck", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-");
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: [
          "codegen",
          "--typecheck",
          "--cwd",
          workspaceRoot,
          "--typescript-cli",
          "node_modules/typescript/bin/tsc",
          "--path",
          "flarex=packages/flarex/src/index.ts",
          "--path",
          "flarex/*=packages/flarex/src/*",
        ],
      })).resolves.toBe(0);

      await expect(stat(path.join(root, "flarex/_generated/server.ts"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rejects an empty explicit root", async () => {
    const stderr = new StringWriter();

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", ""],
      stderr,
    })).resolves.toBe(1);

    expect(stderr.value).toContain("--root must be a non-empty path");
    expect(stderr.value).toContain("flarex-dev codegen [--root <path>]");
  });

  it("defaults codegen root to the project root", async () => {
    let generateRoot: string | undefined;

    await expect(runFlarexDevCli({
      projectRoot: "/current-project",
      argv: ["codegen"],
      dependencies: {
        generate: async options => {
          generateRoot = options.root;
        },
      },
    })).resolves.toBe(0);

    expect(generateRoot).toBe("/current-project");
  });

  it("ignores a leading package-script argument separator", async () => {
    let generateRoot: string | undefined;

    await expect(runFlarexDevCli({
      projectRoot: "/current-project",
      argv: ["--", "codegen"],
      dependencies: {
        generate: async options => {
          generateRoot = options.root;
        },
      },
    })).resolves.toBe(0);

    expect(generateRoot).toBe("/current-project");
  });

  it("passes app paths and typecheck path mappings to dependencies", async () => {
    const seen: {
      generateRoot: string | undefined;
      appDir: string | undefined;
      generatedDir: string | undefined;
      paths: NonNullable<FlarexGeneratedOutputTypecheckOptions["compilerOptions"]>["paths"] | undefined;
    } = {
      generateRoot: undefined,
      appDir: undefined,
      generatedDir: undefined,
      paths: undefined,
    };

    await expect(runFlarexDevCli({
      argv: [
        "codegen",
        "--root",
        "/app",
        "--app-dir",
        "custom",
        "--generated-dir",
        "gen",
        "--typecheck",
        "--path",
        "flarex=packages/flarex/src/index.ts",
        "--path",
        "flarex=packages/flarex/src/alt.ts",
      ],
      dependencies: {
        generate: async options => {
          seen.generateRoot = options.root;
          seen.appDir = options.appDir;
          seen.generatedDir = options.generatedDir;
        },
        typecheckGenerated: async options => {
          seen.paths = options.compilerOptions?.paths;
        },
      },
    })).resolves.toBe(0);

    expect(seen).toEqual({
      generateRoot: "/app",
      appDir: "custom",
      generatedDir: "gen",
      paths: {
        flarex: ["packages/flarex/src/index.ts", "packages/flarex/src/alt.ts"],
      },
    });
  });

  it("passes HTTP backend analyzer options to codegen", async () => {
    const analysis = cliAnalysis();
    const sourcePackage = cliSourcePackage();
    const requests: Array<{
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });
      return Response.json({
        analysis: { schema: analysis.schema, functions: { functions: [] } },
        codegenAnalysis: analysis,
      });
    });
    try {
      let analyzerResult: DeploymentAnalysis | undefined;
      await expect(runFlarexDevCli({
        argv: [
          "codegen",
          "--root",
          "/app",
          "--analyzer-url",
          "https://flarex.example/analyze",
          "--deployment-id",
          "deployment1",
          "--analyzer-header",
          "authorization=Bearer token",
        ],
        dependencies: {
          generate: async options => {
            analyzerResult = await options.sourceAnalyzer?.analyze(sourcePackage).then(result => result.analysis);
          },
        },
      })).resolves.toBe(0);

      expect(analyzerResult).toEqual(analysis);
      expect(requests).toEqual([{
        url: "https://flarex.example/analyze",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: { deploymentId: "deployment1", sourcePackage },
      }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes HTTP backend push options to codegen", async () => {
    const analysis = cliAnalysis();
    const sourcePackage = cliSourcePackage();
    const requests: Array<{
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });
      return Response.json({
        pushId: "push1",
        state: "analyzed",
        analysis: { schema: analysis.schema, functions: { functions: [] } },
        codegenAnalysis: analysis,
      });
    });
    try {
      let pushAnalysis: DeploymentAnalysis | undefined;
      await expect(runFlarexDevCli({
        argv: [
          "codegen",
          "--root",
          "/app",
          "--backend-url",
          "https://flarex.example",
          "--deployment-id",
          "deployment1",
          "--backend-header",
          "authorization=Bearer token",
        ],
        dependencies: {
          generate: async options => {
            const status = await options.pushCoordinator?.start(sourcePackage);
            pushAnalysis = status?.codegenAnalysis;
          },
        },
      })).resolves.toBe(0);

      expect(pushAnalysis).toEqual(analysis);
      expect(requests).toEqual([{
        url: "https://flarex.example/deployments/deployment1/push/start",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: { sourcePackage },
      }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deploys through backend push, generated typecheck, and finish", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-deploy-");
    const analysis = cliAnalysis();
    const requests: Array<{
      path: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    const events: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body: unknown = init?.body === undefined ? null : JSON.parse(String(init.body));
      requests.push({
        path: url.pathname,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body,
      });
      if (url.pathname === "/api/deployments/deployment1/push/start") {
        events.push("start");
        return Response.json({
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: analysis,
        });
      }
      if (url.pathname === "/api/deployments/deployment1/push/push1/finish") {
        events.push("finish");
        return Response.json({
          pushId: "push1",
          state: "activated",
        });
      }
      return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
    });
    try {
      let typecheckOptions: FlarexGeneratedOutputTypecheckOptions | undefined;
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: [
          "deploy",
          "--backend-url",
          "https://flarex.example/api",
          "--deployment-id",
          "deployment1",
          "--backend-header",
          "authorization=Bearer token",
          "--typecheck",
          "enable",
        ],
        dependencies: {
          typecheckGenerated: async options => {
            events.push("typecheck");
            typecheckOptions = options;
          },
        },
      })).resolves.toBe(0);

      expect(events).toEqual(["start", "typecheck", "finish"]);
      expect(typecheckOptions).toEqual({ root });
      expect(requests).toEqual([
        {
          path: "/api/deployments/deployment1/push/start",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: expect.objectContaining({ sourcePackage: expect.any(Object) }),
        },
        {
          path: "/api/deployments/deployment1/push/push1/finish",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: {},
        },
      ]);
      await expect(stat(path.join(root, "flarex/_generated/functionMetadata.ts")))
        .resolves.toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("does not finish deploy pushes when generated-output typecheck fails", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-deploy-fail-");
    const stderr = new StringWriter();
    const analysis = cliAnalysis();
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/push/start")) {
        return Response.json({
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: analysis,
        });
      }
      if (url.pathname.endsWith("/push/push1/abandon")) {
        return Response.json({
          pushId: "push1",
          state: "abandoned",
          error: "Generated output validation failed before activation: tsc failed",
        });
      }
      return Response.json({
        pushId: "push1",
        state: "activated",
      });
    });
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: [
          "deploy",
          "--backend-url",
          "https://flarex.example",
          "--deployment-id",
          "deployment1",
          "--typecheck",
          "enable",
        ],
        stderr,
        dependencies: {
          typecheckGenerated: async () => {
            throw new Error("tsc failed");
          },
        },
      })).resolves.toBe(1);

      expect(stderr.value).toContain("tsc failed");
      expect(paths).toEqual([
        "/deployments/deployment1/push/start",
        "/deployments/deployment1/push/push1/abandon",
      ]);
    } finally {
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("finishes deploy pushes when generated-output typecheck fails in try mode", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-deploy-try-");
    const stderr = new StringWriter();
    const analysis = cliAnalysis();
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/push/start")) {
        return Response.json({
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: analysis,
        });
      }
      return Response.json({
        pushId: "push1",
        state: "activated",
      });
    });
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: [
          "deploy",
          "--backend-url",
          "https://flarex.example",
          "--deployment-id",
          "deployment1",
          "--typecheck",
          "try",
        ],
        stderr,
        dependencies: {
          typecheckGenerated: async () => {
            throw new Error("tsc failed");
          },
        },
      })).resolves.toBe(0);

      expect(stderr.value).toContain("--typecheck try");
      expect(stderr.value).toContain("tsc failed");
      expect(paths).toEqual([
        "/deployments/deployment1/push/start",
        "/deployments/deployment1/push/push1/finish",
      ]);
    } finally {
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("prints backend finish diagnostics for failed deploy activation", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-deploy-finish-fail-");
    const stderr = new StringWriter();
    const analysis = cliAnalysis();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/push/start")) {
        return Response.json({
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: analysis,
        });
      }
      if (url.pathname.endsWith("/push/push1/finish")) {
        return Response.json(
          {
            result: "rejected",
            push: {
              pushId: "push1",
              state: "failed",
              error: "activation failed",
            },
            code: "invalid_state",
            error: "activation failed",
            diagnostics: [{ level: "error", message: "schema rejected" }],
          },
          { status: 409 },
        );
      }
      return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
    });
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: [
          "deploy",
          "--backend-url",
          "https://flarex.example",
          "--deployment-id",
          "deployment1",
        ],
        stderr,
      })).resolves.toBe(1);

      expect(stderr.value).toContain("Flarex push push1 did not activate: failed.");
      expect(stderr.value).toContain("Backend error: activation failed");
      expect(stderr.value).toContain("Backend diagnostic (error): schema rejected");
    } finally {
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rejects deploy without backend push options before codegen", async () => {
    const stderr = new StringWriter();
    let deployCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["deploy", "--root", "/app"],
      stderr,
      dependencies: {
        deploy: async options => {
          deployCalls += 1;
          return {
            started: {
              pushId: "push1",
              state: "analyzed",
              codegenAnalysis: cliAnalysis(),
            },
            finished: { pushId: "push1", state: "activated" },
          };
        },
      },
    })).resolves.toBe(1);

    expect(deployCalls).toBe(0);
    expect(stderr.value).toContain("--backend-url must be provided when deploying.");
  });

  it("keeps HTTP backend analyzer options out of generated-output typecheck", async () => {
    const analysis = cliAnalysis();
    const sourcePackage = cliSourcePackage();
    vi.stubGlobal("fetch", async () =>
      Response.json({
        analysis: { schema: analysis.schema, functions: { functions: [] } },
        codegenAnalysis: analysis,
      }));
    try {
      let analyzerResult: DeploymentAnalysis | undefined;
      let typecheckOptions: FlarexGeneratedOutputTypecheckOptions | undefined;
      await expect(runFlarexDevCli({
        argv: [
          "codegen",
          "--root",
          "/app",
          "--typecheck",
          "enable",
          "--analyzer-url",
          "https://flarex.example/analyze",
          "--deployment-id",
          "deployment1",
        ],
        dependencies: {
          generate: async options => {
            analyzerResult = await options.sourceAnalyzer?.analyze(sourcePackage).then(result => result.analysis);
          },
          typecheckGenerated: async options => {
            typecheckOptions = options;
          },
        },
      })).resolves.toBe(0);

      expect(analyzerResult).toEqual(analysis);
      expect(typecheckOptions).toEqual({ root: "/app" });
      expect(typecheckOptions).not.toHaveProperty("sourceAnalyzer");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps HTTP backend push options out of generated-output typecheck", async () => {
    const analysis = cliAnalysis();
    const sourcePackage = cliSourcePackage();
    vi.stubGlobal("fetch", async () =>
      Response.json({
        pushId: "push1",
        state: "analyzed",
        codegenAnalysis: analysis,
      }));
    try {
      let pushAnalysis: DeploymentAnalysis | undefined;
      let typecheckOptions: FlarexGeneratedOutputTypecheckOptions | undefined;
      await expect(runFlarexDevCli({
        argv: [
          "codegen",
          "--root",
          "/app",
          "--typecheck",
          "enable",
          "--backend-url",
          "https://flarex.example",
          "--deployment-id",
          "deployment1",
        ],
        dependencies: {
          generate: async options => {
            const status = await options.pushCoordinator?.start(sourcePackage);
            pushAnalysis = status?.codegenAnalysis;
          },
          typecheckGenerated: async options => {
            typecheckOptions = options;
          },
        },
      })).resolves.toBe(0);

      expect(pushAnalysis).toEqual(analysis);
      expect(typecheckOptions).toEqual({ root: "/app" });
      expect(typecheckOptions).not.toHaveProperty("pushCoordinator");
      expect(typecheckOptions).not.toHaveProperty("sourceAnalyzer");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes HTTP backend analyzer options to dry-run codegen", async () => {
    const analysis = cliAnalysis();
    const sourcePackage = cliSourcePackage();
    vi.stubGlobal("fetch", async () =>
      Response.json({
        analysis: { schema: analysis.schema, functions: { functions: [] } },
        codegenAnalysis: analysis,
      }));
    try {
      let analyzerResult: DeploymentAnalysis | undefined;
      await expect(runFlarexDevCli({
        argv: [
          "codegen",
          "--root",
          "/app",
          "--dry-run",
          "--analyzer-url",
          "https://flarex.example/analyze",
          "--deployment-id",
          "deployment1",
        ],
        dependencies: {
          dryRun: async options => {
            analyzerResult = await options.sourceAnalyzer?.analyze(sourcePackage).then(result => result.analysis);
            return { writes: [], deletes: [] };
          },
        },
      })).resolves.toBe(0);

      expect(analyzerResult).toEqual(analysis);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes HTTP backend push options to dry-run codegen", async () => {
    const analysis = cliAnalysis();
    const sourcePackage = cliSourcePackage();
    vi.stubGlobal("fetch", async () =>
      Response.json({
        pushId: "push1",
        state: "analyzed",
        codegenAnalysis: analysis,
      }));
    try {
      let pushAnalysis: DeploymentAnalysis | undefined;
      await expect(runFlarexDevCli({
        argv: [
          "codegen",
          "--root",
          "/app",
          "--dry-run",
          "--backend-url",
          "https://flarex.example",
          "--deployment-id",
          "deployment1",
        ],
        dependencies: {
          dryRun: async options => {
            const status = await options.pushCoordinator?.start(sourcePackage);
            pushAnalysis = status?.codegenAnalysis;
            return { writes: [], deletes: [] };
          },
        },
      })).resolves.toBe(0);

      expect(pushAnalysis).toEqual(analysis);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects mixed HTTP backend analyzer URL and push options before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: [
        "codegen",
        "--root",
        "/app",
        "--analyzer-url",
        "https://flarex.example/analyze",
        "--backend-url",
        "https://flarex.example",
        "--deployment-id",
        "deployment1",
      ],
      stderr,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain("Backend push options cannot be used with analyzer-only options.");
  });

  it("rejects mixed HTTP backend push options and analyzer headers before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: [
        "codegen",
        "--root",
        "/app",
        "--backend-url",
        "https://flarex.example",
        "--deployment-id",
        "deployment1",
        "--analyzer-header",
        "authorization=Bearer token",
      ],
      stderr,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain("Backend push options cannot be used with analyzer-only options.");
  });

  it("rejects incomplete HTTP backend push options before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--backend-url", "https://flarex.example"],
      stderr,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain("--deployment-id must be provided");
  });

  it("rejects malformed HTTP backend push headers before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: [
        "codegen",
        "--root",
        "/app",
        "--backend-url",
        "https://flarex.example",
        "--deployment-id",
        "deployment1",
        "--backend-header",
        "authorization",
      ],
      stderr,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --backend-header value "authorization"');
  });

  it("rejects incomplete HTTP backend analyzer options before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--analyzer-url", "https://flarex.example/analyze"],
      stderr,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain("--deployment-id must be provided");
  });

  it("rejects malformed HTTP backend analyzer headers before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: [
        "codegen",
        "--root",
        "/app",
        "--analyzer-url",
        "https://flarex.example/analyze",
        "--deployment-id",
        "deployment1",
        "--analyzer-header",
        "authorization",
      ],
      stderr,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --analyzer-header value "authorization"');
  });

  it("prints dry-run writes and deletes without normal codegen or typecheck", async () => {
    const stdout = new StringWriter();
    let generateCalls = 0;
    let typecheckCalls = 0;
    let dryRunRoot: string | undefined;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--dry-run", "--typecheck", "enable"],
      stdout,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
        dryRun: async options => {
          dryRunRoot = options.root;
          return {
            writes: [{
              name: "server.ts",
              path: "/app/flarex/_generated/server.ts",
              contents: "server",
            }],
            deletes: [{
              name: "old.ts",
              path: "/app/flarex/_generated/old.ts",
              kind: "file",
            }, {
              name: "oldDir",
              path: "/app/flarex/_generated/oldDir",
              kind: "directory",
            }],
          };
        },
        typecheckGenerated: async () => {
          typecheckCalls += 1;
        },
      },
    })).resolves.toBe(0);

    expect(dryRunRoot).toBe("/app");
    expect(generateCalls).toBe(0);
    expect(typecheckCalls).toBe(0);
    expect(stdout.value).toContain("Command would write file: /app/flarex/_generated/server.ts");
    expect(stdout.value).toContain("Command would delete file: /app/flarex/_generated/old.ts");
    expect(stdout.value).toContain("Command would delete directory: /app/flarex/_generated/oldDir");
  });

  it("dry-runs real codegen without writing generated files", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-dry-run-");
    const stdout = new StringWriter();
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: ["codegen", "--dry-run"],
        stdout,
      })).resolves.toBe(0);

      expect(stdout.value).toContain("Command would write file:");
      expect(stdout.value).toContain("server.ts");
      await expect(stat(path.join(root, "flarex/_generated/server.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("skips generated-output typecheck when mode is disable", async () => {
    let typecheckCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "disable"],
      dependencies: {
        generate: async () => {},
        typecheckGenerated: async () => {
          typecheckCalls += 1;
        },
      },
    })).resolves.toBe(0);

    expect(typecheckCalls).toBe(0);
  });

  it("continues when generated-output typecheck fails in try mode", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "try"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
        typecheckGenerated: async () => {
          throw new Error("tsc failed");
        },
      },
      stderr,
    })).resolves.toBe(0);

    expect(generateCalls).toBe(1);
    expect(stderr.value).toContain("--typecheck try");
    expect(stderr.value).toContain("tsc failed");
  });

  it("rejects invalid typecheck modes before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "maybe"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
      stderr,
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --typecheck value "maybe"');
  });

  it("rejects malformed typecheck path mappings", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "--path", "flarex"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
      stderr,
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --path value "flarex"');
  });

  it("rejects malformed typecheck path mappings before codegen even when typecheck is disabled", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "disable", "--path", "flarex"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
      stderr,
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --path value "flarex"');
  });
});

function cliSourcePackage(): SourcePackage {
  return {
    modules: [{
      path: "_flarex/execution.js",
      source: "export default {};",
      environment: "isolate",
      sha256: "a".repeat(64),
    }],
    functions: [],
    execution: "_flarex/execution.js",
  };
}

function cliAnalysis(): DeploymentAnalysis {
  return {
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  };
}
