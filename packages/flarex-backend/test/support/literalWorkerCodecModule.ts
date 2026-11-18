import { fileURLToPath } from "node:url";

import { buildRuntimeKernelTwice } from "../../scripts/runtimeKernelBuilder";

let moduleSource: Promise<string> | undefined;

/** Bundle the existing codecs rather than recreate numeric transport in fixtures. */
export function literalWorkerCodecModuleSource(): Promise<string> {
  return moduleSource ??= buildRuntimeKernelTwice({
    entry: fileURLToPath(new URL("./literalWorkerCodecEntry.ts", import.meta.url)),
    label: "literal Worker fixture codec",
    minify: false,
  }).then(receipt => receipt.source);
}
