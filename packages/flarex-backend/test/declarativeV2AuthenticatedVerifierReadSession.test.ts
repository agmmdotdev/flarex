import {
  createDeclarativeV2VerifierEngineV1,
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  makeDeclarativeV2AuthenticatedReadSessionFactoryV1,
} from "../src/declarativeV2/AuthenticatedVerifierReadSession";
import type {
  SemanticArtifactV1FinalizedContent,
  SemanticArtifactV1FinalizedContentReader,
} from "../src/semanticArtifactV1/FinalizedContentReader";
import type {
  SemanticArtifactV1FinalizedSourceProof,
} from "../src/semanticArtifactV1/FinalizedSourceProof";
import type {
  SemanticArtifactV1FinalizedEvidence,
  SemanticArtifactV1UploadCore,
} from "../src/semanticArtifactV1/UploadCore";
import type {
  SemanticArtifactV1RootConfiguration,
} from "../src/semanticArtifactV1/RootConfiguration";
import {
  makeDeclarativeV2ContentReadBudgetTracker,
  type SourceArtifactV2FinalizedContent,
  type SourceArtifactV2FinalizedContentReader,
} from "../src/sourceArtifactV2/FinalizedContentReader";

describe("Declarative V2 authenticated verifier read session", () => {
  it("claims finalized evidence first and returns only request-local opaque cursors", async () => {
    const fixture = makeSessionFixture();
    const request = new Request("https://private.test/a1b1a");
    const session = await Effect.runPromise(fixture.factory.open(
      request,
      fixture.proof,
      input(),
    ));
    expect(fixture.order).toEqual(["claim", "source", "semantic"]);
    const receipt = success(fixture.factory.receipt(request, session));
    expect(receipt).toMatchObject({
      projectId: "project",
      deploymentId: "deployment",
      moduleCount: 1,
      semanticByteLength: fixture.semantic.streamBytes.byteLength,
    });
    receipt.sourceRootSha256.fill(0);
    expect(success(fixture.factory.receipt(request, session)).sourceRootSha256)
      .toEqual(fixture.finalized.sourceRootSha256);

    expect(success(fixture.factory.moduleCount(request, session))).toBe(1);
    const module = success(fixture.factory.moduleAt(request, session, 0));
    const moduleView = success(fixture.factory.moduleView(request, module));
    expect(moduleView).toMatchObject({
      ordinal: 0,
      roles: 3,
      sourceByteLength: fixture.source.modules[0]!.sourceBytes.byteLength,
    });
    expect(success(createDeclarativeV2VerifierEngineV1({
      modulePath: moduleView.path,
      moduleOrdinal: BigInt(moduleView.ordinal),
      sourceSha256: moduleView.sourceSha256,
      maximums: verifierBudget(
        "command_budget",
        moduleView.sourceByteLength,
      ),
      required: verifierBudget(
        "attempt_usage",
        moduleView.sourceByteLength,
      ),
    }))).toBeDefined();
    const sourceCursor = success(
      fixture.factory.sourceCursor(request, module),
    );
    const first = success(fixture.factory.readCursor(
      request,
      sourceCursor,
      3,
    ));
    expect(first).toMatchObject({ status: "pending", offset: 3 });
    const second = success(fixture.factory.readCursor(
      request,
      sourceCursor,
      10_000,
    ));
    expect(second.status).toBe("complete");
    expect([...first.bytes, ...second.bytes]).toEqual(
      [...fixture.source.modules[0]!.sourceBytes],
    );
    expect(Result.isFailure(
      fixture.factory.readCursor(request, sourceCursor, 1),
    )).toBe(true);

    const semanticCursor = success(
      fixture.factory.semanticCursor(request, session),
    );
    expect(success(fixture.factory.readCursor(
      request,
      semanticCursor,
      fixture.semantic.streamBytes.byteLength,
    )).bytes).toEqual(fixture.semantic.streamBytes);

    const copiedModule = { ...module };
    expect(Result.isFailure(
      fixture.factory.moduleView(request, copiedModule),
    )).toBe(true);
    const wrongRequest = new Request("https://private.test/wrong");
    expect(Result.isFailure(
      fixture.factory.receipt(wrongRequest, session),
    )).toBe(true);
    const otherFactory = makeSessionFixture().factory;
    expect(Result.isFailure(otherFactory.receipt(request, session))).toBe(true);
    expect(Result.isSuccess(fixture.factory.close(request, session))).toBe(true);
    expect(Result.isFailure(fixture.factory.receipt(request, session))).toBe(true);
  });

  it("rejects caller-authored legacy, package, and artifact identities before claiming", async () => {
    const fixture = makeSessionFixture();
    const request = new Request("https://private.test/reject-authority");
    for (const [field, reason] of [
      ["executionArtifactRef", "legacyAuthority"],
      ["packageSha256", "packageAuthority"],
      ["artifactSha256", "artifactAuthority"],
    ] as const) {
      const exit = await Effect.runPromiseExit(fixture.factory.open(
        request,
        fixture.proof,
        { ...input(), [field]: "caller-value" },
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) throw new Error("Expected authority rejection.");
      const error = Cause.findErrorOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toMatchObject({ reason });
      }
    }
    expect(fixture.order).toEqual([]);
  });

  it("admits the conservative finalized read before claiming its one-shot proof", async () => {
    const fixture = makeSessionFixture();
    const exit = await Effect.runPromiseExit(fixture.factory.open(
      new Request("https://private.test/pre-admission"),
      fixture.proof,
      input({ objectBodyBytes: 99_999n }),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("Expected pre-admission failure.");
    const error = Cause.findErrorOption(exit.cause);
    expect(error._tag).toBe("Some");
    if (error._tag === "Some") {
      expect(error.value).toMatchObject({
        _tag: "DeclarativeV2ContentReadBudgetError",
        reason: "budgetExceeded",
        dimension: "objectBodyBytes",
      });
    }
    expect(fixture.order).toEqual([]);
  });

  it("classifies hostile authority input without invoking accessors or claiming proof", async () => {
    const fixture = makeSessionFixture();
    const request = new Request("https://private.test/hostile-authority");
    let getterCalls = 0;
    const accessorInput = Object.defineProperty(
      {},
      "executionArtifactRef",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("authority getter must not run");
        },
      },
    );
    const accessorExit = await Effect.runPromiseExit(fixture.factory.open(
      request,
      fixture.proof,
      accessorInput,
    ));
    expect(Exit.isFailure(accessorExit)).toBe(true);
    if (Exit.isSuccess(accessorExit)) {
      throw new Error("Expected accessor authority rejection.");
    }
    const accessorError = Cause.findErrorOption(accessorExit.cause);
    expect(accessorError._tag).toBe("Some");
    if (accessorError._tag === "Some") {
      expect(accessorError.value).toMatchObject({ reason: "legacyAuthority" });
    }
    expect(getterCalls).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const revokedExit = await Effect.runPromiseExit(fixture.factory.open(
      request,
      fixture.proof,
      revoked.proxy,
    ));
    expect(Exit.isFailure(revokedExit)).toBe(true);
    if (Exit.isSuccess(revokedExit)) {
      throw new Error("Expected revoked input rejection.");
    }
    const revokedError = Cause.findErrorOption(revokedExit.cause);
    expect(revokedError._tag).toBe("Some");
    if (revokedError._tag === "Some") {
      expect(revokedError.value).toMatchObject({ reason: "invalidInput" });
    }
    expect(fixture.order).toEqual([]);
  });

  it("totally rejects hostile nested budget frames before claiming proof", async () => {
    const valid = input();
    const nestedAccessor = Object.defineProperty(
      { ...valid.budget.ceilings },
      "calls",
      {
        enumerable: true,
        get() {
          throw new Error("nested budget getter must not run");
        },
      },
    );
    const revokedFrame = Proxy.revocable(valid.budget.ceilings, {});
    revokedFrame.revoke();
    const trappedBudget = new Proxy(valid.budget, {
      ownKeys() {
        throw new Error("budget ownKeys trap");
      },
    });
    const hostileBudgets: unknown[] = [
      trappedBudget,
      { ...valid.budget, ceilings: nestedAccessor },
      { ...valid.budget, ceilings: revokedFrame.proxy },
      { ...valid.budget, ceilings: {
        ...valid.budget.ceilings,
        [Symbol("extra")]: 1n,
      } },
      { ceilings: valid.budget.ceilings, usage: valid.budget.usage },
      { ...valid.budget, extra: 1n },
    ];

    for (const budget of hostileBudgets) {
      const direct = makeDeclarativeV2ContentReadBudgetTracker(budget);
      expect(direct).toMatchObject({
        failure: {
          _tag: "DeclarativeV2ContentReadBudgetError",
          operation: "createBudget",
          reason: "invalidInput",
        },
      });

      const fixture = makeSessionFixture();
      const exit = await Effect.runPromiseExit(fixture.factory.open(
        new Request("https://private.test/hostile-budget"),
        fixture.proof,
        Object.freeze({ command: valid.command, budget }),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) throw new Error("Expected budget rejection.");
      const error = Cause.findErrorOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toMatchObject({
          _tag: "DeclarativeV2ContentReadBudgetError",
          operation: "createBudget",
          reason: "invalidInput",
        });
      }
      expect(fixture.order).toEqual([]);
    }
  });

  it("fails closed on source/semantic path drift and one-less cursor output budget", async () => {
    const mismatchFixture = makeSessionFixture("other.js");
    const mismatchExit = await Effect.runPromiseExit(
      mismatchFixture.factory.open(
        new Request("https://private.test/mismatch"),
        mismatchFixture.proof,
        input(),
      ),
    );
    expect(Exit.isFailure(mismatchExit)).toBe(true);
    if (Exit.isSuccess(mismatchExit)) throw new Error("Expected path mismatch.");
    expect(String(mismatchExit.cause)).toContain(
      "DeclarativeV2AuthenticatedReadSessionMismatchError",
    );

    const budgetFixture = makeSessionFixture();
    const request = new Request("https://private.test/one-less");
    const sourceLength = budgetFixture.source.modules[0]!.sourceBytes.byteLength;
    const session = await Effect.runPromise(budgetFixture.factory.open(
      request,
      budgetFixture.proof,
      input({ outputBytes: BigInt(sourceLength - 1) }),
    ));
    const module = success(budgetFixture.factory.moduleAt(request, session, 0));
    const cursor = success(
      budgetFixture.factory.sourceCursor(request, module),
    );
    const failed = budgetFixture.factory.readCursor(
      request,
      cursor,
      sourceLength,
    );
    expect(Result.isFailure(failed)).toBe(true);
    if (Result.isSuccess(failed)) throw new Error("Expected budget failure.");
    expect(failed.failure).toMatchObject({
      _tag: "DeclarativeV2ContentReadBudgetError",
      reason: "budgetExceeded",
      dimension: "outputBytes",
    });
    expect(success(budgetFixture.factory.readCursor(request, cursor, 1)).offset)
      .toBe(1);
  });

  it("rejects finalized configuration identity skew against the stored semantic root", async () => {
    const fixture = makeSessionFixture("functions/main.js", {
      semanticModelIdentity: "semantic-model-v2",
    });
    const exit = await Effect.runPromiseExit(fixture.factory.open(
      new Request("https://private.test/root-configuration-skew"),
      fixture.proof,
      input(),
    ));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected semantic root configuration mismatch.");
    }
    const error = Cause.findErrorOption(exit.cause);
    expect(error._tag).toBe("Some");
    if (error._tag === "Some") {
      expect(error.value).toMatchObject({
        _tag: "DeclarativeV2AuthenticatedReadSessionMismatchError",
        reason: "semanticRootConfiguration",
      });
    }
  });

  it("replays cold factories to byte-identical evidence without sharing capabilities", async () => {
    const first = makeSessionFixture();
    const second = makeSessionFixture();
    const firstRequest = new Request("https://private.test/cold");
    const secondRequest = new Request("https://private.test/cold");
    const firstSession = await Effect.runPromise(
      first.factory.open(firstRequest, first.proof, input()),
    );
    const secondSession = await Effect.runPromise(
      second.factory.open(secondRequest, second.proof, input()),
    );
    expect(success(first.factory.receipt(firstRequest, firstSession))).toEqual(
      success(second.factory.receipt(secondRequest, secondSession)),
    );
    expect(Result.isFailure(
      second.factory.receipt(secondRequest, firstSession),
    )).toBe(true);
  });
});

