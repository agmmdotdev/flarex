import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  admitApplicationPreparationPolicy,
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  mutation,
  prepareApplication,
  produceApplicationSource,
  query,
  sourceModule,
  v,
  type ApplicationPreparationPolicy,
  type Id,
  type InferFunctionArgs,
  type InferFunctionReturn,
} from "../src/index.js";
import { inspectPreparedApplication } from "../src/Preparation.js";

const encoder = new TextEncoder();

const preparationPolicy = Object.freeze({
  maximumModules: 8,
  maximumFunctions: 32,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 256,
  maximumValidatorDepth: 32,
  maximumValidatorStringUtf8Bytes: 4_096,
  maximumSourceBytes: 8_192,
  maximumSourceMapBytes: 4_096,
  maximumBytesMaterialized: 64_000,
  maximumSemanticRecords: 128,
  maximumSemanticRecordBytes: 8_000,
  maximumSemanticStreamBytes: 32_000,
}) satisfies ApplicationPreparationPolicy;

describe("Application definition", () => {
  it("authors and exactly prepares one typed create/query application", () => {
    const sourceBytes = encoder.encode(
      "export const get = 1; export const create = 2;\n",
    );
    const definition = makeRecipeApplication(sourceBytes);
    const recipeModule = definition.modules[0];
    if (recipeModule === undefined) {
      throw new Error("Expected the recipe application module.");
    }
    const getReference = recipeModule.reference("get");
    const createReference = recipeModule.reference("create");

    expectTypeOf<InferFunctionArgs<typeof getReference.contract>>()
      .toEqualTypeOf<Readonly<{ readonly id: Id<"recipes"> }>>();
    expectTypeOf<InferFunctionReturn<typeof getReference.contract>>()
      .toEqualTypeOf<Readonly<{
        readonly title: string;
        readonly servings: number;
      }> | null>();
    expectTypeOf<InferFunctionArgs<typeof createReference.contract>>()
      .toEqualTypeOf<Readonly<{
        readonly title: string;
        readonly servings: number;
      }>>();
    expectTypeOf<InferFunctionReturn<typeof createReference.contract>>()
      .toMatchTypeOf<string>();
    expect(getReference.path).toBe("recipes:get");
    expect(createReference.path).toBe("recipes:create");

    sourceBytes.fill(0);
    const prepared = Result.getOrThrow(
      prepareApplication(definition, preparationPolicy),
    );
    const lowered = inspectPreparedApplication(prepared);

    expect(prepared.application).toBe(definition);
    expect(lowered.program.schema).toEqual({
      tables: [{
        logicalName: "recipes",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: {
            type: "object",
            value: {
              servings: {
                fieldType: { type: "number" },
                optional: false,
              },
              title: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
        },
      }],
      indexes: [{
        tableLogicalName: "recipes",
        descriptor: "by_title",
        fields: ["title"],
      }],
    });
    expect(lowered.program.modules).toEqual([{
      modulePath: "recipes",
      functions: [
        {
          exportName: "create",
          kind: "mutation",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              servings: {
                fieldType: { type: "number" },
                optional: false,
              },
              title: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returnsValidator: { type: "id", tableName: "recipes" },
        },
        {
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              id: {
                fieldType: { type: "id", tableName: "recipes" },
                optional: false,
              },
            },
          },
          returnsValidator: {
            type: "union",
            value: [
              {
                type: "object",
                value: {
                  servings: {
                    fieldType: { type: "number" },
                    optional: false,
                  },
                  title: {
                    fieldType: { type: "string" },
                    optional: false,
                  },
                },
              },
              { type: "null" },
            ],
          },
        },
      ],
    }]);
    expect(lowered.artifactIngressPlan.source).toMatchObject({
      modules: [{
        path: "functions/recipes.js",
        roles: 9,
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "recipes",
        artifactModulePath: "functions/recipes.js",
      }],
      executionPath: "functions/recipes.js",
      schemaPath: null,
      authPath: null,
    });
    expect(
      lowered.artifactIngressPlan.source.modules[0]?.sourceBytes,
    ).toEqual(encoder.encode(
      "export const get = 1; export const create = 2;\n",
    ));
    expect(lowered.artifactIngressPlan.usage.entryBindings).toBe(1);

    const produced = Result.getOrThrow(produceApplicationSource(prepared));
    expect(produced.modules.map(module => module.path)).toEqual([
      "_flarex/application.js",
      "_flarex/schema.js",
      "functions/recipes.js",
    ]);
    expect(produced.executionPath).toBe("_flarex/application.js");
    expect(produced.schemaPath).toBe("_flarex/schema.js");
    expect(new TextDecoder().decode(
      produced.modules.find(module =>
        module.path === "functions/recipes.js"
      )?.sourceBytes,
    )).toBe("export const get = 1; export const create = 2;\n");
  });

  it("owns source bytes and module membership before preparation", () => {
    const sourceBytes = encoder.encode("export const get = 1;\n");
    const source = sourceModule({
      path: "functions/recipes.js",
      bytes: sourceBytes,
    });
    const module = defineModule({
      path: "recipes",
      source,
      functions: {
        get: query({
          args: v.object({ id: v.id("recipes") }),
          returns: v.null(),
        }),
      },
    });
    const modules = [module];
    const definition = defineApplication({
      schema: defineSchema({
        recipes: defineTable({ title: v.string() }),
      }),
      modules,
    });

    sourceBytes.fill(0);
    modules.length = 0;
    const prepared = Result.getOrThrow(
      prepareApplication(definition, preparationPolicy),
    );
    const lowered = inspectPreparedApplication(prepared);

    expect(definition.modules).toHaveLength(1);
    expect(Object.isFrozen(definition.modules)).toBe(true);
    expect(lowered.artifactIngressPlan.source.modules[0]?.sourceBytes)
      .toEqual(encoder.encode("export const get = 1;\n"));
  });

  it("normalizes module order before selecting the temporary execution role", () => {
    const recipes = makeReadModule("recipes", "functions/z-recipes.js");
    const authors = makeReadModule("authors", "functions/a-authors.js");
    const schema = defineSchema({
      authors: defineTable({ name: v.string() }),
      recipes: defineTable({ title: v.string() }),
    });
    const forward = defineApplication({
      schema,
      modules: [recipes, authors],
    });
    const reverse = defineApplication({
      schema,
      modules: [authors, recipes],
    });

    const forwardLowering = inspectPreparedApplication(Result.getOrThrow(
      prepareApplication(forward, preparationPolicy),
    ));
    const reverseLowering = inspectPreparedApplication(Result.getOrThrow(
      prepareApplication(reverse, preparationPolicy),
    ));

    expect(forwardLowering.program).toEqual(reverseLowering.program);
    expect(forwardLowering.artifactIngressPlan)
      .toEqual(reverseLowering.artifactIngressPlan);
    expect(forwardLowering.artifactIngressPlan.source.executionPath)
      .toBe("functions/a-authors.js");
  });

  it("captures accessor-backed inputs once for references and lowering", () => {
    const args = v.object({ id: v.id("recipes") });
    const returns = v.null();
    let argsReads = 0;
    let returnsReads = 0;
    const get = query({
      get args() {
        argsReads += 1;
        return args;
      },
      get returns() {
        returnsReads += 1;
        return returns;
      },
    });
    let functionReads = 0;
    const functions = {
      get get() {
        functionReads += 1;
        return get;
      },
    };
    let sourceMapReads = 0;
    const source = sourceModule({
      path: "functions/recipes.js",
      bytes: encoder.encode("export const get = 1;\n"),
      get sourceMapBytes() {
        sourceMapReads += 1;
        return encoder.encode("{\"version\":3}\n");
      },
    });
    const module = defineModule({ path: "recipes", source, functions });
    let moduleReads = 0;
    const definition = defineApplication({
      schema: defineSchema({
        recipes: defineTable({ title: v.string() }),
      }),
      get modules() {
        moduleReads += 1;
        return [module];
      },
    });
    const reference = module.reference("get");
    const lowered = inspectPreparedApplication(Result.getOrThrow(
      prepareApplication(definition, preparationPolicy),
    ));

    expect({ argsReads, returnsReads, functionReads, sourceMapReads, moduleReads })
      .toEqual({
        argsReads: 1,
        returnsReads: 1,
        functionReads: 1,
        sourceMapReads: 1,
        moduleReads: 1,
      });
    expect(reference.contract).toBe(get);
    expect(reference.contract.args).toBe(args);
    expect(reference.contract.returns).toBe(returns);
    expect(lowered.program.modules[0]?.functions[0]).toEqual({
      exportName: "get",
      kind: "query",
      visibility: "public",
      argsValidator: {
        type: "object",
        value: {
          id: {
            fieldType: { type: "id", tableName: "recipes" },
            optional: false,
          },
        },
      },
      returnsValidator: { type: "null" },
    });
  });

  it("preserves canonical policy failure before materialization policy failure", () => {
    const definition = makeRecipeApplication(
      encoder.encode("export const get = 1; export const create = 2;\n"),
    );
    const invalidPolicy = {
      ...preparationPolicy,
      maximumModules: -1,
      maximumSourceBytes: -1,
    } satisfies ApplicationPreparationPolicy;

    expect(Result.match(prepareApplication(definition, invalidPolicy), {
      onFailure: (failure) => failure,
      onSuccess: () => {
        throw new Error("Expected application preparation to fail.");
      },
    })).toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      operation: "createBudget",
      reason: "invalidBudget",
    });
  });

  it("admits one opaque policy snapshot without invoking accessors", () => {
    const admitted = Result.getOrThrow(
      admitApplicationPreparationPolicy(preparationPolicy),
    );
    expect(Object.keys(admitted)).toEqual([]);
    expect(Result.isSuccess(prepareApplication(
      makeRecipeApplication(
        encoder.encode("export const get = 1; export const create = 2;\n"),
      ),
      admitted,
    ))).toBe(true);

    let getterInvoked = false;
    const accessorPolicy = Object.defineProperty(
      { ...preparationPolicy },
      "maximumSourceBytes",
      {
        enumerable: true,
        get() {
          getterInvoked = true;
          return preparationPolicy.maximumSourceBytes;
        },
      },
    ) as ApplicationPreparationPolicy;
    expect(Result.match(
      admitApplicationPreparationPolicy(accessorPolicy),
      {
        onFailure: failure => failure,
        onSuccess: () => {
          throw new Error("Expected policy admission to fail.");
        },
      },
    )).toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      operation: "createBudget",
      reason: "invalidBudget",
    });
    expect(getterInvoked).toBe(false);
  });

  it("preserves an intentionally omitted return validator as unvalidated", () => {
    const module = defineModule({
      path: "events",
      source: sourceModule({
        path: "functions/events.js",
        bytes: encoder.encode("export const emit = 1;\n"),
      }),
      functions: {
        emit: mutation({ args: v.object({ value: v.string() }) }),
      },
    });
    const reference = module.reference("emit");
    expectTypeOf<InferFunctionReturn<typeof reference.contract>>()
      .toEqualTypeOf<unknown>();

    const prepared = Result.getOrThrow(prepareApplication(defineApplication({
      schema: defineSchema({}),
      modules: [module],
    }), preparationPolicy));
    expect(inspectPreparedApplication(prepared).program.modules[0]?.functions)
      .toEqual([{
        exportName: "emit",
        kind: "mutation",
        visibility: "public",
        argsValidator: {
          type: "object",
          value: {
            value: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        returnsValidator: null,
      }]);
  });
});

