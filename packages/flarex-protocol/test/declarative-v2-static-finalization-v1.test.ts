import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
} from "../src/declarative-v2-verifier-progress-v2";
import {
  decodeDeclarativeV2ProjectionPairV1,
  decodeDeclarativeV2StaticFinalizationV1,
  decodeDeclarativeV2StaticVerificationCompletionV1,
  encodeDeclarativeV2ProjectionPairV1,
  encodeDeclarativeV2StaticFinalizationV1,
  encodeDeclarativeV2StaticVerificationCompletionV1,
  type DeclarativeV2StaticFinalizationFrameV1,
  type DeclarativeV2StaticVerificationCompletionFrameV1,
} from "../src/declarative-v2-static-finalization-v1";

const budget = Object.freeze({
  maximumFrameBytes: 100_000,
  maximumCanonicalBytes: 100_000,
});

describe("Declarative V2 C3 completion and static finalization", () => {
  it("pins independently framed verified completion and static evidence", async () => {
    const completion = verifiedCompletion();
    const encodedCompletion = Result.getOrThrow(
      encodeDeclarativeV2StaticVerificationCompletionV1(
        completion,
        budget,
      ),
    );
    const expectedCompletion = completionOracle(completion);
    expect(encodedCompletion.canonicalBytes).toEqual(expectedCompletion);
    expect(hex(await sha256(expectedCompletion))).toBe(
      "9621463185cc1b984a1ccc74b7f0191bcbba99a105add678257182aa70a3d821",
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2StaticVerificationCompletionV1(
        expectedCompletion,
        budget,
      ),
    ).frame).toEqual(completion);

    const staticFrame = verifiedStaticFinalization();
    const encodedStatic = Result.getOrThrow(
      encodeDeclarativeV2StaticFinalizationV1(staticFrame, budget),
    );
    const expectedStatic = staticFinalizationOracle(staticFrame);
    expect(encodedStatic.canonicalBytes).toEqual(expectedStatic);
    expect(hex(await sha256(expectedStatic))).toBe(
      "1bf529054996cfdee619f6bc0a9917c840939607e81efdd100d538cb57edfabe",
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2StaticFinalizationV1(expectedStatic, budget),
    ).frame).toEqual(staticFrame);
  });

  it("enforces verified/invalid cross-fields and signed-int64 bounds", () => {
    const invalid = {
      ...verifiedCompletion(),
      status: "invalid",
      failureCode: "unsupported_syntax",
      handlerSetSha256: null,
      registrationRootSha256: null,
    } as const;
    expect(Result.isSuccess(
      encodeDeclarativeV2StaticVerificationCompletionV1(invalid, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2StaticVerificationCompletionV1({
        ...invalid,
        handlerSetSha256: digest(22),
      }, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2StaticVerificationCompletionV1({
        ...verifiedCompletion(),
        moduleCount: 9_223_372_036_854_775_808n,
      }, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2StaticFinalizationV1({
        ...verifiedStaticFinalization(),
        status: "invalid",
        failureCode: " ",
        handlerSetSha256: null,
        registrationRootSha256: null,
        deploymentAnalysisProjectionSha256: null,
        deploymentCodegenAnalysisProjectionSha256: null,
      }, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2StaticVerificationCompletionV1({
        ...invalid,
        failureCode: "\ud800",
      }, budget),
    )).toBe(true);
  });

  it("pins canonical projection JSON, parity, ordering, omission, and null policy", async () => {
    const input = emptyProjectionPair();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2ProjectionPairV1(input, budget),
    );
    const analysisText =
      "{\"functions\":{\"functions\":[]},\"schema\":{\"indexes\":[],\"tables\":[],\"version\":1}}";
    const codegenText =
      "{\"functions\":[],\"schema\":{\"indexes\":[],\"tables\":[],\"version\":1}}";
    expect(new TextDecoder().decode(
      encoded.deploymentAnalysisCanonicalBytes,
    )).toBe(analysisText);
    expect(new TextDecoder().decode(
      encoded.deploymentCodegenAnalysisCanonicalBytes,
    )).toBe(codegenText);
    expect(hex(await sha256(
      encoded.deploymentAnalysisCanonicalBytes,
    ))).toBe("7cec7168efc65bad8a02e0bfdd9da5539ce422a1abe0026343120fec2b280de0");
    expect(hex(await sha256(
      encoded.deploymentCodegenAnalysisCanonicalBytes,
    ))).toBe("07a4b90100d0a7d6e5b8aa7c4f13f647c7ea459607616732ec94752edcc7b73a");
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2ProjectionPairV1({
        deploymentAnalysisCanonicalBytes:
          encoded.deploymentAnalysisCanonicalBytes,
        deploymentCodegenAnalysisCanonicalBytes:
          encoded.deploymentCodegenAnalysisCanonicalBytes,
      }, {
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
      }),
    );
    expect(decoded.deploymentAnalysis).toEqual(input.deploymentAnalysis);
    expect(decoded.deploymentCodegenAnalysis).toEqual(
      input.deploymentCodegenAnalysis,
    );
    encoded.deploymentAnalysisCanonicalBytes[0] ^= 0xff;
    expect(decoded.deploymentAnalysisCanonicalBytes[0]).toBe(
      new TextEncoder().encode(analysisText)[0],
    );
    expect(Result.isFailure(
      decodeDeclarativeV2ProjectionPairV1({
        deploymentAnalysisCanonicalBytes:
          decoded.deploymentAnalysisCanonicalBytes,
        deploymentCodegenAnalysisCanonicalBytes:
          decoded.deploymentCodegenAnalysisCanonicalBytes,
      }, {
        maximumFrameBytes: decoded.usage.frameBytes - 1,
        maximumCanonicalBytes: decoded.usage.canonicalBytes,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeclarativeV2ProjectionPairV1({
        deploymentAnalysisCanonicalBytes:
          decoded.deploymentAnalysisCanonicalBytes,
        deploymentCodegenAnalysisCanonicalBytes:
          decoded.deploymentCodegenAnalysisCanonicalBytes,
      }, {
        maximumFrameBytes: decoded.usage.frameBytes,
        maximumCanonicalBytes: decoded.usage.canonicalBytes - 1,
      }),
    )).toBe(true);
    const nonCanonicalAnalysis = new TextEncoder().encode(
      "{\"schema\":{\"version\":1,\"tables\":[],\"indexes\":[]},\"functions\":{\"functions\":[]}}",
    );
    expect(Result.isFailure(
      decodeDeclarativeV2ProjectionPairV1({
        deploymentAnalysisCanonicalBytes: nonCanonicalAnalysis,
        deploymentCodegenAnalysisCanonicalBytes:
          encoded.deploymentCodegenAnalysisCanonicalBytes,
      }, budget),
    )).toBe(true);

    const nonempty = functionProjectionPair();
    const encodedNonempty = Result.getOrThrow(
      encodeDeclarativeV2ProjectionPairV1(nonempty, budget),
    );
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(nonempty, {
        maximumFrameBytes: encodedNonempty.usage.frameBytes - 1,
        maximumCanonicalBytes: encodedNonempty.usage.canonicalBytes,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(nonempty, {
        maximumFrameBytes: encodedNonempty.usage.frameBytes,
        maximumCanonicalBytes: encodedNonempty.usage.canonicalBytes - 1,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1({
        ...nonempty,
        deploymentCodegenAnalysis: {
          ...nonempty.deploymentCodegenAnalysis,
          functions: [{
            ...nonempty.deploymentCodegenAnalysis.functions[0]!,
            functions: [{
              ...nonempty.deploymentCodegenAnalysis.functions[0]!.functions[0]!,
              args: { type: "string" },
            }],
          }],
        },
      }, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1({
        ...nonempty,
        deploymentAnalysis: {
          ...nonempty.deploymentAnalysis,
          functions: {
            functions: [{
              ...nonempty.deploymentAnalysis.functions.functions[0]!,
              position: {
                path: "ignored.mjs",
                startLine: 1,
                startColumn: 1,
              },
            }],
          },
        },
      }, budget),
    )).toBe(true);

    expect(Result.isSuccess(
      encodeDeclarativeV2ProjectionPairV1(
        crossModuleProjectionPair(),
        budget,
      ),
    )).toBe(true);
    const encodedProto = Result.getOrThrow(
      encodeDeclarativeV2ProjectionPairV1(
        protoFieldProjectionPair(),
        budget,
      ),
    );
    expect(new TextDecoder().decode(
      encodedProto.deploymentAnalysisCanonicalBytes,
    )).toContain("\"__proto__\"");
    expect(Result.isSuccess(
      decodeDeclarativeV2ProjectionPairV1({
        deploymentAnalysisCanonicalBytes:
          encodedProto.deploymentAnalysisCanonicalBytes,
        deploymentCodegenAnalysisCanonicalBytes:
          encodedProto.deploymentCodegenAnalysisCanonicalBytes,
      }, budget),
    )).toBe(true);
    expect(Result.isSuccess(
      encodeDeclarativeV2ProjectionPairV1(
        escapedProjectionPair(),
        budget,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(
        nullTableValidatorProjectionPair(),
        budget,
      ),
    )).toBe(true);
    for (const invalid of [
      schemaProjectionPair({ tableId: -1 }),
      schemaProjectionPair({ tableName: "" }),
      schemaProjectionPair({ indexId: -2 }),
      schemaProjectionPair({ indexTableId: 999 }),
      schemaProjectionPair({ indexName: "" }),
    ]) {
      expect(Result.isFailure(
        encodeDeclarativeV2ProjectionPairV1(invalid, budget),
      )).toBe(true);
    }
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(
        invalidPartitionProjectionPair(),
        budget,
      ),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1({
        ...emptyProjectionPair(),
        deploymentCodegenAnalysis: {
          ...emptyProjectionPair().deploymentCodegenAnalysis,
          functions: [{ moduleName: "helper.mjs", functions: [] }],
        },
      }, budget),
    )).toBe(true);

    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1({
        ...emptyProjectionPair(),
        extra: true,
      }, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1({
        ...emptyProjectionPair(),
        deploymentAnalysis: {
          ...emptyProjectionPair().deploymentAnalysis,
          schema: {
            ...emptyProjectionPair().deploymentAnalysis.schema,
            extra: true,
          },
        },
      }, budget),
    )).toBe(true);
    expect(Result.isFailure(
      decodeDeclarativeV2ProjectionPairV1({
        deploymentAnalysisCanonicalBytes: new TextEncoder().encode(
          "{\"extra\":true,\"functions\":{\"functions\":[]},\"schema\":{\"indexes\":[],\"tables\":[],\"version\":1}}",
        ),
        deploymentCodegenAnalysisCanonicalBytes:
          encoded.deploymentCodegenAnalysisCanonicalBytes,
      }, budget),
    )).toBe(true);
  });

  it("preflights exact/+1, rejects hostile inputs, and isolates aliases", () => {
    const source = verifiedCompletion();
    const exact = Result.getOrThrow(
      encodeDeclarativeV2StaticVerificationCompletionV1(source, budget),
    );
    expect(Result.isSuccess(
      encodeDeclarativeV2StaticVerificationCompletionV1(source, {
        maximumFrameBytes: exact.usage.frameBytes,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2StaticVerificationCompletionV1(source, {
        maximumFrameBytes: exact.usage.frameBytes - 1,
        maximumCanonicalBytes: 0,
      }),
    )).toBe(true);
    source.attemptSha256[0] = 99;
    expect(exact.frame.attemptSha256[0]).toBe(1);

    const hostile = {
      ...emptyProjectionPair(),
      get deploymentAnalysis() {
        throw new Error("must not be invoked");
      },
    };
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(hostile, budget),
    )).toBe(true);

    const withSymbol = {
      ...emptyProjectionPair(),
      [Symbol("extra")]: true,
    };
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(withSymbol, budget),
    )).toBe(true);
    const nonEnumerable = { ...emptyProjectionPair() };
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(nonEnumerable, budget),
    )).toBe(true);
    const hostileProxy = new Proxy(emptyProjectionPair(), {
      ownKeys() {
        throw new Error("must not escape");
      },
    });
    expect(Result.isFailure(
      encodeDeclarativeV2ProjectionPairV1(hostileProxy, budget),
    )).toBe(true);

    let postLimitGetterReads = 0;
    const overBudgetBeforeGetter = {
      deploymentAnalysis: {
        schema: {
          version: "x".repeat(1_000),
          get tables() {
            postLimitGetterReads += 1;
            throw new Error("must not be reached after admission failure");
          },
          indexes: [],
        },
        functions: { functions: [] },
      },
      deploymentCodegenAnalysis:
        emptyProjectionPair().deploymentCodegenAnalysis,
    };
    const preallocationFailure = encodeDeclarativeV2ProjectionPairV1(
      overBudgetBeforeGetter,
      { maximumFrameBytes: 10, maximumCanonicalBytes: 10 },
    );
    expect(Result.isFailure(preallocationFailure)).toBe(true);
    if (Result.isFailure(preallocationFailure)) {
      expect(preallocationFailure.failure.reason).toBe(
        "canonicalBytesExceeded",
      );
    }
    expect(postLimitGetterReads).toBe(0);

    const valid = exact.canonicalBytes;
    for (let boundary = 0; boundary < valid.byteLength; boundary += 1) {
      expect(Result.isFailure(
        decodeDeclarativeV2StaticVerificationCompletionV1(
          valid.subarray(0, boundary),
          budget,
        ),
      )).toBe(true);
    }
    expect(Result.isFailure(
      decodeDeclarativeV2StaticVerificationCompletionV1(
        concat(valid, new Uint8Array([0])),
        budget,
      ),
    )).toBe(true);
  });

  it("keeps static contracts off the package root", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-static-finalization-v1",
      "./src/declarative-v2-static-finalization-v1.ts",
    );
    expect(root).not.toHaveProperty(
      "encodeDeclarativeV2StaticVerificationCompletionV1",
    );
  });
});