function makeSessionFixture(
  semanticPath = "functions/main.js",
  rootConfigurationOverrides:
    Readonly<Partial<SemanticArtifactV1RootConfiguration>> = {},
) {
  const order: string[] = [];
  const sourcePath = makePath("functions/main.js");
  const semanticModulePath = makePath(semanticPath);
  const sourceRootSha256 = digest(0x11);
  const semanticRootSha256 = digest(0x22);
  const finalized: SemanticArtifactV1FinalizedEvidence = Object.freeze({
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-24T00:00:00.000Z",
    semanticUploadId: "semantic-upload",
    semanticGeneration: 1,
    semanticMutationFence: 3,
    sourceUploadId: "source-upload",
    sourceGeneration: 1,
    sourceMutationFence: 2,
    sourceRootSha256,
    sourceSelectorSha256: digest(0x12),
    semanticRootSha256,
    semanticSelectorSha256: digest(0x23),
    semanticAttemptIdentitySha256: digest(0x24),
    rootConfiguration: Object.freeze({
      semanticModelIdentity: "semantic-model-v1",
      semanticCodecIdentity: "semantic-codec-v1",
      semanticPolicyIdentity: "semantic-policy-v1",
      coreLanguageIdentity: "FlarexDeclarativeExecutableCoreV1",
      abiIdentity: "abi-v1",
      grammarIdentity: "grammar-v1",
      unicodeIdentity: "unicode-14",
      parserTableIdentity: "parser-table-v1",
      trustedToolingIdentity: "tooling-v1",
      ingressProtocolIdentity: "semantic-ingress-v1",
      ingressConfigurationIdentity: "semantic-ingress-config-v1",
      ...rootConfigurationOverrides,
    }),
    usage: Object.freeze({
      calls: 1,
      blockBytes: 1,
      canonicalBytes: 1,
      frameBytes: 1,
      hashBytes: 1,
      timeMilliseconds: 1,
    }),
  });
  const sourceBytes = new TextEncoder().encode(
    "export default function main() {}",
  );
  const source: SourceArtifactV2FinalizedContent = Object.freeze({
    root: Object.freeze({
      moduleCount: 1n,
      functionModuleCount: 1n,
      totalSourceBytes: BigInt(sourceBytes.byteLength),
      totalSourceMapBytes: 0n,
      moduleTreeDigest: digest(0x31),
      executionPath: "functions/main.js",
      schemaPath: null,
      authPath: null,
    }),
    modules: Object.freeze([Object.freeze({
      ordinal: 0,
      frameSha256: digest(0x32),
      path: sourcePath.handle,
      pathBytes: sourcePath.bytes,
      roles: 3,
      sourceSha256: digest(0x33),
      sourceBytes,
    })]),
  });
  const streamBytes = new TextEncoder().encode(
    "{\"kind\":\"header\",\"version\":1}\n",
  );
  const semantic: SemanticArtifactV1FinalizedContent = Object.freeze({
    root: Object.freeze({
      kind: "semantic_root",
      sourceArtifactCodecVersion: 1,
      sourceRootSha256,
      semanticModelIdentity: "semantic-model-v1",
      semanticCodecIdentity: "semantic-codec-v1",
      semanticPolicyIdentity: "semantic-policy-v1",
      coreLanguageIdentity: "FlarexDeclarativeExecutableCoreV1",
      abiIdentity: "abi-v1",
      grammarIdentity: "grammar-v1",
      unicodeIdentity: "unicode-14",
      parserTableIdentity: "parser-table-v1",
      trustedToolingIdentity: "tooling-v1",
      ingressProtocolIdentity: "semantic-ingress-v1",
      ingressConfigurationIdentity: "semantic-ingress-config-v1",
      blockCount: 1n,
      streamByteLength: BigInt(streamBytes.byteLength),
      recordCount: 1n,
      treeRootSha256: digest(0x41),
    }),
    streamBytes,
    records: Object.freeze([{ kind: "header" as const, version: 1 as const }]),
    modules: Object.freeze([Object.freeze({
      path: semanticModulePath.handle,
      pathBytes: semanticModulePath.bytes,
    })]),
  });
  const finalizedSemantic: Pick<SemanticArtifactV1UploadCore, "readFinalized"> = {
    readFinalized: () => {
      order.push("claim");
      return Effect.succeed(finalized);
    },
  };
  const sourceReader: SourceArtifactV2FinalizedContentReader = {
    read: rootSha256 => {
      order.push("source");
      return bytesEqual(rootSha256, sourceRootSha256)
        ? Effect.succeed(source)
        : Effect.die(new Error("unexpected source root"));
    },
  };
  const semanticReader: SemanticArtifactV1FinalizedContentReader = {
    read: (rootSha256, expectedSourceRootSha256) => {
      order.push("semantic");
      return bytesEqual(rootSha256, semanticRootSha256) &&
          bytesEqual(expectedSourceRootSha256, sourceRootSha256)
        ? Effect.succeed(semantic)
        : Effect.die(new Error("unexpected semantic root"));
    },
  };
  const proof = Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof;
  return {
    factory: makeDeclarativeV2AuthenticatedReadSessionFactoryV1({
      finalizedSemantic,
      source: sourceReader,
      semantic: semanticReader,
    }),
    finalized,
    order,
    proof,
    semantic,
    source,
  };
}

