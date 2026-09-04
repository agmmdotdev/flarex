import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRuntimeKernelTwice,
  renderRuntimeKernelModule,
  writeOrCheckGeneratedFile,
} from "./runtimeKernelBuilder";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(
  PACKAGE_ROOT, "..", "function-runtime", "src", "pointQueryInternalCall.ts",
);
const GENERATED = path.join(
  PACKAGE_ROOT, "src", "artifactRuntime", "PointQueryInternalCallRuntimeKernel.generated.ts",
);

if (process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode !== "update" && mode !== "check") {
    throw new Error("Usage: buildPointQueryInternalCallRuntimeKernel.ts <update|check>");
  }
  const receipt = await buildRuntimeKernelTwice({
    entry: ENTRY,
    label: "Internal-call point-query runtime kernel",
    minify: false,
  });
  const rendered = renderRuntimeKernelModule({
    generatedBy: "scripts/buildPointQueryInternalCallRuntimeKernel.ts",
    receipt,
    sourceExport: "POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1",
    sha256Export: "POINT_QUERY_INTERNAL_CALL_RUNTIME_KERNEL_SHA256_V1",
  });
  await writeOrCheckGeneratedFile(
    GENERATED,
    rendered,
    mode,
    "Generated internal-call point-query runtime kernel is stale; run " +
      "point-query-internal-call-runtime-kernel:update.",
  );
  console.log(
    `Verified internal-call point-query runtime kernel ${receipt.sha256} ` +
      `(${receipt.sourceBytes} bytes).`,
  );
}