function verifiedCompletion(): DeclarativeV2StaticVerificationCompletionFrameV1 {
  return {
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    semanticAttemptIdentitySha256: digest(3),
    semanticSelectorSha256: digest(4),
    verifierProgressProtocolIdentity:
      DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
    verifierBudgetProtocolIdentity:
      DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
    ceilingsSha256: digest(5),
    usageSha256: digest(6),
    sourceTailSha256: digest(7),
    parseTailSha256: digest(8),
    linkTailSha256: digest(9),
    registrationTailSha256: digest(10),
    lastReceiptSha256: digest(11),
    moduleCount: 12n,
    importEdgeCount: 13n,
    registrationCount: 14n,
    diagnosticCount: 15n,
    diagnosticRootSha256: digest(16),
    status: "verified",
    failureCode: null,
    handlerSetSha256: digest(17),
    registrationRootSha256: digest(18),
  };
}

function verifiedStaticFinalization(): DeclarativeV2StaticFinalizationFrameV1 {
  return {
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    completionSha256: digest(19),
    semanticAttemptIdentitySha256: digest(3),
    status: "verified",
    failureCode: null,
    diagnosticRootSha256: digest(16),
    handlerSetSha256: digest(17),
    registrationRootSha256: digest(18),
    deploymentAnalysisProjectionSha256: digest(20),
    deploymentCodegenAnalysisProjectionSha256: digest(21),
  };
}

