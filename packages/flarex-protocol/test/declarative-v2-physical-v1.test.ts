import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DeclarativeV2PhysicalFrameV1Error,
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2PhysicalFrameV1,
} from "../src/declarative-v2-physical-v1";

const digest = (value: number): Uint8Array =>
  new Uint8Array(32).fill(value);

const budget = Object.freeze({
  maximumFrameBytes: 1_000_000,
  maximumCanonicalBytes: 1_000_000,
});

describe("Declarative V2 physical frames", () => {
  it("round-trips every frame family with detached owned bytes", () => {
    for (const frame of fixtures()) {
      const encoded = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(frame, budget),
      );
      const decoded = Result.getOrThrow(
        decodeDeclarativeV2PhysicalFrameV1(encoded.canonicalBytes, budget),
      );
      expect(decoded.frame).toEqual(frame);
      expect(decoded.canonicalBytes).not.toBe(encoded.canonicalBytes);
      for (const value of Object.values(decoded.frame)) {
        if (value instanceof Uint8Array) {
          expect(
            Object.values(frame).some((candidate) => candidate === value),
          ).toBe(false);
        }
      }
    }
  });

  it("pins exact and one-less frame and canonical-byte budgets", () => {
    const frame = fixtures().find((item) =>
      item.kind === "deployment_analysis_projection"
    );
    if (frame === undefined) throw new Error("Missing projection fixture.");
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(frame, budget),
    );
    expect(Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: encoded.usage.frameBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
    })).usage).toEqual(encoded.usage);

    const frameResult = encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: encoded.usage.frameBytes - 1,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
    });
    if (Result.isSuccess(frameResult)) {
      throw new Error("Expected frame budget failure.");
    }
    const frameFailure = frameResult.failure;
    expect(frameFailure).toBeInstanceOf(DeclarativeV2PhysicalFrameV1Error);
    expect(frameFailure.reason).toBe("frameBytesExceeded");

    const canonicalResult = decodeDeclarativeV2PhysicalFrameV1(
      encoded.canonicalBytes,
      {
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes - 1,
      },
    );
    if (Result.isSuccess(canonicalResult)) {
      throw new Error("Expected canonical budget failure.");
    }
    const canonicalFailure = canonicalResult.failure;
    expect(canonicalFailure.reason).toBe("canonicalBytesExceeded");
  });

  it("rejects trailing, truncated, malformed, and cross-field-invalid frames", () => {
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(fixtures()[0], budget),
    ).canonicalBytes;
    expect(Result.isFailure(decodeDeclarativeV2PhysicalFrameV1(
      encoded.slice(0, -1),
      budget,
    ))).toBe(true);
    expect(Result.isFailure(decodeDeclarativeV2PhysicalFrameV1(
      new Uint8Array([...encoded, 0]),
      budget,
    ))).toBe(true);
    const corrupted = new Uint8Array(encoded);
    corrupted[0] ^= 0xff;
    expect(Result.isFailure(
      decodeDeclarativeV2PhysicalFrameV1(corrupted, budget),
    )).toBe(true);
    const inheritedKindDomain = new TextEncoder().encode(
      "flarex.declarative-v2/toString/v1\0\0\0\0\0",
    );
    expect(Result.isFailure(
      decodeDeclarativeV2PhysicalFrameV1(inheritedKindDomain, budget),
    )).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PhysicalFrameV1({
      kind: "verdict",
      attemptSha256: digest(1),
      candidateSha256: digest(2),
      verdict: "ready",
      diagnosticRootSha256: digest(3),
      failureCode: "must-not-exist",
      handlerSetSha256: digest(4),
      registrationRootSha256: digest(5),
      indexReadinessRootSha256: digest(6),
    }, budget))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PhysicalFrameV1({
      kind: "phase_page_manifest",
      attemptSha256: digest(1),
      phase: "source",
      pageOrdinal: 0n,
      firstItemOrdinal: 0n,
      itemCount: 1n,
      previousPageSha256: digest(2),
      pageRootSha256: digest(3),
    }, budget))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2PhysicalFrameV1({
      kind: "phase_page_manifest",
      attemptSha256: digest(1),
      phase: "source",
      pageOrdinal: 1n,
      firstItemOrdinal: 1n,
      itemCount: 1n,
      previousPageSha256: null,
      pageRootSha256: digest(3),
    }, budget))).toBe(true);
  });

  it("preserves signed-int64 boundaries and unusual UTF-16 text", () => {
    const frame: DeclarativeV2PhysicalFrameV1 = {
      kind: "activation_head",
      scopeId: "scope_￿_😀",
      revisionCounter: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
      currentRevision: DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
      candidateSha256: digest(7),
      verdictSha256: digest(8),
    };
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(frame, budget),
    );
    expect(Result.getOrThrow(
      decodeDeclarativeV2PhysicalFrameV1(encoded.canonicalBytes, budget),
    ).frame).toEqual(frame);
  });

  it("rejects aliases, accessors, symbols, and malformed budgets", () => {
    const fixture = fixtures()[0];
    const inherited = Object.create(fixture);
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(inherited, budget),
    )).toBe(true);
    const accessor = {
      ...fixture,
      get projectId() {
        throw new Error("must not be invoked");
      },
    };
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(accessor, budget),
    )).toBe(true);
    const symbol = { ...fixture, [Symbol("extra")]: true };
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(symbol, budget),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2PhysicalFrameV1(fixture, {}),
    )).toBe(true);
  });

  it("preflights before byte capture and isolates accepted caller bytes", () => {
    const frame = fixtures().find((item) =>
      item.kind === "deployment_analysis_projection"
    );
    if (
      frame === undefined ||
      frame.kind !== "deployment_analysis_projection"
    ) {
      throw new Error("Missing projection fixture.");
    }
    Object.defineProperty(frame.canonicalBytes, Symbol.iterator, {
      configurable: true,
      get() {
        throw new Error("iterator must not be consulted");
      },
    });
    const exact = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(frame, budget),
    );
    const overBudget = encodeDeclarativeV2PhysicalFrameV1(frame, {
      maximumFrameBytes: exact.usage.frameBytes - 1,
      maximumCanonicalBytes: exact.usage.canonicalBytes,
    });
    expect(Result.isFailure(overBudget)).toBe(true);

    const originalDigest = frame.candidateSha256[0];
    const originalCanonical = frame.canonicalBytes[0];
    frame.candidateSha256[0] ^= 0xff;
    frame.canonicalBytes[0] ^= 0xff;
    expect(exact.frame.kind).toBe("deployment_analysis_projection");
    if (exact.frame.kind !== "deployment_analysis_projection") {
      throw new Error("Expected projection evidence.");
    }
    expect(exact.frame.candidateSha256[0]).toBe(originalDigest);
    expect(exact.frame.canonicalBytes[0]).toBe(originalCanonical);
  });

  it("keeps the codec off the package root and on one internal subpath", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).toHaveProperty(
      "./internal/declarative-v2-physical-v1",
      "./src/declarative-v2-physical-v1.ts",
    );
    expect(root).not.toHaveProperty("encodeDeclarativeV2PhysicalFrameV1");
  });
});

