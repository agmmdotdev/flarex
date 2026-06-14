import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateFlarex } from "../src/generate";

describe("generateFlarex", () => {
  it("generates api references, worker classes, and wrangler bindings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "flarex-"));
    await mkdir(path.join(root, "flarex/functions"), { recursive: true });
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `export const list = query({});\nexport const send = mutation({});\n`,
    );

    await generateFlarex({ root, workerName: "test-flarex" });

    const api = await readFile(path.join(root, "flarex/_generated/api.ts"), "utf8");
    const dataModel = await readFile(path.join(root, "flarex/_generated/dataModel.ts"), "utf8");
    const server = await readFile(path.join(root, "flarex/_generated/server.ts"), "utf8");
    const functionMetadata = await readFile(
      path.join(root, "flarex/_generated/functionMetadata.ts"),
      "utf8",
    );
    const worker = await readFile(path.join(root, "flarex/_generated/worker.ts"), "utf8");
    const wrangler = await readFile(path.join(root, "wrangler.generated.jsonc"), "utf8");
    expect(api).toContain('import type * as module0 from "../functions/messages"');
    expect(api).toContain("ApiFromModules");
    expect(api).toContain('"messages": typeof module0');
    expect(dataModel).toContain("DataModelFromSchemaDefinition<typeof schema>");
    expect(server).toContain('QueryBuilder<DataModel, "public">');
    expect(functionMetadata).toContain("functionArgsToValidatorJson");
    expect(functionMetadata).toContain('"messages:send": module0.send');
    expect(functionMetadata).toContain("validatorToJson");
    expect(functionMetadata).toContain("returns: fn.returns === null ? null : validatorToJson(fn.returns)");
    expect(worker).toContain("class ConnectionDO");
    expect(worker).toContain('"messages:send": module0.send');
    expect(worker).toContain('url.pathname === "/invoke"');
    expect(worker).not.toContain("class PartitionDO");
    expect(worker).not.toContain("this.ctx.storage.transaction");
    expect(worker).toContain("invokeWithBackend");
    expect(worker).toContain("/executions/start");
    expect(worker).toContain("/syscall");
    expect(worker).toContain("/finish");
    expect(worker).toContain("createQueryInitializer");
    expect(worker).toContain("parseFlarexId");
    expect(worker).toContain("const tableMetadata = Object.fromEntries");
    expect(worker).not.toContain("const id = `${table}:${crypto.randomUUID()}`");
    expect(worker).toContain("validateFunctionArgs(fn.args, body.args, { validateId: validateTableNameId })");
    expect(worker).toContain("validateTableNameId");
    expect(worker).toContain("validateFunctionReturn(fn.returns, value)");
    expect(wrangler).toContain('"FLAREX_BACKEND"');
    expect(wrangler).toContain('"new_sqlite_classes"');
  });
});