function emptyProjectionPair() {
  return {
    deploymentAnalysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: { functions: [] },
    },
    deploymentCodegenAnalysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: [],
    },
  } as const;
}

function functionProjectionPair() {
  const schema = { version: 1, tables: [], indexes: [] } as const;
  return {
    deploymentAnalysis: {
      schema,
      functions: {
        functions: [{
          path: "module.mjs",
          kind: "query",
          visibility: "public",
          args: { type: "any" },
          returns: null,
          route: null,
          partition: null,
        }],
      },
    },
    deploymentCodegenAnalysis: {
      schema,
      functions: [{
        moduleName: "module.mjs",
        functions: [{
          moduleName: "module.mjs",
          exportName: "default",
          kind: "query",
          visibility: "public",
          args: { type: "any" },
          returns: null,
          partition: null,
        }],
      }],
    },
  } as const;
}

function crossModuleProjectionPair() {
  const schema = { version: 1, tables: [], indexes: [] } as const;
  const first = functionProjection("a0", "a0", "default");
  const second = functionProjection("a:z", "a", "z");
  return {
    deploymentAnalysis: {
      schema,
      functions: { functions: [first.analysis, second.analysis] },
    },
    deploymentCodegenAnalysis: {
      schema,
      functions: [
        { moduleName: "a", functions: [second.codegen] },
        { moduleName: "a0", functions: [first.codegen] },
      ],
    },
  } as const;
}

