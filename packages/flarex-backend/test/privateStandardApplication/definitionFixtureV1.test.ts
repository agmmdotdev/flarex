import type {
  DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeOrdersPrivateStandardApplicationDefinitionFixtureV1,
} from "./definitionFixtureV1";

const UTF8_DECODER = new TextDecoder();

describe("private standard application definition fixture V1", () => {
  it("materializes through the canonical program and materializer owners", () => {
    const fixture =
      makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
    const prepared = Result.getOrThrow(
      prepareStandardApplicationDefinitionV1(fixture),
    );
    const program = prepared.program;
    const plan = prepared.artifactIngressPlan;

    expect(program.schema.tables.map((table) => table.logicalName))
      .toEqual(["orders"]);
    expect(program.schema.indexes).toMatchObject([{
      tableLogicalName: "orders",
      descriptor: "by_status",
      fields: ["status"],
    }]);
    expect(program.modules[0]?.functions[0]).toMatchObject({
      exportName: "place",
      kind: "mutation",
      visibility: "public",
    });
    expect(plan.source.modules.map((module) => module.path)).toEqual([
      "_flarex/execution.js",
      "orders.js",
    ]);
    expect(plan.semantic.recordCount).toBeGreaterThan(0);
  });

  it("allocates independent graph inputs and source bytes per fixture", () => {
    const baseline =
      makeOrdersPrivateStandardApplicationDefinitionFixtureV1();
    const changed =
      makeOrdersPrivateStandardApplicationDefinitionFixtureV1(
        "export const place = 2;\n",
      );
    const baselineOrders = moduleByPath(baseline.graphInput, "orders.js");
    const changedOrders = moduleByPath(changed.graphInput, "orders.js");
    const baselineExecution = moduleByPath(
      baseline.graphInput,
      "_flarex/execution.js",
    );
    const changedExecution = moduleByPath(
      changed.graphInput,
      "_flarex/execution.js",
    );
    const baselineSourceMap = requiredSourceMap(baselineOrders);
    const changedSourceMap = requiredSourceMap(changedOrders);

    expect(changed).not.toBe(baseline);
    expect(changed.graphInput).not.toBe(baseline.graphInput);
    expect(changedOrders.sourceBytes.buffer)
      .not.toBe(baselineOrders.sourceBytes.buffer);
    expect(changedSourceMap.buffer).not.toBe(baselineSourceMap.buffer);
    expect(changedExecution.sourceBytes.buffer)
      .not.toBe(baselineExecution.sourceBytes.buffer);
    expect(UTF8_DECODER.decode(baselineOrders.sourceBytes)).toBe(
      "export const place = 1;\n",
    );
    expect(UTF8_DECODER.decode(changedOrders.sourceBytes)).toBe(
      "export const place = 2;\n",
    );
  });
});

type PrebuiltModuleInputV1 =
  DeclarativeV2PrebuiltModuleGraphInputV1["modules"][number];

function moduleByPath(
  graph: DeclarativeV2PrebuiltModuleGraphInputV1,
  path: string,
): PrebuiltModuleInputV1 {
  const module = graph.modules.find((candidate) => candidate.path === path);
  if (module === undefined) {
    throw new Error(`Expected fixture module ${path}.`);
  }
  return module;
}

function requiredSourceMap(module: PrebuiltModuleInputV1): Uint8Array {
  if (module.sourceMapBytes === null) {
    throw new Error(`Expected source map for fixture module ${module.path}.`);
  }
  return module.sourceMapBytes;
}
