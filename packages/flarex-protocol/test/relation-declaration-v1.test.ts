import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  canonicalizeRelationDeclarationV1Result,
  compareRelationDeclarationsV1,
  decodeRelationDeclarationV1Result,
  decodeRelationDeclarationsV1Result,
  MAX_RELATION_DECLARATION_CANONICAL_BYTES_V1,
  MAX_RELATION_DECLARATIONS_V1,
  MAX_RELATION_IDENTITY_CODE_UNITS_V1,
  MAX_RELATION_MANY_ITEMS_V1,
  RelationDeclarationV1Error,
  type RelationDeclarationV1,
  type RelationIdentityV1,
  type RelationSourcePathV1,
} from "../src/relation-declaration-v1";

describe("relation declaration V1", () => {
  it("decodes one and many declarations into owned immutable values", () => {
    const oneInput = declaration({
      value: { cardinality: "one", required: true },
    });
    const one = success(decodeRelationDeclarationV1Result(oneInput));
    const many = success(decodeRelationDeclarationV1Result(declaration({
      forwardName: "reviewers",
      targetTable: "users",
      value: {
        cardinality: "many",
        minItems: 1,
        maxItems: MAX_RELATION_MANY_ITEMS_V1,
        ordered: true,
        duplicates: "forbid",
      },
    })));
    const unnamedInverse = success(decodeRelationDeclarationV1Result(
      declaration({ inverseName: null }),
    ));

    oneInput.source.path[0]!.name = "changed";
    oneInput.source.forwardName = "changed";

    expect(one.source.path).toEqual([{ kind: "field", name: "author" }]);
    expect(one.value).toEqual({ cardinality: "one", required: true });
    expect(many.value).toEqual({
      cardinality: "many",
      minItems: 1,
      maxItems: MAX_RELATION_MANY_ITEMS_V1,
      ordered: true,
      duplicates: "forbid",
    });
    expect(unnamedInverse.inverse.name).toBeNull();
    expect(Object.isFrozen(one)).toBe(true);
    expect(Object.isFrozen(one.source)).toBe(true);
    expect(Object.isFrozen(one.source.path)).toBe(true);
    expect(Object.isFrozen(one.source.path[0])).toBe(true);
  });

  it("pins canonical JSON, byte ownership, and deterministic comparison", () => {
    const first = success(canonicalizeRelationDeclarationV1Result(
      declaration({ value: { cardinality: "one", required: false } }),
    ));
    const reordered = success(canonicalizeRelationDeclarationV1Result({
      version: 1,
      target: { table: "users" },
      source: {
        path: [{ name: "author", kind: "field" }],
        forwardName: "author",
        table: "posts",
      },
      onTargetDelete: "restrict",
      localized: false,
      inverse: { name: "posts", cardinality: "many" },
      format: "flarex.relation-declaration",
      value: { required: false, cardinality: "one" },
    }));
    const other = success(canonicalizeRelationDeclarationV1Result(
      declaration({
        forwardName: "editor",
        inverseName: "editedPosts",
        value: { cardinality: "one", required: false },
      }),
    ));

    expect(first.canonicalText).toBe(
      '{"format":"flarex.relation-declaration","inverse":{"cardinality":"many","name":"posts"},"localized":false,"onTargetDelete":"restrict","source":{"forwardName":"author","path":[{"kind":"field","name":"author"}],"table":"posts"},"target":{"table":"users"},"value":{"cardinality":"one","required":false},"version":1}',
    );
    expect(reordered.canonicalText).toBe(first.canonicalText);
    expect(first.canonicalBytes.byteLength).toBeLessThanOrEqual(
      MAX_RELATION_DECLARATION_CANONICAL_BYTES_V1,
    );
    const mutatedBytes = first.canonicalBytes;
    mutatedBytes.fill(0);
    expect(new TextDecoder().decode(first.canonicalBytes)).toBe(
      first.canonicalText,
    );
    expect(compareRelationDeclarationsV1(
      first.declaration,
      reordered.declaration,
    )).toBe(0);
    expect(Math.sign(compareRelationDeclarationsV1(
      first.declaration,
      other.declaration,
    ))).toBe(-Math.sign(compareRelationDeclarationsV1(
      other.declaration,
      first.declaration,
    )));
  });

  it("rejects excess keys and every representative future relation shape", () => {
    const candidates: ReadonlyArray<unknown> = [
      { ...declaration(), future: true },
      {
        ...declaration(),
        source: { ...declaration().source, future: true },
      },
      {
        ...declaration(),
        source: {
          ...declaration().source,
          path: [{ kind: "field", name: "author", future: true }],
        },
      },
      {
        ...declaration(),
        source: {
          ...declaration().source,
          path: [{ kind: "arrayItems" }],
        },
      },
      {
        ...declaration(),
        source: {
          ...declaration().source,
          path: [{ kind: "field", name: "different" }],
        },
      },
      { ...declaration(), target: { tables: ["users", "teams"] } },
      { ...declaration(), inverse: { cardinality: "one", name: "post" } },
      { ...declaration(), localized: true },
      { ...declaration(), onTargetDelete: "detach" },
      {
        ...declaration(),
        value: {
          cardinality: "many",
          minItems: 0,
          maxItems: 10,
          ordered: false,
          duplicates: "allow",
        },
      },
    ];

    for (const candidate of candidates) {
      const decoded = decodeRelationDeclarationV1Result(candidate);
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        expect(decoded.failure).toBeInstanceOf(RelationDeclarationV1Error);
        expect([
          "invalidDeclaration",
          "invalidOwnData",
        ]).toContain(decoded.failure.issue.reason);
      }
    }
  });

  it("returns tagged failures for hostile or non-exact own-data shapes", () => {
    const declarationsWithExtra = [declaration()];
    Object.assign(declarationsWithExtra, { future: true });
    const pathWithExtra = declaration();
    Object.assign(pathWithExtra.source.path, { future: true });
    const accessor = declaration();
    let getterCalls = 0;
    Object.defineProperty(accessor.source, "table", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "posts";
      },
    });
    const reflectionFailure = new Error("ownKeys denied");
    const trapped = new Proxy(declaration(), {
      ownKeys() {
        throw reflectionFailure;
      },
    });
    const cyclic = declaration();
    expect(Reflect.set(cyclic, "source", cyclic)).toBe(true);

    for (const result of [
      decodeRelationDeclarationsV1Result(declarationsWithExtra),
      decodeRelationDeclarationV1Result(pathWithExtra),
      decodeRelationDeclarationV1Result(accessor),
      decodeRelationDeclarationV1Result(trapped),
      decodeRelationDeclarationV1Result(cyclic),
    ]) {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "RelationDeclarationV1Error",
          issue: { reason: "invalidOwnData" },
        },
      });
    }
    expect(getterCalls).toBe(0);
    const trappedResult = decodeRelationDeclarationV1Result(trapped);
    expect(trappedResult).toMatchObject({
      _tag: "Failure",
      failure: { issue: { cause: reflectionFailure } },
    });
  });

  it("enforces identity, cardinality, and declaration-count ceilings", () => {
    for (const candidate of [
      declaration({ sourceTable: "" }),
      declaration({ sourceTable: "x".repeat(
        MAX_RELATION_IDENTITY_CODE_UNITS_V1 + 1,
      ) }),
      declaration({
        value: {
          cardinality: "many",
          minItems: 2,
          maxItems: 1,
          ordered: false,
          duplicates: "forbid",
        },
      }),
      declaration({
        value: {
          cardinality: "many",
          minItems: 0,
          maxItems: MAX_RELATION_MANY_ITEMS_V1 + 1,
          ordered: false,
          duplicates: "forbid",
        },
      }),
    ]) {
      expect(Result.isFailure(decodeRelationDeclarationV1Result(candidate)))
        .toBe(true);
    }

    const maximum = Array.from(
      { length: MAX_RELATION_DECLARATIONS_V1 },
      () => declaration(),
    );
    expect(success(decodeRelationDeclarationsV1Result(maximum))).toHaveLength(
      MAX_RELATION_DECLARATIONS_V1,
    );
    const exceeded = decodeRelationDeclarationsV1Result([
      ...maximum,
      declaration(),
    ]);
    expect(Result.isFailure(exceeded)).toBe(true);
    if (Result.isFailure(exceeded)) {
      expect(exceeded.failure.issue).toEqual({
        reason: "declarationLimitExceeded",
        observed: MAX_RELATION_DECLARATIONS_V1 + 1,
        maximum: MAX_RELATION_DECLARATIONS_V1,
      });
    }

    const maximumEscapedIdentity = "\0".repeat(
      MAX_RELATION_IDENTITY_CODE_UNITS_V1,
    );
    const maximumEscapedDeclaration = success(
      canonicalizeRelationDeclarationV1Result(declaration({
        sourceTable: maximumEscapedIdentity,
        forwardName: maximumEscapedIdentity,
        targetTable: maximumEscapedIdentity,
        inverseName: maximumEscapedIdentity,
        value: {
          cardinality: "many",
          minItems: 0,
          maxItems: MAX_RELATION_MANY_ITEMS_V1,
          ordered: true,
          duplicates: "forbid",
        },
      })),
    );
    expect(maximumEscapedDeclaration.canonicalBytes.byteLength)
      .toBeLessThanOrEqual(MAX_RELATION_DECLARATION_CANONICAL_BYTES_V1);
  });

  it("keeps identities and source paths nominal and exact", () => {
    expectTypeOf<RelationIdentityV1>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<RelationIdentityV1>();
    expectTypeOf<RelationSourcePathV1>().toEqualTypeOf<readonly [{
      readonly kind: "field";
      readonly name: RelationIdentityV1;
    }]>();
    expectTypeOf<RelationDeclarationV1["source"]["path"]>()
      .toEqualTypeOf<RelationSourcePathV1>();
  });
});

interface DeclarationOverrides {
  readonly sourceTable?: string;
  readonly forwardName?: string;
  readonly targetTable?: string;
  readonly inverseName?: string | null;
  readonly value?:
    | { readonly cardinality: "one"; readonly required: boolean }
    | {
        readonly cardinality: "many";
        readonly minItems: number;
        readonly maxItems: number;
        readonly ordered: boolean;
        readonly duplicates: string;
      };
}

function declaration(overrides: DeclarationOverrides = {}) {
  const forwardName = overrides.forwardName ?? "author";
  return {
    format: "flarex.relation-declaration" as const,
    version: 1 as const,
    source: {
      table: overrides.sourceTable ?? "posts",
      path: [{ kind: "field" as const, name: forwardName }],
      forwardName,
    },
    target: { table: overrides.targetTable ?? "users" },
    value: overrides.value ?? { cardinality: "one" as const, required: false },
    inverse: {
      cardinality: "many" as const,
      name: overrides.inverseName === undefined ? "posts" : overrides.inverseName,
    },
    localized: false as const,
    onTargetDelete: "restrict" as const,
  };
}

function success<A, E>(result: Result.Result<A, E>): A {
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