function protoFieldProjectionPair() {
  const fields = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(fields, "__proto__", {
    value: {
      fieldType: { type: "string" },
      optional: false,
    },
    enumerable: true,
  });
  const args = { type: "object", value: fields } as const;
  const schema = { version: 1, tables: [], indexes: [] } as const;
  return {
    deploymentAnalysis: {
      schema,
      functions: {
        functions: [{
          ...functionProjection("module.mjs", "module.mjs", "default").analysis,
          args,
        }],
      },
    },
    deploymentCodegenAnalysis: {
      schema,
      functions: [{
        moduleName: "module.mjs",
        functions: [{
          ...functionProjection(
            "module.mjs",
            "module.mjs",
            "default",
          ).codegen,
          args,
        }],
      }],
    },
  } as const;
}

function nullTableValidatorProjectionPair() {
  const schema = {
    version: 1,
    tables: [{
      tableId: 1,
      name: "items",
      validator: null,
      placement: { kind: "global" },
    }],
    indexes: [],
  } as const;
  return {
    deploymentAnalysis: {
      schema,
      functions: { functions: [] },
    },
    deploymentCodegenAnalysis: {
      schema,
      functions: [],
    },
  } as const;
}

function schemaProjectionPair(
  overrides: Readonly<{
    readonly tableId?: number;
    readonly tableName?: string;
    readonly indexId?: number;
    readonly indexTableId?: number;
    readonly indexName?: string;
  }>,
) {
  const tableId = overrides.tableId ?? 1;
  const schema = {
    version: 1,
    tables: [{
      tableId,
      name: overrides.tableName ?? "items",
      validator: { type: "any" },
      placement: { kind: "global" },
    }],
    indexes: [{
      indexId: overrides.indexId ?? 1,
      tableId: overrides.indexTableId ?? tableId,
      name: overrides.indexName ?? "by_name",
      fields: ["name"],
    }],
  } as const;
  return {
    deploymentAnalysis: {
      schema,
      functions: { functions: [] },
    },
    deploymentCodegenAnalysis: {
      schema,
      functions: [],
    },
  } as const;
}

