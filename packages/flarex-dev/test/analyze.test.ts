import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFunctionModules, listFunctionModules } from "../src/analyze";

describe("analyzeFunctionModules", () => {
  it("uses Convex-style markers and returns validator metadata", async () => {
    const functionsDir = await createFunctions({
      "functions.ts": `import { internalAction, mutation, query, routeFromArgs, workflowMutation } from "flarex/server";
import { v } from "flarex/values";
const list = query({
  args: { topic: v.string() },
  returns: v.array(v.string()),
  route: routeFromArgs("topic"),
  handler: async () => [],
});
Object.assign(list, { kind: "mutation", visibility: "internal" });
export { list };
export const send = mutation({ args: v.any(), handler: async () => null });
export const workflow = workflowMutation({ args: {}, handler: async () => null });
export const hidden = internalAction({ args: {}, handler: async () => null });
`,
    });

    const result = await analyze(functionsDir);

    expect(result).toEqual([
      {
        moduleName: "functions",
        functions: [
          {
            moduleName: "functions",
            exportName: "hidden",
            kind: "action",
            visibility: "internal",
            args: { type: "object", value: {} },
            returns: null,
            route: null,
            partition: null,
          },
          {
            moduleName: "functions",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: {
              type: "object",
              value: {
                topic: { fieldType: { type: "string" }, optional: false },
              },
            },
            returns: { type: "array", value: { type: "string" } },
            route: { type: "args", field: "topic" },
            partition: null,
          },
          {
            moduleName: "functions",
            exportName: "send",
            kind: "mutation",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            route: null,
            partition: null,
          },
          {
            moduleName: "functions",
            exportName: "workflow",
            kind: "workflowMutation",
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
            route: null,
            partition: null,
          },
        ],
      },
    ]);
  });

  it("skips exports with ambiguous markers", async () => {
    const functionsDir = await createFunctions({
      "ambiguous.ts": `const handler = async () => null;
export const ambiguousKind = {
  isQuery: true,
  isMutation: true,
  isPublic: true,
  _handler: handler,
};
export const ambiguousVisibility = {
  isQuery: true,
  isPublic: true,
  isInternal: true,
  _handler: handler,
};
export const missingVisibility = { isQuery: true, _handler: handler };
`,
    });

    expect(await analyze(functionsDir)).toEqual([
      { moduleName: "ambiguous", functions: [] },
    ]);
  });

  it.each([
    [
      "invalid exporter type",
      `{ isQuery: true, isPublic: true, _handler: async () => null, exportArgs: "bad" }`,
      "bad:fn.exportArgs is not a function or `undefined`.",
    ],
    [
      "non-string exporter result",
      `{ isQuery: true, isPublic: true, _handler: async () => null, exportArgs: () => 42 }`,
      "bad:fn.exportArgs() didn't return a string.",
    ],
    [
      "invalid exporter JSON",
      `{ isQuery: true, isPublic: true, _handler: async () => null, exportArgs: () => "{" }`,
      "Invalid JSON returned from bad:fn.exportArgs()",
    ],
    [
      "invalid validator shape",
      `{ isQuery: true, isPublic: true, _handler: async () => null, exportArgs: () => JSON.stringify({ type: "unknown" }) }`,
      "Invalid validator returned from bad:fn.exportArgs()",
    ],
    [
      "invalid argument validator kind",
      `{ isQuery: true, isPublic: true, _handler: async () => null, exportArgs: () => JSON.stringify({ type: "string" }) }`,
      "Argument validator must be an object validator or v.any().",
    ],
    [
      "invalid handler",
      `{ isQuery: true, isPublic: true, _handler: "bad" }`,
      "bad:fn.handler is not a function.",
    ],
  ])("rejects %s", async (_name, definition, message) => {
    const functionsDir = await createFunctions({
      "bad.ts": `export const fn = ${definition};\n`,
    });

    await expect(analyze(functionsDir)).rejects.toThrow(message);
  });
});

async function analyze(functionsDir: string) {
  return analyzeFunctionModules(await listFunctionModules(functionsDir));
}

async function createFunctions(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-analyze-"));
  const functionsDir = path.join(root, "functions");
  await mkdir(functionsDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, source]) =>
      writeFile(path.join(functionsDir, name), source),
    ),
  );
  return functionsDir;
}
