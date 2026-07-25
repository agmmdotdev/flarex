import {
  canonicalPrivateAnalyzerHandshakeResponseV1,
  installedPrivateAnalyzerReleaseTupleV1,
} from "@flarex/analysis/internal/private-analyzer-release-v1";
import {
  canonicalPrivateAnalyzerVerificationResponseHeaderV1,
  canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1,
  decodePrivateAnalyzerVerificationFrameV1,
  decodePrivateAnalyzerVerificationRequestHeaderV1,
  encodePrivateAnalyzerVerificationFrameV1,
  PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
  sha256HexFromBytesV1,
  type PrivateAnalyzerVerificationResponseHeaderV1,
} from "@flarex/analysis/internal/private-analyzer-verification-v1";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import { Cause, Effect, Exit, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";
import {
  makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1,
} from "../src/declarativeV2/AuthenticatedVerifierDispatch";
import type {
  DeclarativeV2AuthenticatedByteCursorV1,
  DeclarativeV2AuthenticatedModuleV1,
  DeclarativeV2AuthenticatedReadSessionFactoryV1,
  DeclarativeV2AuthenticatedReadSessionV1,
} from "../src/declarativeV2/AuthenticatedVerifierReadSession";
import type {
  SemanticArtifactV1FinalizedSourceProof,
} from "../src/semanticArtifactV1/FinalizedSourceProof";

const encoder = new TextEncoder();

function budget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >> = {},
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
      dimension => [dimension, overrides[dimension] ?? 10_000_000n] as const,
    ),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

function dispatchBudgets(sourceBytes: bigint) {
  const moduleRequired = budget("attempt_usage", {
    modules: 1n,
    sourceBytes,
    semanticBytes: 0n,
  });
  const linkerRequired = budget("attempt_usage", {
    modules: 1n,
    sourceBytes: 0n,
    semanticBytes: 0n,
  });
  const hostRequired = budget("attempt_usage", {
    modules: 0n,
    sourceBytes: 0n,
    semanticBytes: 0n,
  });
  const moduleMaximums = budget("command_budget", moduleRequired);
  const linkerMaximums = budget("command_budget", linkerRequired);
  const hostMaximums = budget("command_budget", hostRequired);
  const components = [
    { maximums: moduleMaximums, required: moduleRequired },
    { maximums: linkerMaximums, required: linkerRequired },
    { maximums: hostMaximums, required: hostRequired },
  ] as const;
  const sum = (
    kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
    key: "maximums" | "required",
  ) => Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      components.reduce(
        (total, component) => total + component[key][dimension],
        0n,
      ),
    ]),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
  return Object.freeze({
    maximums: sum("command_budget", "maximums"),
    required: sum("attempt_usage", "required"),
    moduleBudgets: Object.freeze([components[0]]),
    linkerBudget: components[1],
    hostBudget: components[2],
  });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
}