function makePath(spelling: string): Readonly<{
  readonly handle: DeclarativeV2ArtifactModulePathHandleV1;
  readonly bytes: Uint8Array;
}> {
  const factory = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1;
  const bytes = new TextEncoder().encode(spelling);
  const validator = success(factory.create(3, bytes.byteLength, bytes.byteLength));
  success(factory.step(validator, bytes, 1_024));
  const finished = success(factory.finish(validator, 1_024));
  if ("status" in finished) throw new Error("Path validation did not finish.");
  return Object.freeze({ handle: finished, bytes });
}

function input(
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >> = {},
) {
  return Object.freeze({
    command: Object.freeze({
      semanticUploadId: "semantic-upload",
      deploymentId: "deployment",
      expectedGeneration: 1,
      expectedMutationFence: 3,
      commandId: "read-finalized",
      admission: Object.freeze({
        calls: 100,
        blockBytes: 100_000,
        canonicalBytes: 100_000,
        frameBytes: 100_000,
        hashBytes: 100_000,
        timeMilliseconds: 10_000,
      }),
    }),
    budget: Object.freeze({
      ceilings: budgetFrame("attempt_ceilings", overrides),
      usage: budgetFrame("attempt_usage", {}, 0n),
      command: budgetFrame("command_budget", overrides),
    }),
  });
}

function budgetFrame(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >>,
  fallback = 1_000_000n,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      overrides[dimension] ?? fallback,
    ]),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

function verifierBudget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  sourceBytes: number,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      dimension === "calls"
        ? 1_000_000n
        : dimension === "objectBodyBytes" || dimension === "sourceBytes"
        ? BigInt(sourceBytes)
        : dimension === "sourceMapBytes" || dimension === "semanticBytes"
        ? 0n
        : dimension === "modules"
        ? 1n
        : dimension === "tableBytes"
        ? 10_000_000n
        : dimension.endsWith("Bytes")
        ? 100_000n
        : 1_024n,
    ]),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

function bytesEqual(left: unknown, right: Uint8Array): boolean {
  return left instanceof Uint8Array &&
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function digest(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
