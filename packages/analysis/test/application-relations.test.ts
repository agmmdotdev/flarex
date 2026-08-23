import { Effect } from "effect";
import type { ValidatorJSON } from "flarex/values";
import { describe, expect, it } from "vitest";

import {
  analyzeApplicationRelationDeclarationsResult,
  analyzeLoadedApplicationSourcePackageEffect,
  APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
} from "../src/index.ts";

describe("Application relation analysis", () => {
  it("analyzes valid one and many relations into deterministic local ordinals", async () => {
    const declarations = [
      relationMany("posts", "reviewers", "users", "reviewedPosts"),
      relationOne("posts", "author", "users", "posts", true),
    ];
    const first = await analyze(schemaDefinition(declarations));
    const second = await analyze(schemaDefinition(declarations.toReversed()));

    expect(first.relations).toEqual(second.relations);
    expect(first.relations.map(relation => relation.relationOrdinal)).toEqual([
      1,
      2,
    ]);
    expect(first.relations.map(relation => ({
      source: relation.declaration.source.forwardName,
      sourceTableOrdinal: relation.sourceTableOrdinal,
      targetTableOrdinal: relation.targetTableOrdinal,
    }))).toEqual(expect.arrayContaining([
      {
        source: "author",
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
      },
      {
        source: "reviewers",
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
      },
    ]));
  });

  it("rejects source validator requiredness and cardinality mismatches", async () => {
    await expect(analyze(schemaDefinition([
      relationOne("posts", "optionalAuthor", "users", "posts", true),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("must be a required ID"),
    });

    await expect(analyze(schemaDefinition([
      relationMany("posts", "author", "users", "posts"),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("must be a required array of IDs"),
    });
  });

  it("rejects missing tables and source fields", async () => {
    await expect(analyze(schemaDefinition([
      relationOne("missing", "author", "users", "posts", true),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("source table \"missing\" does not exist"),
    });

    await expect(analyze(schemaDefinition([
      relationOne("posts", "missing", "users", "posts", true),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("posts.missing does not exist"),
    });

    await expect(analyze(schemaDefinition([
      relationOne("posts", "author", "missing", "posts", true),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("target table \"missing\" does not exist"),
    });
  });

  it("rejects duplicate source paths and inverse-name conflicts", async () => {
    await expect(analyze(schemaDefinition([
      relationOne("posts", "author", "users", "posts", true),
      relationOne("posts", "author", "users", "authoredPosts", true),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("posts.author is declared more than once"),
    });

    await expect(analyze(schemaDefinition([
      relationOne("posts", "author", "users", "name", true),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("collides with a field"),
    });

    await expect(analyze(schemaDefinition([
      relationOne("posts", "author", "users", "posts", true),
      relationMany("posts", "reviewers", "users", "posts"),
    ]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("declared more than once for target table"),
    });
  });

  it("strictly rejects unsupported future relation shapes", async () => {
    await expect(analyze(schemaDefinition([{
      ...relationOne("posts", "author", "users", "posts", true),
      populated: true,
    }]))).rejects.toMatchObject({
      _tag: "ApplicationRelationAnalysisError",
      message: expect.stringContaining("do not match Relation Declaration V1"),
    });
  });

  it("rejects an oversized declaration set before reading any member", () => {
    const relations = new Array<unknown>(
      APPLICATION_ANALYSIS_MAXIMUM_RELATIONS + 1,
    );
    let getterCalls = 0;
    Object.defineProperty(relations, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return relationOne("posts", "author", "users", "posts", true);
      },
    });

    expect(analyzeApplicationRelationDeclarationsResult(relations, {
      tables: [],
    })).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "relationLimitExceeded",
        observed: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
      },
    });
    expect(getterCalls).toBe(0);
  });

  it("maps a throwing relation getter once into AnalyzerSchemaError", async () => {
    const nativeFailure = new Error("relation getter failed");
    const schema = schemaDefinition([]);
    Object.defineProperty(schema, "relations", {
      enumerable: true,
      get() {
        throw nativeFailure;
      },
    });

    await expect(analyze(schema)).rejects.toMatchObject({
      _tag: "AnalyzerSchemaError",
      cause: nativeFailure,
    });
  });
});

async function analyze(schemaDefinitionInput: unknown) {
  return Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({
    executionModules: {},
    schemaDefinition: schemaDefinitionInput,
    sourceMaps: {},
  }));
}

function schemaDefinition(relations: ReadonlyArray<unknown>) {
  return {
    tables: {
      posts: schemaTable({
        author: idField("users", false),
        optionalAuthor: idField("users", true),
        reviewers: {
          fieldType: { type: "array", value: { type: "id", tableName: "users" } },
          optional: false,
        },
      }),
      users: schemaTable({
        name: { fieldType: { type: "string" }, optional: false },
      }),
    },
    relations,
  };
}

function schemaTable(
  fields: Record<string, { readonly fieldType: ValidatorJSON; readonly optional: boolean }>,
) {
  return {
    kind: "table",
    validator: {
      isFlarexValidator: true,
      json: { type: "object", value: fields },
    },
    indexes: [],
  };
}

function idField(
  tableName: string,
  optional: boolean,
){
  return {
    fieldType: { type: "id", tableName },
    optional,
  } as const;
}

function relationOne(
  sourceTable: string,
  field: string,
  targetTable: string,
  inverseName: string | null,
  required: boolean,
) {
  return {
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: sourceTable,
      path: [{ kind: "field", name: field }],
      forwardName: field,
    },
    target: { table: targetTable },
    value: { cardinality: "one", required },
    inverse: { cardinality: "many", name: inverseName },
    localized: false,
    onTargetDelete: "restrict",
  } as const;
}

function relationMany(
  sourceTable: string,
  field: string,
  targetTable: string,
  inverseName: string | null,
) {
  return {
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: sourceTable,
      path: [{ kind: "field", name: field }],
      forwardName: field,
    },
    target: { table: targetTable },
    value: {
      cardinality: "many",
      minItems: 0,
      maxItems: 32,
      ordered: true,
      duplicates: "forbid",
    },
    inverse: { cardinality: "many", name: inverseName },
    localized: false,
    onTargetDelete: "restrict",
  } as const;
}
