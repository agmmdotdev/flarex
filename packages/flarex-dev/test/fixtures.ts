import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function createMinimalFlarexProject(prefix = "flarex-minimal-"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { defineGlobalTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({ messages: defineGlobalTable({ body: v.string() }) });
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/messages.ts"),
    `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
  );
  return root;
}