function encodedFrame(kind: "responseHeader" | "responseEnd", payload: Uint8Array) {
  const result = encodePrivateAnalyzerVerificationFrameV1(kind, payload);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function join(values: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = values.reduce((sum, value) => sum + value.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

async function makeFixture(options: Readonly<{
  readonly modulePath?: unknown;
}> = {}) {
  const order: string[] = [];
  const source = encoder.encode("export function ready() {}");
  const sourceSha256 = await sha256(source);
  const pathBytes = encoder.encode("functions/main.js");
  const pathValidator = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      pathBytes.byteLength + 3,
      pathBytes.byteLength,
      pathBytes.byteLength,
    ),
  );
  Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
      pathValidator,
      pathBytes,
      pathBytes.byteLength,
    ),
  );
  const path = Result.getOrThrow(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(pathValidator, 3),
  );
  if ("status" in path) throw new Error("module path did not settle");
  const session = Object.freeze({}) as DeclarativeV2AuthenticatedReadSessionV1;
  const module = Object.freeze({}) as DeclarativeV2AuthenticatedModuleV1;
  const sourceCursor =
    Object.freeze({ kind: "source" }) as unknown as
      DeclarativeV2AuthenticatedByteCursorV1;
  const semanticCursor =
    Object.freeze({ kind: "semantic" }) as unknown as
      DeclarativeV2AuthenticatedByteCursorV1;
  const cursorOffsets = new WeakMap<object, number>();
  cursorOffsets.set(sourceCursor, 0);
  cursorOffsets.set(semanticCursor, 0);
  const zeroUsage = budget("attempt_usage");
  const sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1 = Object.freeze({
    open: () => {
      order.push("open");
      return Effect.succeed(session);
    },
    receipt: () => Result.succeed(Object.freeze({
      projectId: "project",
      deploymentId: "deployment",
      deploymentCreatedAt: "2026-07-25T00:00:00.000Z",
      sourceUploadId: "source-upload",
      sourceGeneration: 1,
      sourceMutationFence: 2,
      sourceRootSha256: new Uint8Array(32).fill(1),
      sourceSelectorSha256: new Uint8Array(32).fill(2),
      semanticUploadId: "semantic-upload",
      semanticGeneration: 3,
      semanticMutationFence: 4,
      semanticRootSha256: new Uint8Array(32).fill(3),
      semanticSelectorSha256: new Uint8Array(32).fill(4),
      semanticAttemptIdentitySha256: new Uint8Array(32).fill(5),
      moduleCount: 1,
      semanticByteLength: 0,
      budget: Object.freeze({
        usage: zeroUsage,
        commandUsage: zeroUsage,
      }),
    })),
    moduleCount: () => Result.succeed(1),
    moduleAt: (_request: Request, _session: unknown, ordinal: unknown) =>
      ordinal === 0
        ? Result.succeed(module)
        : Result.fail(new Error("unexpected ordinal") as never),
    moduleView: () => Result.succeed(Object.freeze({
      ordinal: 0,
      roles: 1,
      frameSha256: new Uint8Array(32).fill(6),
      sourceSha256,
      sourceByteLength: source.byteLength,
      path: (options.modulePath ?? path) as typeof path,
    })),
    sourceCursor: () => Result.succeed(sourceCursor),
    semanticCursor: () => Result.succeed(semanticCursor),
    readCursor: (
      _request: Request,
      cursor: unknown,
      maximumBytes: unknown,
    ) => {
      if (
        cursor !== sourceCursor ||
        typeof maximumBytes !== "number" ||
        maximumBytes < 1
      ) {
        return Result.fail(new Error("invalid cursor") as never);
      }
      const offset = cursorOffsets.get(sourceCursor) ?? 0;
      const bytes = source.slice(offset, offset + maximumBytes);
      const next = offset + bytes.byteLength;
      cursorOffsets.set(sourceCursor, next);
      return Result.succeed(Object.freeze({
        status: next === source.byteLength ? "complete" as const : "pending" as const,
        offset: next,
        bytes,
      }));
    },
    close: () => {
      order.push("close");
      return Result.succeed(undefined);
    },
  });
  const release = installedPrivateAnalyzerReleaseTupleV1();
  const analyzer = Object.freeze({
    fetch: async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith("/identity")) {
        order.push("handshake");
        return new Response(
          Uint8Array.from(canonicalPrivateAnalyzerHandshakeResponseV1(release))
            .buffer,
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      order.push("verify");
      const body = new Uint8Array(await request.arrayBuffer());
      const length = new DataView(body.buffer, body.byteOffset, 5).getUint32(1, false);
      const first = Result.getOrThrow(
        decodePrivateAnalyzerVerificationFrameV1(body.subarray(0, 5 + length)),
      );
      const requestHeader = Result.getOrThrow(
        decodePrivateAnalyzerVerificationRequestHeaderV1(first.payload, release),
      );
      const evidenceSha256 = Result.getOrThrow(
        sha256HexFromBytesV1(await sha256(new Uint8Array(0))),
      );
      const withoutIdentity = Object.freeze({
        kind: "private_analyzer_verification_response_v1" as const,
        protocolIdentity: requestHeader.protocolIdentity,
        protocolVersion: requestHeader.protocolVersion,
        requestIdentitySha256: requestHeader.requestIdentitySha256,
        evidenceSha256,
        verified: true,
        moduleCount: 1,
        evidenceCount: 0,
        diagnosticCount: 0,
      });
      const resultIdentitySha256 = Result.getOrThrow(
        sha256HexFromBytesV1(await sha256(
          canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1(
            withoutIdentity,
          ),
        )),
      );
      const header: PrivateAnalyzerVerificationResponseHeaderV1 = Object.freeze({
        ...withoutIdentity,
        resultIdentitySha256,
      });
      return new Response(join([
        encodedFrame(
          "responseHeader",
          canonicalPrivateAnalyzerVerificationResponseHeaderV1(header),
        ),
        encodedFrame("responseEnd", new Uint8Array(0)),
      ]).buffer, {
        status: 200,
        headers: { "content-type": PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1 },
      });
    },
  });
  return Object.freeze({ analyzer, order, release, sessions });
}

