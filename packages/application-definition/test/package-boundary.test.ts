import manifest from "../package.json";
import { describe, expect, it } from "vitest";

import * as applicationDefinition from "../src/index.js";

describe("Application definition package boundary", () => {
  it("ships one clean root and only its preparation dependencies", () => {
    expect(manifest.name).toBe("@flarex/application-definition");
    expect(manifest.exports).toEqual({
      ".": "./src/index.ts",
    });
    expect(manifest.dependencies).toEqual({
      "@flarex/application-schema-definition": "workspace:*",
      "@flarex/declarative-materializer": "workspace:*",
      "@flarex/declarative-program": "workspace:*",
      "@flarex/standard-application-definition": "workspace:*",
      "@flarex/utils": "workspace:*",
      "effect": "catalog:",
    });
  });

  it("exposes only plain current runtime names", () => {
    expect(Object.keys(applicationDefinition).sort()).toEqual([
      "action",
      "defineApplication",
      "defineModule",
      "defineSchema",
      "defineTable",
      "internalAction",
      "internalMutation",
      "internalQuery",
      "mutation",
      "prepareApplication",
      "query",
      "sourceModule",
      "v",
      "workflowMutation",
    ]);
    expect(Object.keys(applicationDefinition).some((name) =>
      /standard|point|declarative|canonical|material|v\d/iu.test(name)
    )).toBe(false);
  });

  it("keeps legacy authoring and canonical members behind opaque handles", () => {
    const validator = applicationDefinition.v.string();
    const schema = applicationDefinition.defineSchema({
      values: applicationDefinition.defineTable({ value: validator }),
    });
    const fn = applicationDefinition.query({
      args: applicationDefinition.v.object({}),
      returns: validator,
    });

    expect(Object.keys(validator)).toEqual([]);
    expect(Object.keys(schema)).toEqual([]);
    expect("json" in validator).toBe(false);
    expect("toCanonicalInput" in schema).toBe(false);
    expect("toCanonicalInput" in fn).toBe(false);
    if (false) {
      // @ts-expect-error Clean validators do not expose protocol JSON.
      validator.json;
      // @ts-expect-error Clean schemas do not expose canonical input.
      schema.toCanonicalInput();
      // @ts-expect-error Clean functions do not expose canonical lowering.
      fn.toCanonicalInput("get");
    }
  });

  it("normalizes enriched input arrays to a plain readonly collection", () => {
    const module = applicationDefinition.defineModule({
      path: "values",
      source: applicationDefinition.sourceModule({
        path: "functions/values.js",
        bytes: new TextEncoder().encode("export const get = 1;\n"),
      }),
      functions: {
        get: applicationDefinition.query({
          args: applicationDefinition.v.object({}),
          returns: applicationDefinition.v.null(),
        }),
      },
    });
    const enrichedModules = Object.assign([module], { marker: "caller" });
    const definition = applicationDefinition.defineApplication({
      schema: applicationDefinition.defineSchema({}),
      modules: enrichedModules,
    });

    expect("marker" in definition.modules).toBe(false);
    if (false) {
      // @ts-expect-error Owned module collections discard caller extensions.
      definition.modules.marker;
    }
  });
});