function invalidPartitionProjectionPair() {
  const schema = {
    version: 1,
    tables: [{
      tableId: 1,
      name: "items",
      validator: { type: "any" },
      placement: { kind: "partitionBy", field: "slug" },
    }],
    indexes: [],
  } as const;
  const args = {
    type: "object",
    value: {
      slug: {
        fieldType: { type: "string" },
        optional: false,
      },
    },
  } as const;
  const partition = {
    type: "partition",
    table: "items",
    selector: "wrongSelector",
    partitionField: "slug",
    argField: "slug",
  } as const;
  return {
    deploymentAnalysis: {
      schema,
      functions: {
        functions: [{
          ...functionProjection("module.mjs", "module.mjs", "default").analysis,
          args,
          partition,
        }],
      },
    },
    deploymentCodegenAnalysis: {
      schema,
      functions: [{
        moduleName: "module.mjs",
        functions: [{
          ...functionProjection(
            "module.mjs",
            "module.mjs",
            "default",
          ).codegen,
          args,
          partition,
        }],
      }],
    },
  } as const;
}

function escapedProjectionPair() {
  const pair = functionProjectionPair();
  const args = {
    type: "literal",
    value: "\0\"\\\u2028\ud83d\ude00\ud800",
  } as const;
  return {
    deploymentAnalysis: {
      ...pair.deploymentAnalysis,
      functions: {
        functions: [{
          ...pair.deploymentAnalysis.functions.functions[0]!,
          args,
        }],
      },
    },
    deploymentCodegenAnalysis: {
      ...pair.deploymentCodegenAnalysis,
      functions: [{
        ...pair.deploymentCodegenAnalysis.functions[0]!,
        functions: [{
          ...pair.deploymentCodegenAnalysis.functions[0]!.functions[0]!,
          args,
        }],
      }],
    },
  } as const;
}

