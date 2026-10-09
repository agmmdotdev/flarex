import { expect, it } from "vitest";
import { checkPayloadConstructionBoundaries, inspectPayloadConstructionBoundary } from "./check-payload-construction-boundaries.mjs";
const file = "packages/payload-adapter/src/direct/binding.ts";

it("accepts the checked-in adapter through declared operation capabilities", () => {
  checkPayloadConstructionBoundaries();
  expect(inspectPayloadConstructionBoundary(file,
    'import { bindCmsRead, type CmsReadBinding } from "@flarex/persistence-postgres/internal/cms-execution";')).toEqual([]);
});
it.each([
  'import type { CmsHostInput as Hidden } from "@flarex/persistence-postgres/internal/cms-adapter";',
  'export { makeCmsHost as bind } from "@flarex/persistence-postgres/internal/cms-adapter";',
  'export * from "@flarex/persistence-postgres/internal/cms-construction";',
  'type Input = import("@flarex/persistence-postgres/internal/cms-construction").CmsCommandBindingInput<never>;',
  'type Input = import("@flarex/persistence-postgres/internal/cms-adapter").CmsHostInput<never>;',
  'import { makeCmsHost } from "../../../persistence-postgres/src/frameworks/cmsTransaction/host";',
  'const construction = await import("@flarex/persistence-postgres/internal/application-serving");',
  'const cms = await import("@flarex/persistence-postgres/internal/cms-adapter");',
  'import * as cms from "@flarex/persistence-postgres/internal/cms-adapter";',
  'import { inspectPayloadRuntimeForTest } from "../testing/runtimeInspection";',
  'import { makePostgresFlarexPersistence } from "@flarex/persistence-postgres";',
  'import type { FlarexPersistence } from "@flarex/persistence-postgres";',
  'export { createAppDataSnapshotResolver } from "@flarex/persistence-postgres";',
  'export * from "@flarex/persistence-postgres";',
  'import * as persistence from "@flarex/persistence-postgres";',
  'const persistence = await import("@flarex/persistence-postgres");',
  'const persistence = require("@flarex/persistence-postgres");',
  'import persistence = require("@flarex/persistence-postgres");',
  'type Database = import("@flarex/persistence-postgres").FlarexPersistence;',
])("rejects hidden construction or conformance dependencies: %s", text => {
  expect(inspectPayloadConstructionBoundary(file, text).length).toBeGreaterThan(0);
});
