import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRuntimeKernelTwice,
  renderRuntimeKernelModule,
  type RuntimeKernelBuildReceipt,
} from "./runtimeKernelBuilder";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(
  PACKAGE_ROOT,
  "..",
  "function-runtime",
  "src",
  "pointMutation.ts",
);
const GENERATED_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "artifactRuntime",
  "PointMutationRuntimeKernel.generated.ts",
);

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  if (mode !== "update" && mode !== "check") {
    throw new Error("Usage: buildPointMutationRuntimeKernel.ts <update|check>");
  }
  const receipt = mode === "update"
    ? await updatePointMutationRuntimeKernel()
    : await checkPointMutationRuntimeKernel();
  console.log(
    `Verified point-mutation runtime kernel ${receipt.sha256} ` +
      `(${receipt.sourceBytes} bytes) with two byte-identical clean builds.`,
  );
}

export async function updatePointMutationRuntimeKernel(): Promise<
  RuntimeKernelBuildReceipt
> {
  const receipt = await buildKernel();
  await writeFile(GENERATED_PATH, render(receipt), "utf8");
  return receipt;
}

export async function checkPointMutationRuntimeKernel(): Promise<
  RuntimeKernelBuildReceipt
> {
  const receipt = await buildKernel();
  const current = await readFile(GENERATED_PATH, "utf8");
  if (current !== render(receipt)) {
    throw new Error(
      "Generated point-mutation runtime kernel is stale; run " +
        "`pnpm point-mutation-runtime-kernel:update` in packages/flarex-backend.",
    );
  }
  return receipt;
}

function buildKernel(): Promise<RuntimeKernelBuildReceipt> {
  return buildRuntimeKernelTwice({
    entry: ENTRY,
    label: "Point-mutation runtime kernel",
    minify: "esbuild",
  });
}

function render(receipt: RuntimeKernelBuildReceipt): string {
  return renderRuntimeKernelModule({
    generatedBy: "scripts/buildPointMutationRuntimeKernel.ts",
    receipt,
    sourceExport: "POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1",
    sha256Export: "POINT_MUTATION_RUNTIME_KERNEL_SHA256_V1",
  });
}
