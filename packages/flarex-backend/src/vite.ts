import type { Plugin } from "vite";
import { generateFlarex, type FlarexGenerateOptions } from "./generate.ts";

export type FlarexPluginOptions = Omit<FlarexGenerateOptions, "root">;

export function flarex(options: FlarexPluginOptions = {}): Plugin {
  let root = process.cwd();
  return {
    name: "flarex",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await generateFlarex({ ...options, root });
    },
    async configureServer(server) {
      await generateFlarex({ ...options, root });
      server.watcher.add(`${root}/${options.appDir ?? "flarex"}/**/*.ts`);
      server.watcher.on("change", async file => {
        if (file.includes(`${options.appDir ?? "flarex"}`)) {
          await generateFlarex({ ...options, root });
        }
      });
    },
  };
}
