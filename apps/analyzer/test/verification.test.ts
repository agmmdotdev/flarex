import {
  canonicalPrivateAnalyzerVerificationModuleHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1,
  decodePrivateAnalyzerVerificationFrameV1,
  decodePrivateAnalyzerVerificationResponseHeaderV1,
  encodePrivateAnalyzerVerificationFrameV1,
  installedPrivateAnalyzerVerifierIdentitiesV1,
  installedPrivateAnalyzerVerifierTableBytesV1,
  PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
  type PrivateAnalyzerVerificationFrameKindV1,
  type PrivateAnalyzerVerificationRequestHeaderV1,
} from "@flarex/analysis/internal/private-analyzer-verification-v1";
import { Effect, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";
import { installedPrivateAnalyzerIdentityV1 } from "../src/Identity";
import { makePrivateAnalyzerVerificationHostV1 } from "../src/Verification";

const encoder = new TextEncoder();

function verifierBudget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  sourceByteLength: number,
  overrides: Partial<Record<
    (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
    bigint
  >> = {},
): DeclarativeV2VerifierBudgetFrameV2 {
  const tableBytes = installedPrivateAnalyzerVerifierTableBytesV1();
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      overrides[dimension] ??
        (dimension === "calls"
        ? 1_000_000n
        : dimension === "objectBodyBytes" || dimension === "sourceBytes"
        ? BigInt(sourceByteLength)
        : dimension === "sourceMapBytes" || dimension === "semanticBytes"
        ? 0n
        : dimension === "modules"
        ? 1n
        : dimension === "tableBytes"
        ? tableBytes
        : dimension.endsWith("Bytes")
        ? BigInt(Math.max(100_000, sourceByteLength * 8))
        : 4_096n),
    ] as const),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

function sumBudgets(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  budgets: readonly DeclarativeV2VerifierBudgetFrameV2[],
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", kind],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      budgets.reduce((total, budget) => total + budget[dimension], 0n),
    ]),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function frame(
  kind: PrivateAnalyzerVerificationFrameKindV1,
  payload: Uint8Array,
): Uint8Array {
  const encoded = encodePrivateAnalyzerVerificationFrameV1(kind, payload);
  if (Result.isFailure(encoded)) throw encoded.failure;
  return encoded.success;
}

