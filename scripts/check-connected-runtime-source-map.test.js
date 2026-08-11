import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeConnectedRuntimeSourceMap,
  inspectConnectedRuntimeSourceMapRepository,
} from "./check-connected-runtime-source-map.mjs";

const mapPath =
  "roadmaps/durable-task-engine/preflight/source-map.connected-runtime-v1.json";

describe("connected runtime source map checker", () => {
  it("accepts the approved pinned map and backend provenance", () => {
    expect(inspectConnectedRuntimeSourceMapRepository(process.cwd()).errors)
      .toEqual([]);
  });

  it("rejects a drifted source hash and approval status", () => {
    const sourceMap = JSON.parse(readFileSync(mapPath, "utf8"));
    sourceMap.decisionStatus = "candidate-awaiting-user-approval";
    sourceMap.entries[0].upstreamSha256 = "0".repeat(64);
    const sourceMetadata = JSON.parse(
      readFileSync("third_party/trigger.dev/SOURCE.json", "utf8"),
    );
    const report = analyzeConnectedRuntimeSourceMap({
      sourceMap,
      sourceMetadata,
      checksumText: readFileSync(
        "third_party/trigger.dev/SOURCE_SHA256SUMS",
        "utf8",
      ),
      readFile(relativePath) {
        const absolutePath = path.join(
          process.cwd(),
          relativePath.startsWith("upstream/")
            ? "third_party/trigger.dev"
            : "",
          relativePath,
        );
        try {
          return readFileSync(absolutePath);
        } catch {
          return undefined;
        }
      },
    });

    expect(report.errors).toContain(
      "decisionStatus must be approved before implementation.",
    );
    expect(report.errors).toContain(
      "entries[0] hash must match SOURCE_SHA256SUMS.",
    );
  });
});