function makeRecipeApplication(sourceBytes: Uint8Array) {
  const recipeFields = {
    title: v.string(),
    servings: v.number(),
  };
  const recipeDocument = v.object(recipeFields);
  const recipeModule = makeRecipeModule(sourceBytes, recipeFields, recipeDocument);

  return defineApplication({
    schema: defineSchema({
      recipes: defineTable(recipeFields).index("by_title", ["title"]),
    }),
    modules: [recipeModule],
  });
}

function makeRecipeModule<
  Fields extends Readonly<{
    readonly title: ReturnType<typeof v.string>;
    readonly servings: ReturnType<typeof v.number>;
  }>,
  Document extends ReturnType<typeof v.object<Fields>>,
>(
  sourceBytes: Uint8Array,
  fields: Fields,
  document: Document,
) {
  return defineModule({
    path: "recipes",
    source: sourceModule({
      path: "functions/recipes.js",
      bytes: sourceBytes,
    }),
    functions: {
      get: query({
        args: v.object({ id: v.id("recipes") }),
        returns: v.nullable(document),
      }),
      create: mutation({
        args: v.object(fields),
        returns: v.id("recipes"),
      }),
    },
  });
}

function makeReadModule<Path extends string>(
  path: Path,
  sourcePath: string,
) {
  return defineModule({
    path,
    source: sourceModule({
      path: sourcePath,
      bytes: encoder.encode("export const get = 1;\n"),
    }),
    functions: {
      get: query({
        args: v.object({}),
        returns: v.null(),
      }),
    },
  });
}