describe("authenticated Declarative V2 verifier dispatch", () => {
  it("opens authenticated evidence before a fresh same-binding handshake", async () => {
    const fixture = await makeFixture();
    const factory = makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1({
      sessions: fixture.sessions,
      analyzer: fixture.analyzer,
      expectedRelease: fixture.release,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });
    const request = new Request("https://private.test/dispatch");
    const result = await Effect.runPromise(factory.dispatch(
      request,
      Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof,
      Object.freeze({
        readSession: Object.freeze({}),
        ...dispatchBudgets(
          BigInt(encoder.encode("export function ready() {}").byteLength),
        ),
        maximumResponseBytes: 100_000,
      }),
    ));
    expect(fixture.order).toEqual(["open", "handshake", "verify", "close"]);
    expect(Result.getOrThrow(factory.receipt(request, result))).toMatchObject({
      verified: true,
      moduleCount: 1,
      evidenceCount: 0,
    });
    const cursor = Result.getOrThrow(factory.evidenceCursor(request, result));
    expect(Result.getOrThrow(factory.readEvidence(request, cursor, 1)))
      .toMatchObject({ status: "complete", offset: 0, bytes: new Uint8Array(0) });
    expect(Result.getOrThrow(factory.close(request, result))).toBeUndefined();
    expect(factory.receipt(request, result)).toMatchObject({
      failure: { reason: "closed" },
    });
  });

  it("rejects hostile input before opening or consuming authority", async () => {
    const fixture = await makeFixture();
    const factory = makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1({
      sessions: fixture.sessions,
      analyzer: fixture.analyzer,
      expectedRelease: fixture.release,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });
    const hostile = Proxy.revocable({}, {});
    hostile.revoke();
    const exit = await Effect.runPromiseExit(factory.dispatch(
      new Request("https://private.test/hostile"),
      Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof,
      hostile.proxy,
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("expected input rejection");
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      value: { operation: "dispatch", reason: "invalidInput" },
    });
    expect(fixture.order).toEqual([]);
  });

  it("keeps malformed module-path evidence in the typed failure channel", async () => {
    const fixture = await makeFixture({ modulePath: Object.freeze({}) });
    const factory = makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1({
      sessions: fixture.sessions,
      analyzer: fixture.analyzer,
      expectedRelease: fixture.release,
      sha256: bytes => Effect.promise(() => sha256(bytes)),
    });
    const exit = await Effect.runPromiseExit(factory.dispatch(
      new Request("https://private.test/malformed-path"),
      Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof,
      Object.freeze({
        readSession: Object.freeze({}),
        ...dispatchBudgets(
          BigInt(encoder.encode("export function ready() {}").byteLength),
        ),
        maximumResponseBytes: 100_000,
      }),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("expected path rejection");
    expect(Cause.hasFails(exit.cause)).toBe(true);
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      value: { operation: "request", reason: "malformed" },
    });
  });

  it("treats the response ceiling as admission rather than an allocation request", async () => {
    const dispatchWithMaximum = async (maximumResponseBytes: number) => {
      const fixture = await makeFixture();
      const factory = makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1({
        sessions: fixture.sessions,
        analyzer: fixture.analyzer,
        expectedRelease: fixture.release,
        sha256: bytes => Effect.promise(() => sha256(bytes)),
      });
      const request = new Request("https://private.test/response-budget");
      const result = await Effect.runPromise(factory.dispatch(
        request,
        Object.freeze({}) as SemanticArtifactV1FinalizedSourceProof,
        Object.freeze({
          readSession: Object.freeze({}),
          ...dispatchBudgets(
            BigInt(encoder.encode("export function ready() {}").byteLength),
          ),
          maximumResponseBytes,
        }),
      ));
      return Result.getOrThrow(factory.receipt(request, result)).responseBytes;
    };

    const observed = await dispatchWithMaximum(Number.MAX_SAFE_INTEGER);
    await expect(dispatchWithMaximum(observed)).resolves.toBe(observed);
    await expect(dispatchWithMaximum(observed - 1)).rejects.toMatchObject({
      reason: "budgetExceeded",
    });
  });
});