function fixtures(): readonly DeclarativeV2PhysicalFrameV1[] {
  const budgetFields = {
    calls: 1n,
    sourceBytes: 2n,
    modules: 3n,
    importEdges: 4n,
    tokens: 5n,
    tokenBytes: 6n,
    nestingDepth: 7n,
    functions: 8n,
    schemaNodes: 9n,
    validatorNodes: 10n,
    graphNodes: 11n,
    frontierEntries: 12n,
    canonicalBytes: 13n,
    frameBytes: 14n,
    hashBytes: 15n,
    diagnosticBytes: 16n,
    outputBytes: 17n,
    elapsedMilliseconds: 18n,
  } as const;
  return [
    {
      kind: "candidate",
      projectId: "project",
      deploymentId: "deployment",
      deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
      scopeId: "scope",
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      scopeEpoch: "epoch",
      sourceRootSha256: digest(1),
      sourceSelectorSha256: digest(2),
      sourceCodecIdentity: "source-v2",
      semanticRootSha256: digest(3),
      semanticSelectorSha256: digest(4),
      semanticModelIdentity: "declarative-v2",
      semanticCodecIdentity: "ndjson-v1",
      semanticPolicyIdentity: "policy-v1",
      packageSha256: digest(5),
      artifactSha256: digest(6),
      artifactRuntimeIdentity: "runtime-v1",
      schemaArtifactSha256: digest(7),
      schemaBindingSha256: digest(8),
      validatorRootSha256: digest(9),
      coreLanguageIdentity: "core-v1",
      abiIdentity: "abi-v1",
      grammarIdentity: "grammar-v1",
      unicodeIdentity: "unicode-14",
      parserTableIdentity: "parser-v1",
      analyzerIdentity: "analyzer-v2",
      verifierIdentity: "verifier-v1",
      declaredHandlerSetSha256: digest(10),
      deploymentAnalysisCodecIdentity: "analysis-v1",
      deploymentAnalysisByteLength: 20n,
      deploymentAnalysisSha256: digest(11),
      deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
      deploymentCodegenAnalysisByteLength: 21n,
      deploymentCodegenAnalysisSha256: digest(12),
      readinessPolicyIdentity: "readiness-v1",
    },
    {
      kind: "deployment_analysis_projection",
      candidateSha256: digest(13),
      codecIdentity: "analysis-v1",
      canonicalBytes: new Uint8Array([0, 1, 2]),
    },
    {
      kind: "deployment_codegen_analysis_projection",
      candidateSha256: digest(13),
      codecIdentity: "codegen-v1",
      canonicalBytes: new Uint8Array([3, 4]),
    },
    {
      kind: "attempt_identity",
      candidateSha256: digest(13),
      verifierProgressProtocolIdentity: "progress-v1",
      ceilingsSha256: digest(14),
    },
    { kind: "attempt_ceilings", ...budgetFields },
    { kind: "attempt_usage", ...budgetFields },
    { kind: "command_budget", ...budgetFields },
    {
      kind: "progress_cursor",
      phase: "parse",
      settledSequence: 1n,
      moduleOrdinal: 2n,
      edgeOrdinal: 3n,
      pageOrdinal: 4n,
      previousReceiptSha256: digest(15),
    },
    {
      kind: "command_reservation",
      commandKind: "parse_module",
      sequence: 2n,
      previousReceiptSha256: digest(15),
      budgetSha256: digest(16),
      inputSha256: digest(17),
    },
    {
      kind: "command_receipt",
      commandKind: "parse_module",
      sequence: 2n,
      reservationSha256: digest(18),
      usageSha256: digest(19),
      outputSha256: digest(20),
      progressCursorSha256: digest(21),
    },
    {
      kind: "module_summary",
      attemptSha256: digest(22),
      moduleOrdinal: 0n,
      modulePath: "a/😀.mjs",
      moduleSha256: digest(23),
      sourceMapSha256: null,
      importCount: 1n,
      declaredFunctionCount: 2n,
    },
    {
      kind: "import_edge",
      attemptSha256: digest(22),
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      specifier: "./b.mjs",
      importKind: "named",
      importedName: "run",
      localName: "run",
      targetModulePath: "b.mjs",
    },
    {
      kind: "phase_page_manifest",
      attemptSha256: digest(22),
      phase: "parse",
      pageOrdinal: 0n,
      firstItemOrdinal: 0n,
      itemCount: 1n,
      previousPageSha256: null,
      pageRootSha256: digest(24),
    },
    {
      kind: "link_node",
      attemptSha256: digest(22),
      moduleOrdinal: 0n,
      remainingIndegree: 0n,
      nextEdgeOrdinal: 1n,
      state: "linked",
      rowVersion: 1n,
      previousRowSha256: digest(25),
    },
    {
      kind: "frontier_entry",
      attemptSha256: digest(22),
      frontierSequence: 0n,
      moduleOrdinal: 0n,
      state: "consumed",
      rowVersion: 1n,
      previousRowSha256: digest(26),
    },
    {
      kind: "registration",
      attemptSha256: digest(22),
      registrationOrdinal: 0n,
      handlerIdentitySha256: digest(27),
      moduleOrdinal: 0n,
      exportName: "run",
      functionPath: "a:run",
      handlerKind: "mutation",
      visibility: "public",
    },
    {
      kind: "diagnostic",
      attemptSha256: digest(22),
      diagnosticOrdinal: 0n,
      severity: "warning",
      code: "W_TEST",
      path: null,
      message: "deterministic",
    },
    {
      kind: "verdict",
      attemptSha256: digest(22),
      candidateSha256: digest(13),
      verdict: "ready",
      diagnosticRootSha256: digest(28),
      failureCode: null,
      handlerSetSha256: digest(29),
      registrationRootSha256: digest(30),
      indexReadinessRootSha256: digest(31),
    },
    {
      kind: "activation_revision",
      scopeId: "scope",
      revision: 1n,
      previousRevision: null,
      action: "activate",
      candidateSha256: digest(13),
      verdictSha256: digest(32),
      activationRequestSha256: digest(33),
    },
    {
      kind: "activation_head",
      scopeId: "scope",
      revisionCounter: 0n,
      currentRevision: null,
      candidateSha256: null,
      verdictSha256: null,
    },
  ];
}
