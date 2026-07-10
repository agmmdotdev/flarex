import { describe, expect, it } from "vitest";

import { verifyExecutorBundleMeta } from "../scripts/bundleGraph";

describe("executor Worker bundle graph verifier", () => {
  it("accepts the required Worker-safe production graph", () => {
    expect(verifyExecutorBundleMeta(validMeta())).toEqual({
      inputCount: 5,
      outputCount: 1,
    });
  });

  it("requires runtime modules to be bundled inputs, not only import strings", () => {
    const meta = validMeta();
    delete meta.inputs[executorInputPath];
    meta.inputs["src/worker.ts"] = {
      imports: [{ path: executorInputPath }],
    };

    expect(() => verifyExecutorBundleMeta(meta)).toThrow(
      "Executor bundle is missing required runtime inputs",
    );
  });

  it.each([
    "../../node_modules/@electric-sql/pglite/dist/index.js",
    "../../node_modules/.pnpm/@electric-sql+pglite@0.3.14/index.js",
    "../../node_modules/drizzle-orm/pglite/migrator.js",
    "../../node_modules/drizzle-orm/node-postgres/migrator.js",
    "../../packages/persistence-postgres/src/pglite.ts",
    "../../packages/persistence-postgres/src/postgres.ts",
    "../../packages/persistence-postgres/drizzle/0019_schema.sql",
    "../../packages/persistence-postgres/drizzle.config.ts",
  ])("rejects prohibited persistence input %s", (path) => {
    const meta = validMeta();
    meta.inputs[path] = { imports: [] };

    expect(() => verifyExecutorBundleMeta(meta)).toThrow(
      "Executor bundle contains prohibited persistence inputs",
    );
  });

  it.each([
    ["node:fs/promises", undefined],
    ["fs", undefined],
    ["path/posix", undefined],
    ["node:url", undefined],
    ["node-built-in-modules:fs", "node:fs"],
    ["node-built-in-modules:path", "node:path"],
  ])(
    "rejects persistence filesystem import path=%s original=%s",
    (path, original) => {
      const meta = validMeta();
      meta.inputs[persistenceInputPath] = {
        imports: [
          {
            path,
            ...(original === undefined ? {} : { original }),
          },
        ],
      };

      expect(() => verifyExecutorBundleMeta(meta)).toThrow(
        "Executor bundle contains prohibited persistence inputs",
      );
    },
  );

  it.each([
    ["non-array imports", { imports: {} }],
    ["missing import path", { imports: [{}] }],
    ["non-string original", { imports: [{ path: "node:fs", original: 1 }] }],
  ])("fails closed on malformed %s metadata", (_, malformedInput) => {
    const meta = validMeta();
    meta.inputs[persistenceInputPath] = malformedInput;

    expect(() => verifyExecutorBundleMeta(meta)).toThrow(/must be/);
  });

  it("requires a JavaScript output whose entry point is the Worker", () => {
    const meta = validMeta();
    meta.outputs = {
      "dist/worker.js": { entryPoint: "src/not-the-worker.ts" },
    };

    expect(() => verifyExecutorBundleMeta(meta)).toThrow(
      "did not emit a JavaScript bundle from src/worker.ts",
    );
  });
});

interface TestBundleMeta {
  readonly inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

const executorInputPath = "../../packages/executor/src/index.ts";
const persistenceInputPath =
  "../../packages/persistence-postgres/src/postgresClient.ts";

function validMeta(): TestBundleMeta {
  return {
    inputs: {
      "src/worker.ts": { imports: [] },
      [executorInputPath]: { imports: [] },
      "../../packages/executor-http/src/routes.ts": { imports: [] },
      [persistenceInputPath]: { imports: [] },
      "../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js": {
        imports: [],
      },
    },
    outputs: {
      "dist/worker.js": { entryPoint: "src/worker.ts" },
    },
  };
}