function functionProjection(
  path: string,
  moduleName: string,
  exportName: string,
) {
  return {
    analysis: {
      path,
      kind: "query",
      visibility: "public",
      args: { type: "any" },
      returns: null,
      route: null,
      partition: null,
    },
    codegen: {
      moduleName,
      exportName,
      kind: "query",
      visibility: "public",
      args: { type: "any" },
      returns: null,
      partition: null,
    },
  } as const;
}

function completionOracle(
  frame: DeclarativeV2StaticVerificationCompletionFrameV1,
): Uint8Array {
  return concat(
    utf8("flarex.declarative-v2/static_verification_completion/v1\0"),
    u32(22),
    frame.attemptSha256,
    frame.candidateSha256,
    frame.semanticAttemptIdentitySha256,
    frame.semanticSelectorSha256,
    stringFrame(frame.verifierProgressProtocolIdentity),
    stringFrame(frame.verifierBudgetProtocolIdentity),
    frame.ceilingsSha256,
    frame.usageSha256,
    frame.sourceTailSha256,
    frame.parseTailSha256,
    frame.linkTailSha256,
    frame.registrationTailSha256,
    frame.lastReceiptSha256,
    u64(frame.moduleCount),
    u64(frame.importEdgeCount),
    u64(frame.registrationCount),
    u64(frame.diagnosticCount),
    frame.diagnosticRootSha256,
    new Uint8Array([1]),
    new Uint8Array([0]),
    concat(new Uint8Array([1]), frame.handlerSetSha256!),
    concat(new Uint8Array([1]), frame.registrationRootSha256!),
  );
}

function staticFinalizationOracle(
  frame: DeclarativeV2StaticFinalizationFrameV1,
): Uint8Array {
  return concat(
    utf8("flarex.declarative-v2/static_finalization/v1\0"),
    u32(11),
    frame.attemptSha256,
    frame.candidateSha256,
    frame.completionSha256,
    frame.semanticAttemptIdentitySha256,
    new Uint8Array([1]),
    new Uint8Array([0]),
    frame.diagnosticRootSha256,
    concat(new Uint8Array([1]), frame.handlerSetSha256!),
    concat(new Uint8Array([1]), frame.registrationRootSha256!),
    concat(
      new Uint8Array([1]),
      frame.deploymentAnalysisProjectionSha256!,
    ),
    concat(
      new Uint8Array([1]),
      frame.deploymentCodegenAnalysisProjectionSha256!,
    ),
  );
}

function stringFrame(value: string): Uint8Array {
  const bytes = utf8(value);
  return concat(u32(bytes.byteLength), bytes);
}

function digest(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await webcrypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