function join(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function validRequest(
  options: Readonly<{
    readonly identityOverride?: string;
    readonly moduleCount?: number;
    readonly requiredCallsDelta?: bigint;
    readonly source?: Uint8Array;
    readonly semantic?: Uint8Array;
  }> = {},
): Promise<Readonly<{
  readonly request: Request;
  readonly identity: string;
}>> {
  const installed = installedPrivateAnalyzerIdentityV1();
  const source = options.source ??
    encoder.encode("export function ready() {}");
  const semantic = options.semantic ?? new Uint8Array(0);
  const moduleCount = options.moduleCount ?? 1;
  const modules = await Promise.all(Array.from(
    { length: moduleCount },
    async (_, ordinal) => {
      const maximums = verifierBudget("command_budget", source.byteLength);
      const required = verifierBudget("attempt_usage", source.byteLength);
      const header = Object.freeze({
        kind: "private_analyzer_verification_module_v1" as const,
        ordinal,
        roles: 1,
        modulePath: `functions/main-${ordinal}.js`,
        sourceByteLength: source.byteLength,
        sourceSha256: await sha256Hex(source),
        frameSha256: await sha256Hex(encoder.encode(`source-frame-${ordinal}`)),
        maximums,
        required,
      });
      return Object.freeze({
        header,
        headerBytes:
          canonicalPrivateAnalyzerVerificationModuleHeaderV1(header),
        source,
        maximums,
        required,
      });
    },
  ));
  const linkerMaximums = verifierBudget("command_budget", 0, {
    modules: BigInt(moduleCount),
  });
  const linkerRequired = verifierBudget("attempt_usage", 0, {
    modules: BigInt(moduleCount),
  });
  const semanticHostOverrides = {
    semanticBytes: BigInt(semantic.byteLength),
    objectBodyBytes: BigInt(semantic.byteLength),
    tokenBytes: BigInt(Math.max(100_000, semantic.byteLength)),
    canonicalBytes: BigInt(Math.max(100_000, semantic.byteLength)),
    stringBytes: BigInt(Math.max(100_000, semantic.byteLength)),
    schemaNodes: BigInt(Math.max(4_096, semantic.byteLength)),
    parserStates: BigInt(Math.max(4_096, semantic.byteLength * 20)),
    tokens: BigInt(Math.max(4_096, semantic.byteLength)),
    nestingDepth: BigInt(Math.max(4_096, semantic.byteLength)),
    graphNodes: BigInt(4_096 + moduleCount),
  } as const;
  const hostMaximums = verifierBudget(
    "command_budget",
    0,
    semanticHostOverrides,
  );
  const hostRequired = verifierBudget(
    "attempt_usage",
    0,
    semanticHostOverrides,
  );
  const maximums = sumBudgets("command_budget", [
    ...modules.map(module => module.maximums),
    linkerMaximums,
    hostMaximums,
  ]);
  const summedRequired = sumBudgets("attempt_usage", [
    ...modules.map(module => module.required),
    linkerRequired,
    hostRequired,
  ]);
  const required = Object.freeze({
    ...summedRequired,
    calls: summedRequired.calls + (options.requiredCallsDelta ?? 0n),
  });
  const moduleHeaderBytes = join(modules.map(module => module.headerBytes));
  const withoutIdentity = Object.freeze({
    kind: "private_analyzer_verification_request_v1" as const,
    protocolIdentity: "flarex.private-source-analyzer-verification.v1" as const,
    protocolVersion: 1 as const,
    release: installed.identity,
    moduleManifestSha256: await sha256Hex(moduleHeaderBytes),
    semanticContentSha256: await sha256Hex(semantic),
    pins: Object.freeze({
      projectId: "project",
      deploymentId: "deployment",
      deploymentCreatedAt: "2026-07-25T00:00:00.000Z",
      sourceUploadId: "source-upload",
      sourceGeneration: 1,
      sourceMutationFence: 2,
      sourceRootSha256: "1".repeat(64),
      sourceSelectorSha256: "2".repeat(64),
      semanticUploadId: "semantic-upload",
      semanticGeneration: 3,
      semanticMutationFence: 4,
      semanticRootSha256: "3".repeat(64),
      semanticSelectorSha256: "4".repeat(64),
      semanticAttemptIdentitySha256: "5".repeat(64),
    }),
    moduleCount,
    semanticByteLength: semantic.byteLength,
    maximums,
    required,
    linkerMaximums,
    linkerRequired,
    hostMaximums,
    hostRequired,
    verifier: installedPrivateAnalyzerVerifierIdentitiesV1(),
  });
  const identity = await sha256Hex(
    canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1(
      withoutIdentity,
    ),
  );
  const header = Object.freeze({
    ...withoutIdentity,
    requestIdentitySha256: options.identityOverride ?? identity,
  } satisfies PrivateAnalyzerVerificationRequestHeaderV1);
  const body = join([
    frame(
      "requestHeader",
      canonicalPrivateAnalyzerVerificationRequestHeaderV1(header),
    ),
    ...modules.flatMap(module => [
      frame("moduleHeader", module.headerBytes),
      ...Array.from(
        { length: Math.ceil(module.source.byteLength / 32_768) },
        (_, index) =>
          frame(
            "moduleBytes",
            module.source.subarray(index * 32_768, (index + 1) * 32_768),
          ),
      ),
    ]),
    ...Array.from(
      { length: Math.ceil(semantic.byteLength / 32_768) },
      (_, index) =>
        frame(
          "semanticBytes",
          semantic.subarray(index * 32_768, (index + 1) * 32_768),
        ),
    ),
    frame("requestEnd", new Uint8Array(0)),
  ]);
  return Object.freeze({
    identity,
    request: new Request(
      `https://private.test${installed.configuration.verification.path}`,
      {
        method: "POST",
        headers: { "content-type": PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1 },
        body: body.buffer,
      },
    ),
  });
}

describe("private analyzer verification host", () => {
  it("verifies a canonical streamed module and emits bound evidence", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const host = makePrivateAnalyzerVerificationHostV1({
      configuration: installed.configuration,
      identity: installed.identity,
    });
    const fixture = await validRequest();
    const response = await Effect.runPromise(host.handle(fixture.request));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const firstLength = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      5,
    ).getUint32(1, false);
    const first = decodePrivateAnalyzerVerificationFrameV1(
      bytes.subarray(0, 5 + firstLength),
    );
    if (Result.isFailure(first)) throw first.failure;
    expect(first.success.kind).toBe("responseHeader");
    const header = decodePrivateAnalyzerVerificationResponseHeaderV1(
      first.success.payload,
      fixture.identity,
    );
    expect(header).toMatchObject({
      success: {
        requestIdentitySha256: fixture.identity,
        verified: true,
        moduleCount: 1,
        diagnosticCount: 0,
      },
    });
  }, 30_000);

  it("fails closed when the request identity is not the canonical preimage", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const host = makePrivateAnalyzerVerificationHostV1({
      configuration: installed.configuration,
      identity: installed.identity,
    });
    const fixture = await validRequest({
      identityOverride: "f".repeat(64),
    });
    const response = await Effect.runPromise(host.handle(fixture.request));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "identityMismatch" });
  });

  it("settles two module allocations without resetting the request budget", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const host = makePrivateAnalyzerVerificationHostV1({
      configuration: installed.configuration,
      identity: installed.identity,
    });
    const fixture = await validRequest({ moduleCount: 2 });
    const response = await Effect.runPromise(host.handle(fixture.request));
    expect(response.status, await response.clone().text()).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const firstLength = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      5,
    ).getUint32(1, false);
    const first = Result.getOrThrow(
      decodePrivateAnalyzerVerificationFrameV1(
        bytes.subarray(0, 5 + firstLength),
      ),
    );
    expect(Result.getOrThrow(
      decodePrivateAnalyzerVerificationResponseHeaderV1(
        first.payload,
        fixture.identity,
      ),
    )).toMatchObject({ moduleCount: 2, verified: true });
  }, 30_000);

  it("rejects an aggregate component allocation one call above the request total", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const host = makePrivateAnalyzerVerificationHostV1({
      configuration: installed.configuration,
      identity: installed.identity,
    });
    const fixture = await validRequest({ requiredCallsDelta: -1n });
    const response = await Effect.runPromise(host.handle(fixture.request));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "budgetExceeded" });
  });

  it.each([
    ["mid-header", (bytes: Uint8Array) => bytes.subarray(0, 1)],
    ["mid-payload", (bytes: Uint8Array) => bytes.subarray(0, 6)],
    ["after requestEnd", (bytes: Uint8Array) => bytes],
  ] as const)(
    "times out and cancels a body stalled %s",
    async (_label, prefix) => {
      const installed = installedPrivateAnalyzerIdentityV1();
      const configuration = Object.freeze({
        ...installed.configuration,
        verification: Object.freeze({
          ...installed.configuration.verification,
          maximumBodyReadMilliseconds: 25,
        }),
      }) as unknown as typeof installed.configuration;
      const host = makePrivateAnalyzerVerificationHostV1({
        configuration,
        identity: installed.identity,
      });
      const fixture = await validRequest();
      const body = new Uint8Array(await fixture.request.arrayBuffer());
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(prefix(body)));
        },
        cancel() {
          cancelled = true;
        },
      });
      const requestInit: RequestInit & { readonly duplex: "half" } = {
        method: "POST",
        headers: fixture.request.headers,
        body: stream,
        duplex: "half",
      };
      const request = new Request(fixture.request.url, requestInit);
      const response = await Effect.runPromise(host.handle(request));
      expect(response.status).toBe(408);
      expect(await response.json()).toEqual({ error: "timedOut" });
      expect(cancelled).toBe(true);
    },
  );

  it("times out during CPU-only verification after the complete body is available", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const configuration = Object.freeze({
      ...installed.configuration,
      verification: Object.freeze({
        ...installed.configuration.verification,
        maximumBodyReadMilliseconds: 10,
      }),
    }) as unknown as typeof installed.configuration;
    const host = makePrivateAnalyzerVerificationHostV1({
      configuration,
      identity: installed.identity,
    });
    const source = encoder.encode(
      `export function ready() {/*${"x".repeat(250_000)}*/}`,
    );
    const fixture = await validRequest({ source });
    const response = await Effect.runPromise(host.handle(fixture.request));
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: "timedOut" });
  }, 30_000);

  it("times out during high-cardinality semantic handler verification", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const configuration = Object.freeze({
      ...installed.configuration,
      verification: Object.freeze({
        ...installed.configuration.verification,
        maximumBodyReadMilliseconds: 10,
      }),
    }) as unknown as typeof installed.configuration;
    const host = makePrivateAnalyzerVerificationHostV1({
      configuration,
      identity: installed.identity,
    });
    const functions = Array.from({ length: 1_000 }, (_, index) => {
      const suffix = index.toString().padStart(4, "0");
      return JSON.stringify({
        kind: "function",
        path: `function-${suffix}`,
        modulePath: "functions/main-0.js",
        exportName: "ready",
        functionKind: "query",
        visibility: "public",
        argsValidatorId: "args",
        returnsValidatorId: null,
        partition: null,
      });
    });
    const handlers = Array.from({ length: 1_000 }, (_, index) => {
      const suffix = index.toString().padStart(4, "0");
      return JSON.stringify({
        kind: "handler",
        functionPath: `function-${suffix}`,
        modulePath: "functions/main-0.js",
        exportName: "ready",
      });
    });
    const semantic = encoder.encode([
      JSON.stringify({ kind: "header", version: 1 }),
      JSON.stringify({ kind: "module", modulePath: "functions/main-0.js" }),
      ...functions,
      JSON.stringify({ kind: "validator", id: "args", value: null }),
      ...handlers,
      "",
    ].join("\n"));
    const fixture = await validRequest({ semantic });
    const response = await Effect.runPromise(host.handle(fixture.request));
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: "timedOut" });
  }, 30_000);
});
