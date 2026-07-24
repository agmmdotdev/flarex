import { createHash } from "node:crypto";
import { sourceModuleDigestInputV1 } from "flarex/artifacts";

export function sourceModuleSha256ForTest(
  source: string,
  sourceMap?: string,
): string {
  return createHash("sha256")
    .update(sourceModuleDigestInputV1(source, sourceMap))
    .digest("hex");
}
