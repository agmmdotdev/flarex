// Benchmark-only control. Load before importing application modules, in a fresh
// Node process. Runtime packages always install their checked-in static output.
import { registerHooks } from "node:module";

const root = new URL("../packages/", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(root) && url.endsWith(".schema-aot.generated.mjs")) {
      return { format: "module", source: "export function install() {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
