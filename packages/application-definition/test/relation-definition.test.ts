import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  defineApplication,
  defineModule,
  defineRelation,
  defineSchema,
  defineTable,
  prepareApplication,
  produceApplicationSource,
  type ApplicationPreparationPolicy,
  type RelationDefinition,
  query,
  sourceModule,
  v,
} from "../src/index.js";

const PREPARATION_POLICY = Object.freeze({
  maximumModules: 2,
  maximumFunctions: 4,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 128,
  maximumValidatorDepth: 16,
  maximumValidatorStringUtf8Bytes: 4_096,
  maximumSourceBytes: 8_192,
  maximumSourceMapBytes: 4_096,
  maximumBytesMaterialized: 64_000,
  maximumSemanticRecords: 64,
  maximumSemanticRecordBytes: 8_000,
  maximumSemanticStreamBytes: 32_000,
}) satisfies ApplicationPreparationPolicy;

describe("Application relation definition", () => {
  it("owns typed one and many relations and lowers the existing exact contract", () => {
    const schema = relationSchema();
    const author = defineRelation(schema, {
      source: { table: "posts", field: "author" },
      target: { table: "users" },
      value: { cardinality: "one", required: false },
      inverse: { name: "posts" },
      onTargetDelete: "restrict",
    });
    const collaborators = defineRelation(schema, {
      source: { table: "posts", field: "collaborators" },
      target: { table: "users" },
      value: {
        cardinality: "many",
        minItems: 0,
        maxItems: 8,
        ordered: true,
      },
      inverse: { name: "collaboratingPosts" },
      onTargetDelete: "restrict",
    });
    expectTypeOf(author).toEqualTypeOf<RelationDefinition<typeof schema>>();
    expect(Object.keys(author)).toEqual([]);

    const authoredRelations = [collaborators, author];
    const application = defineApplication({
      schema,
      modules: [emptyModule()],
      relations: authoredRelations,
    });
    authoredRelations.length = 0;

    expect(application.relations).toHaveLength(2);
    expect(Object.isFrozen(application.relations)).toBe(true);
    const prepared = Result.getOrThrow(
      prepareApplication(application, PREPARATION_POLICY),
    );
    const source = Result.getOrThrow(produceApplicationSource(prepared));
    const schemaModule = source.modules.find(module =>
      module.path === "_flarex/schema.js"
    );
    expect(schemaModule).toBeDefined();
    const generated = new TextDecoder().decode(schemaModule?.sourceBytes);
    expect(generated).toContain(
      '"source":{"forwardName":"author","path":[{"kind":"field","name":"author"}],"table":"posts"}',
    );
    expect(generated).toContain(
      '"value":{"cardinality":"one","required":false}',
    );
    expect(generated).toContain(
      '"value":{"cardinality":"many","duplicates":"forbid","maxItems":8,"minItems":0,"ordered":true}',
    );
    expect(generated).not.toContain("relation-declaration/v2");
  });

  it("rejects duplicate handles through the existing Standard preparation error", () => {
    const schema = relationSchema();
    const author = defineRelation(schema, {
      source: { table: "posts", field: "author" },
      target: { table: "users" },
      value: { cardinality: "one", required: false },
      inverse: { name: "posts" },
      onTargetDelete: "restrict",
    });
    const result = prepareApplication(defineApplication({
      schema,
      modules: [emptyModule()],
      relations: [author, author],
    }), PREPARATION_POLICY);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "StandardApplicationRelationDefinitionError",
        operation: "prepare",
        reason: "duplicateDeclaration",
      });
    }
  });

  it("rejects a relation handle owned by a different schema", () => {
    const schema = relationSchema();
    const otherSchema = relationSchema();
    const author = defineRelation(otherSchema, {
      source: { table: "posts", field: "author" },
      target: { table: "users" },
      value: { cardinality: "one", required: false },
      inverse: { name: "posts" },
      onTargetDelete: "restrict",
    });

    expect(() => defineApplication({
      schema,
      modules: [],
      relations: [author],
    })).toThrow("Relation definition belongs to a different schema.");
  });

  it("makes unsupported and schema-incompatible shapes unavailable", () => {
    const schema = relationSchema();
    if (false) {
      defineRelation(schema, {
        // @ts-expect-error Relation source fields must exist on the source table.
        source: { table: "posts", field: "missing" },
        target: { table: "users" },
        value: { cardinality: "one", required: false },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      defineRelation(schema, {
        source: { table: "posts", field: "author" },
        target: { table: "users" },
        // @ts-expect-error Optional ID fields require optional one cardinality.
        value: { cardinality: "one", required: true },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      defineRelation(schema, {
        source: { table: "posts", field: "collaborators" },
        target: { table: "users" },
        // @ts-expect-error Array ID fields require many cardinality and bounds.
        value: { cardinality: "one", required: true },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      // @ts-expect-error Many relation fields must be required arrays.
      defineRelation(schema, {
        source: { table: "posts", field: "optionalCollaborators" },
        target: { table: "users" },
        value: {
          cardinality: "many",
          minItems: 0,
          maxItems: 8,
          ordered: true,
        },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      defineRelation(schema, {
        source: { table: "posts", field: "title" },
        target: { table: "users" },
        // @ts-expect-error Scalar string fields cannot define relations.
        value: { cardinality: "one", required: true },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      defineRelation(schema, {
        source: { table: "posts", field: "unionAuthor" },
        target: { table: "users" },
        // @ts-expect-error Union-wrapped IDs are not direct relation fields.
        value: { cardinality: "one", required: true },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      // @ts-expect-error Union-wrapped arrays are not direct relation fields.
      defineRelation(schema, {
        source: { table: "posts", field: "unionCollaborators" },
        target: { table: "users" },
        value: {
          cardinality: "many",
          minItems: 0,
          maxItems: 8,
          ordered: true,
        },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      defineRelation(schema, {
        source: { table: "posts", field: "author" },
        // @ts-expect-error Relation targets must match the direct ID validator.
        target: { table: "posts" },
        value: { cardinality: "one", required: false },
        inverse: { name: null },
        onTargetDelete: "restrict",
      });
      defineRelation(schema, {
        source: { table: "posts", field: "author" },
        target: { table: "users" },
        value: { cardinality: "one", required: false },
        inverse: { name: null },
        // @ts-expect-error Detach and cascade policies are not admitted.
        onTargetDelete: "cascade",
      });
    }
  });
});

function relationSchema() {
  return defineSchema({
    posts: defineTable({
      author: v.optional(v.id("users")),
      collaborators: v.array(v.id("users")),
      optionalCollaborators: v.optional(v.array(v.id("users"))),
      title: v.string(),
      unionAuthor: v.union(v.id("users"), v.id("users")),
      unionCollaborators: v.union(
        v.array(v.id("users")),
        v.array(v.id("users")),
      ),
    }),
    users: defineTable({ name: v.string() }),
  });
}

function emptyModule() {
  return defineModule({
    path: "empty",
    source: sourceModule({
      path: "functions/empty.js",
      bytes: new TextEncoder().encode("export const read = () => null;\n"),
    }),
    functions: {
      read: query({
        args: v.object({}),
        returns: v.null(),
      }),
    },
  });
}
