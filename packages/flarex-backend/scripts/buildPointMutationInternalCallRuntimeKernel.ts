import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRuntimeKernelTwice,
  renderRuntimeKernelModule,
} from "./runtimeKernelBuilder";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(
  PACKAGE_ROOT, "..", "function-runtime", "src", "pointMutationInternalCall.ts",
);
const GENERATED = path.join(
  PACKAGE_ROOT, "src", "artifactRuntime", "PointMutationInternalCallRuntimeKernel.generated.ts",
);

if (process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode !== "update" && mode !== "check") {
    throw new Error("Usage: buildPointMutationInternalCallRuntimeKernel.ts <update|check>");
  }
  const receipt = await buildRuntimeKernelTwice({
    entry: ENTRY,
    label: "Point-mutation internal-call runtime kernel",
    minify: false,
  });
  const rendered = renderRuntimeKernelModule({
    generatedBy: "scripts/buildPointMutationInternalCallRuntimeKernel.ts",
    receipt,
    sourceExport: "POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1",
    sha256Export: "POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SHA256_V1",
  });
  if (mode === "update") await writeFile(GENERATED, rendered, "utf8");
  else if (await readFile(GENERATED, "utf8") !== rendered) {
    throw new Error(
      "Generated point-mutation internal-call runtime kernel is stale; run " +
        "point-mutation-internal-call-runtime-kernel:update.",
    );
  }
  console.log(
    `Verified point-mutation internal-call runtime kernel ${receipt.sha256} ` +
      `(${receipt.sourceBytes} bytes).`,
  );
}
