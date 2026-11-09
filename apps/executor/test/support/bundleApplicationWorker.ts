import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build, defaultClientConditions, type Plugin } from "vite";

/** Shared actual-host bundling; Cloudflare runtime modules stay native in workerd. */
export async function bundleApplicationWorker(entry: URL): Promise<string> {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const workspaceResolution: Plugin = { name: "actual-app-do-workspace-resolution", resolveId(id) {
    if (id.startsWith("@flarex/") || id === "flarex-backend" || id.startsWith("flarex-backend/")
      || id === "flarex-protocol" || id.startsWith("flarex-protocol/")) return fileURLToPath(import.meta.resolve(id));
    return undefined;
  } };
  const output = await build({ configFile: false, logLevel: "silent", plugins: [workspaceResolution],
    // The pinned Medusa Cloudflare host sets this same compile-time target in
    // apps/medusa-cloudflare/vite.config.ts. Its native Inventory/Order seam
    // retains ORM decorators for Node and excludes their loader in Workers.
    define: { __MEDUSA_CLOUDFLARE_WORKER__: "true" },
    resolve: { conditions: ["workerd", ...defaultClientConditions] },
    build: { write: false, minify: false, target: "es2022", lib: { entry: fileURLToPath(entry), formats: ["es"], fileName: "worker" },
      rolldownOptions: { external: id => id.startsWith("cloudflare:") || builtins.has(id),
        output: { banner: 'import { createRequire as createRuntimeRequire } from "node:module";\nconst require = createRuntimeRequire("file:///worker.js");' } },
    } });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Missing actual app-owner proof bundle.");
  return worker.code;
}
