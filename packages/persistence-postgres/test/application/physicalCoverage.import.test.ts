import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("initializes physical coverage when reconciliation is the first native ESM import", () => {
  const require = createRequire(import.meta.url);
  const reconciliation = new URL("../../src/storage/indexes/indexBuildReconciliation.ts", import.meta.url).href;
  const coverage = new URL("../../src/application/readiness/physicalCoverage.ts", import.meta.url).href;
  const capacity = new URL("../../src/storage/indexes/catalogCapacity.ts", import.meta.url).href;
  const output = execFileSync(process.execPath, [
    "--import", pathToFileURL(require.resolve("tsx")).href,
    "--input-type=module", "--eval", `
      const reconciliation = await import(${JSON.stringify(reconciliation)});
      const coverage = await import(${JSON.stringify(coverage)});
      const capacity = await import(${JSON.stringify(capacity)});
      console.log(JSON.stringify({
        reconciled: reconciliation.MAX_RECONCILED_DEFINITIONS,
        physical: coverage.MAX_PHYSICAL_DEFINITIONS,
        capacity: capacity.MAX_PHYSICAL_INDEX_DEFINITIONS,
      }));
    `,
  ], { encoding: "utf8", timeout: 20_000 });
  expect(JSON.parse(output)).toEqual({ reconciled: 1024, physical: 1024, capacity: 1024 });
}, 30_000);
