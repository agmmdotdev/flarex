import { createHash } from "node:crypto";

import { Cause, Effect, Exit, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

// @ts-expect-error Framework artifact types must remain absent from the root.
import type { FrameworkSchemaArtifact as RootFrameworkSchemaArtifact } from
  "../src";
// @ts-expect-error Framework artifact identities must remain private.
import type { FrameworkSchemaArtifactIdentity as RootArtifactIdentity } from
  "../src";
// @ts-expect-error Framework lineage brands must remain private.
import type { FrameworkSchemaLineageId as RootLineageId } from "../src";
// @ts-expect-error Framework capability brands must remain private.
import type { FrameworkSchemaCapabilityId as RootCapabilityId } from "../src";
// @ts-expect-error Framework codec brands must remain private.
import type { FrameworkSchemaArtifactCodecFormat as RootCodecFormat } from
  "../src";
// @ts-expect-error Framework codec-version brands must remain private.
import type { FrameworkSchemaArtifactCodecVersion as RootCodecVersion } from
  "../src";
// @ts-expect-error Framework digest brands must remain private.
import type { FrameworkSchemaArtifactSha256 as RootArtifactSha256 } from
  "../src";
// @ts-expect-error Framework canonical-text brands must remain private.
import type { FrameworkSchemaArtifactCanonicalJson as RootCanonicalJson } from
  "../src";
import { captureFrameworkSchemaArtifact } from
  "../src/frameworkSchema/artifact/canonical";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
} from "../src/frameworkSchema/artifact/errors";
import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactCanonicalJson,
  FrameworkSchemaArtifactCaptureInput,
  FrameworkSchemaArtifactCodecFormat,
  FrameworkSchemaArtifactCodecVersion,
  FrameworkSchemaArtifactFrame,
  FrameworkSchemaArtifactIdentity,
  FrameworkSchemaArtifactReplayClassification,
  FrameworkSchemaArtifactSha256,
  FrameworkSchemaCapabilityId,
  FrameworkSchemaLineageId,
} from "../src/frameworkSchema/artifact/model";
import {
  classifyFrameworkSchemaArtifactReplay,
  compareFrameworkSchemaArtifactIdentities,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CAPABILITIES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_CONTAINER_LEVELS,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES,
  normalizeFrameworkSchemaArtifact,
} from "../src/frameworkSchema/artifact/policy";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type PublicArtifactExport = Extract<
  keyof typeof import("../src"),
  | `${string}FrameworkSchema${string}`
  | `${string}frameworkSchema${string}`
  | `${string}FRAMEWORK_SCHEMA${string}`
>;

type ArtifactStringBrand =
  | FrameworkSchemaLineageId
  | FrameworkSchemaCapabilityId
  | FrameworkSchemaArtifactCodecFormat
  | FrameworkSchemaArtifactSha256
  | FrameworkSchemaArtifactCanonicalJson;

type PlainStringIsArtifactStringBrand = string extends ArtifactStringBrand
  ? true
  : false;

type PlainNumberIsCodecVersion = number extends
  FrameworkSchemaArtifactCodecVersion ? true : false;

interface DependencyInput {
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly artifactSha256: unknown;
}

interface DigestObservation {
  readonly algorithm: AlgorithmIdentifier;
  readonly data: BufferSource;
  readonly receiver: unknown;
}

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "crypto",
);
const GOLDEN_CANONICAL_JSON =
  '{"capabilities":[],"dependencies":[],"deploymentId":"deployment-main",' +
  '"format":"flarex.framework-schema-artifact","lineageId":"lineage-main",' +
  '"owner":"payload","payload":{"tables":["posts"]},' +
  '"payloadCodec":{"format":"json","version":1},' +
  '"provenance":{"source":"compiler"},"version":1}';
const GOLDEN_SHA256 =
  "d521941d027c3597434af4a48ef79d1486698db73cec86819e38388635c23cff";

afterEach(() => {
  vi.unstubAllGlobals();
  restoreCryptoDescriptor();
});

describe("private framework schema artifacts", () => {
  it("keeps the checkpoint private, branded, and Effect-typed", () => {
    expectTypeOf<PublicArtifactExport>().toEqualTypeOf<never>();
    expectTypeOf<PlainStringIsArtifactStringBrand>().toEqualTypeOf<false>();
    expectTypeOf<PlainNumberIsCodecVersion>().toEqualTypeOf<false>();
    expectTypeOf<FrameworkSchemaLineageId>()
      .not.toMatchTypeOf<FrameworkSchemaCapabilityId>();
    expectTypeOf<FrameworkSchemaLineageId>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactCodecFormat>();
    expectTypeOf<FrameworkSchemaLineageId>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactSha256>();
    expectTypeOf<FrameworkSchemaLineageId>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactCanonicalJson>();
    expectTypeOf<FrameworkSchemaCapabilityId>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactCodecFormat>();
    expectTypeOf<FrameworkSchemaCapabilityId>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactSha256>();
    expectTypeOf<FrameworkSchemaCapabilityId>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactCanonicalJson>();
    expectTypeOf<FrameworkSchemaArtifactCodecFormat>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactSha256>();
    expectTypeOf<FrameworkSchemaArtifactCodecFormat>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactCanonicalJson>();
    expectTypeOf<FrameworkSchemaArtifactSha256>()
      .not.toMatchTypeOf<FrameworkSchemaArtifactCanonicalJson>();
    expectTypeOf<ReturnType<typeof normalizeFrameworkSchemaArtifact>>()
      .toEqualTypeOf<Result.Result<
        FrameworkSchemaArtifactFrame,
        FrameworkSchemaArtifactError
      >>();
    expectTypeOf<ReturnType<typeof captureFrameworkSchemaArtifact>>()
      .toEqualTypeOf<Effect.Effect<
        FrameworkSchemaArtifact,
        FrameworkSchemaArtifactError
      >>();
    expectTypeOf<ReturnType<typeof classifyFrameworkSchemaArtifactReplay>>()
      .toEqualTypeOf<Result.Result<
        FrameworkSchemaArtifactReplayClassification,
        FrameworkSchemaArtifactError
      >>();
  });

  it("pins the exact canonical frame and digest compatibility vector", async () => {
    const artifact = await runEffect(captureFrameworkSchemaArtifact(
      validInput(),
    ));

    expect(artifact.canonicalJson).toBe(GOLDEN_CANONICAL_JSON);
    expect(artifact.identity.artifactSha256).toBe(GOLDEN_SHA256);
  });

  it("captures deterministic canonical bytes and a lowercase SHA-256", async () => {
    const first = await runEffect(captureFrameworkSchemaArtifact(validInput({
      capabilities: ["catalog.write", "catalog.read"],
      dependencies: [
        dependency({ lineageId: "lineage-c", artifactSha256: digest("c") }),
        dependency({ lineageId: "lineage-b", artifactSha256: digest("b") }),
      ],
      provenance: { z: 1, a: { second: true, first: false } },
      payload: { z: [3, 2, 1], a: "payload" },
    })));
    const second = await runEffect(captureFrameworkSchemaArtifact(validInput({
      capabilities: ["catalog.read", "catalog.write"],
      dependencies: [
        dependency({ lineageId: "lineage-b", artifactSha256: digest("b") }),
        dependency({ lineageId: "lineage-c", artifactSha256: digest("c") }),
      ],
      provenance: { a: { first: false, second: true }, z: 1 },
      payload: { a: "payload", z: [3, 2, 1] },
    })));

    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.identity.artifactSha256).toBe(
      createHash("sha256").update(first.canonicalJson).digest("hex"),
    );
    expect(first.identity.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.identity.artifactSha256).toBe(
      second.identity.artifactSha256,
    );
    expect(first.capabilities).toEqual(["catalog.read", "catalog.write"]);
    expect(first.dependencies.map(({ lineageId }) => lineageId)).toEqual([
      "lineage-b",
      "lineage-c",
    ]);
  });

  it("makes every accepted input field participate in artifact identity", async () => {
    const inputs: readonly FrameworkSchemaArtifactCaptureInput[] = [
      validInput(),
      validInput({ deploymentId: "deployment-other" }),
      validInput({ owner: "medusa" }),
      validInput({ lineageId: "lineage-other" }),
      validInput({ payloadCodec: { format: "other", version: 1 } }),
      validInput({ payloadCodec: { format: "json", version: 2 } }),
      validInput({ provenance: { source: "other" } }),
      validInput({ capabilities: ["catalog.read"] }),
      validInput({ dependencies: [dependency()] }),
      validInput({ payload: { tables: ["other"] } }),
    ];
    const artifacts = [];
    for (const input of inputs) {
      artifacts.push(await runEffect(captureFrameworkSchemaArtifact(input)));
    }

    expect(new Set(artifacts.map(artifact => artifact.canonicalJson)).size)
      .toBe(inputs.length);
    expect(new Set(artifacts.map(artifact => artifact.identity.artifactSha256))
      .size).toBe(inputs.length);
  });

  it("uses UTF-8 ordering for identities and UTF-16 ordering for JSON keys", async () => {
    const bmp = "\uE000";
    const supplementary = "\u{10000}";
    const normalized = Result.getOrThrow(normalizeFrameworkSchemaArtifact(
      validInput({
        capabilities: [supplementary, bmp],
        dependencies: [
          dependency({ lineageId: supplementary, artifactSha256: digest("b") }),
          dependency({ lineageId: bmp, artifactSha256: digest("a") }),
        ],
        payload: { [bmp]: 1, [supplementary]: 2 },
      }),
    ));

    expect(normalized.capabilities).toEqual([bmp, supplementary]);
    expect(normalized.dependencies.map(({ lineageId }) => lineageId)).toEqual([
      bmp,
      supplementary,
    ]);
    expect(Object.keys(normalized.payload)).toEqual([supplementary, bmp]);

    const payload = await runEffect(captureFrameworkSchemaArtifact(validInput({
      owner: "payload",
    })));
    const medusa = await runEffect(captureFrameworkSchemaArtifact(validInput({
      owner: "medusa",
    })));
    const system = await runEffect(captureFrameworkSchemaArtifact(validInput({
      owner: "system",
    })));
    expect(compareFrameworkSchemaArtifactIdentities(
      payload.identity,
      medusa.identity,
    )).toBeLessThan(0);
    expect(compareFrameworkSchemaArtifactIdentities(
      medusa.identity,
      system.identity,
    )).toBeLessThan(0);

    const bmpIdentity = await identityWithLineage(bmp);
    const supplementaryIdentity = await identityWithLineage(supplementary);
    expect(compareFrameworkSchemaArtifactIdentities(
      bmpIdentity,
      supplementaryIdentity,
    )).toBeLessThan(0);
  });

  it("accepts exact null-prototype records and owns a deeply frozen snapshot", async () => {
    const nullPrototypePayload = Object.create(null);
    Object.defineProperty(nullPrototypePayload, "value", {
      value: 1,
      enumerable: true,
    });
    const shared = { nested: [1, 2] };
    const provenance = { source: "compiler" };
    const capabilities = ["catalog.read"];
    const input = validInput({
      provenance,
      capabilities,
      payload: {
        left: shared,
        nullPrototypePayload,
        right: shared,
      },
    });
    const artifact = await runEffect(captureFrameworkSchemaArtifact(input));

    provenance.source = "mutated";
    capabilities[0] = "mutated";
    shared.nested[0] = 99;

    expect(artifact.provenance).toEqual({ source: "compiler" });
    expect(artifact.capabilities).toEqual(["catalog.read"]);
    expect(artifact.payload).toEqual({
      left: { nested: [1, 2] },
      nullPrototypePayload: { value: 1 },
      right: { nested: [1, 2] },
    });
    expect(Object.getPrototypeOf(artifact.payload)).toBeNull();
    expectDeeplyFrozen(artifact);

    const left = artifact.payload.left;
    const right = artifact.payload.right;
    expect(isJsonObject(left)).toBe(true);
    expect(isJsonObject(right)).toBe(true);
    if (isJsonObject(left) && isJsonObject(right)) {
      expect(left).not.toBe(right);
      expect(left.nested).not.toBe(right.nested);
    }
  });

  it("rejects extra keys, symbols, accessors, exotic records, and reflection failures", () => {
    const extraTopLevel = { ...validInput(), extra: true };
    const computedTopLevel = {
      ...validInput(),
      artifactSha256: digest("a"),
    };
    const extraCodec = { format: "json", version: 1, extra: true };
    const extraDependency = {
      ...dependency(),
      canonicalJson: "computed",
    };
    const symbolPayload = { value: 1 };
    Object.defineProperty(symbolPayload, Symbol("extra"), {
      value: true,
      enumerable: true,
    });
    const accessorPayload = {};
    let accessorReads = 0;
    Object.defineProperty(accessorPayload, "value", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 1;
      },
    });
    const topLevelAccessor = { ...validInput() };
    Object.defineProperty(topLevelAccessor, "deploymentId", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "deployment-main";
      },
    });
    const codecAccessor = { version: 1 };
    Object.defineProperty(codecAccessor, "format", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "json";
      },
    });
    const nonEnumerablePayload = {};
    Object.defineProperty(nonEnumerablePayload, "value", {
      value: 1,
      enumerable: false,
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    for (const invalid of [
      extraTopLevel,
      computedTopLevel,
      validInput({ payloadCodec: extraCodec }),
      validInput({ dependencies: [extraDependency] }),
      validInput({ payload: symbolPayload }),
      validInput({ payload: accessorPayload }),
      topLevelAccessor,
      validInput({ payloadCodec: codecAccessor }),
      validInput({ payload: nonEnumerablePayload }),
      validInput({ payload: new Date(0) }),
      validInput({ payload: revoked.proxy }),
    ]) {
      expectNormalizationFailure(invalid, "invalidInput");
    }
    expect(accessorReads).toBe(0);
  });

  it("reads admitted descriptors once and fails closed at each reflection trap", () => {
    const target = { first: 1, second: 2 };
    let prototypeReads = 0;
    let ownKeyReads = 0;
    let valueReads = 0;
    const descriptorReads = new Map<PropertyKey, number>();
    const observed = new Proxy(target, {
      getPrototypeOf(currentTarget) {
        prototypeReads += 1;
        return Reflect.getPrototypeOf(currentTarget);
      },
      ownKeys(currentTarget) {
        ownKeyReads += 1;
        return Reflect.ownKeys(currentTarget);
      },
      getOwnPropertyDescriptor(currentTarget, key) {
        descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
        return Reflect.getOwnPropertyDescriptor(currentTarget, key);
      },
      get(currentTarget, key, receiver) {
        valueReads += 1;
        return Reflect.get(currentTarget, key, receiver);
      },
    });
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      payload: observed,
    })))).toBe(true);
    expect(prototypeReads).toBe(1);
    expect(ownKeyReads).toBe(1);
    expect(descriptorReads).toEqual(new Map<PropertyKey, number>([
      ["first", 1],
      ["second", 1],
    ]));
    expect(valueReads).toBe(0);

    const reflectionCause = new Error("reflection failed");
    for (const hostile of [
      new Proxy({}, {
        getPrototypeOf() {
          throw reflectionCause;
        },
      }),
      new Proxy({}, {
        ownKeys() {
          throw reflectionCause;
        },
      }),
      new Proxy({ value: 1 }, {
        getOwnPropertyDescriptor() {
          throw reflectionCause;
        },
      }),
    ]) {
      expectNormalizationFailure(validInput({ payload: hostile }), "invalidInput");
    }

    let payloadOwnKeyReads = 0;
    const untouchedPayload = new Proxy({}, {
      ownKeys(currentTarget) {
        payloadOwnKeyReads += 1;
        return Reflect.ownKeys(currentTarget);
      },
    });
    const invalidProvenance = {};
    Object.defineProperty(invalidProvenance, "computed", {
      enumerable: true,
      get() {
        return true;
      },
    });
    expectNormalizationFailure(validInput({
      provenance: invalidProvenance,
      payload: untouchedPayload,
    }), "invalidInput");
    expect(payloadOwnKeyReads).toBe(0);
  });

  it("rejects sparse, decorated, revoked, and absurdly large arrays promptly", () => {
    const sparse = new Array<string>(2);
    sparse[1] = "catalog.read";
    const decorated = ["catalog.read"];
    Object.defineProperty(decorated, "extra", {
      value: true,
      enumerable: true,
    });
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    const hugeSparse = new Array(0xffff_ffff);
    const mismatchedCapabilities = mismatchedDenseArrayProxy("catalog.read");
    const mismatchedJson = mismatchedDenseArrayProxy(1);
    let accessorReads = 0;
    const accessorElement = [1];
    Object.defineProperty(accessorElement, "0", {
      enumerable: true,
      configurable: true,
      get() {
        accessorReads += 1;
        return 1;
      },
    });
    const nonEnumerableElement = [1];
    Object.defineProperty(nonEnumerableElement, "0", {
      value: 1,
      enumerable: false,
    });
    const symbolElement = [1];
    Object.defineProperty(symbolElement, Symbol("extra"), {
      value: true,
      enumerable: true,
    });

    for (const invalid of [
      validInput({ capabilities: sparse }),
      validInput({ capabilities: decorated }),
      validInput({ capabilities: revoked.proxy }),
      validInput({ capabilities: mismatchedCapabilities }),
      validInput({ payload: { mismatchedJson } }),
      validInput({ payload: { accessorElement } }),
      validInput({ payload: { nonEnumerableElement } }),
      validInput({ payload: { symbolElement } }),
      validInput({ payload: { hugeSparse } }),
    ]) {
      expectNormalizationFailure(invalid, "invalidInput");
    }
    expect(accessorReads).toBe(0);
  });

  it("enforces owner, identity, codec, locality, and collection contracts", () => {
    const invalidInputs: ReadonlyArray<Readonly<{
      readonly label: string;
      readonly input: unknown;
      readonly reason?: "invalidInput" | "ownerNotAdmitted";
    }>> = [
      {
        label: "application owner",
        input: validInput({ owner: "application" }),
        reason: "ownerNotAdmitted",
      },
      { label: "unknown owner", input: validInput({ owner: "unknown" }) },
      { label: "blank deployment", input: validInput({ deploymentId: " " }) },
      { label: "NUL deployment", input: validInput({ deploymentId: "bad\0id" }) },
      { label: "unpaired surrogate", input: validInput({ deploymentId: "\ud800" }) },
      {
        label: "zero codec version",
        input: validInput({ payloadCodec: { format: "json", version: 0 } }),
      },
      {
        label: "fractional codec version",
        input: validInput({ payloadCodec: { format: "json", version: 1.5 } }),
      },
      {
        label: "duplicate capabilities",
        input: validInput({ capabilities: ["same", "same"] }),
      },
      {
        label: "duplicate dependencies",
        input: validInput({
          dependencies: [dependency(), dependency()],
        }),
      },
      {
        label: "foreign deployment dependency",
        input: validInput({
          dependencies: [dependency({ deploymentId: "foreign" })],
        }),
      },
      {
        label: "foreign owner dependency",
        input: validInput({
          dependencies: [dependency({ owner: "medusa" })],
        }),
      },
      {
        label: "application dependency",
        input: validInput({
          dependencies: [dependency({ owner: "application" })],
        }),
      },
      {
        label: "self dependency",
        input: validInput({
          dependencies: [dependency({ lineageId: "lineage-main" })],
        }),
      },
      {
        label: "uppercase digest",
        input: validInput({
          dependencies: [dependency({ artifactSha256: digest("A") })],
        }),
      },
    ];

    for (const { input, label, reason = "invalidInput" } of invalidInputs) {
      expectNormalizationFailure(input, reason, label);
    }
  });

  it("enforces exact identity and collection limits", () => {
    const maximumIdentity = "x".repeat(
      MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES,
    );
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      deploymentId: maximumIdentity,
    })))).toBe(true);
    expectNormalizationFailure(validInput({
      deploymentId: `${maximumIdentity}x`,
    }), "invalidInput");

    const maximumCapabilities = Array.from(
      { length: MAX_FRAMEWORK_SCHEMA_ARTIFACT_CAPABILITIES },
      (_, index) => `capability-${index}`,
    );
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      capabilities: maximumCapabilities,
    })))).toBe(true);
    expectNormalizationFailure(validInput({
      capabilities: [...maximumCapabilities, "one-too-many"],
    }), "invalidInput");

    const maximumDependencies = Array.from(
      { length: MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES },
      (_, index) => dependency({
        lineageId: `dependency-${index}`,
        artifactSha256: index.toString(16).padStart(64, "0"),
      }),
    );
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      dependencies: maximumDependencies,
    })))).toBe(true);
    expectNormalizationFailure(validInput({
      dependencies: [
        ...maximumDependencies,
        dependency({ lineageId: "one-too-many" }),
      ],
    }), "invalidInput");
  });

  it("measures identity limits in UTF-8 and preserves admitted spelling", async () => {
    const exactMultibyteIdentity = "é".repeat(
      MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES / 2,
    );
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      deploymentId: exactMultibyteIdentity,
    })))).toBe(true);
    expectNormalizationFailure(validInput({
      deploymentId: `${exactMultibyteIdentity}é`,
    }), "invalidInput");

    const spaced = await runEffect(captureFrameworkSchemaArtifact(validInput({
      deploymentId: "  deployment-main  ",
    })));
    expect(spaced.identity.deploymentId).toBe("  deployment-main  ");

    const composed = await runEffect(captureFrameworkSchemaArtifact(validInput({
      lineageId: "é",
    })));
    const decomposed = await runEffect(captureFrameworkSchemaArtifact(validInput({
      lineageId: "e\u0301",
    })));
    expect(composed.identity.lineageId).toBe("é");
    expect(decomposed.identity.lineageId).toBe("e\u0301");
    expect(composed.canonicalJson).not.toBe(decomposed.canonicalJson);
    expect(composed.identity.artifactSha256).not.toBe(
      decomposed.identity.artifactSha256,
    );
  });

  it("enforces the shared JSON depth and node budgets exactly", () => {
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      payload: nestedObject(
        MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_CONTAINER_LEVELS,
      ),
    })))).toBe(true);
    expectNormalizationFailure(validInput({
      payload: nestedObject(
        MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_CONTAINER_LEVELS + 1,
      ),
    }), "invalidInput");

    const exactRepeatedValues = new Array(
      MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES / 2 - 2,
    ).fill(0);
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      provenance: {},
      payload: {
        first: exactRepeatedValues,
        second: exactRepeatedValues,
      },
    })))).toBe(true);
    const exceededRepeatedValues = [...exactRepeatedValues, 0];
    expectNormalizationFailure(validInput({
      provenance: {},
      payload: {
        first: exceededRepeatedValues,
        second: exceededRepeatedValues,
      },
    }), "invalidInput");
  }, 120_000);

  it("rejects cycles and non-JSON values while allowing repeated acyclic input", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const repeated = { value: 1 };

    expectNormalizationFailure(validInput({ payload: cyclic }), "invalidInput");
    for (const invalidValue of [
      undefined,
      1n,
      Symbol("invalid"),
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expectNormalizationFailure(validInput({
        payload: { invalidValue },
      }), "invalidInput");
    }
    expect(Result.isSuccess(normalizeFrameworkSchemaArtifact(validInput({
      payload: { first: repeated, second: repeated },
    })))).toBe(true);
  });

  it("accepts the exact canonical-byte maximum and rejects the next byte before hashing", async () => {
    const { observations, subtle } = installRecordingCrypto();
    const baseline = await runEffect(captureFrameworkSchemaArtifact(validInput({
      payload: { pad: "" },
    })));
    const baselineBytes = new TextEncoder().encode(
      baseline.canonicalJson,
    ).byteLength;
    const padLength = MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES -
      baselineBytes;
    expect(padLength).toBeGreaterThan(0);

    const exact = await runEffect(captureFrameworkSchemaArtifact(validInput({
      payload: { pad: "x".repeat(padLength) },
    })));
    expect(new TextEncoder().encode(exact.canonicalJson).byteLength).toBe(
      MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
    );
    const callsBeforeOverflow = observations.length;
    const failure = await runEffectFailure(captureFrameworkSchemaArtifact(
      validInput({ payload: { pad: "x".repeat(padLength + 1) } }),
    ));

    expect(failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactError",
      operation: "capture",
      reason: "invalidInput",
      retryable: false,
    });
    expect(observations).toHaveLength(callsBeforeOverflow);
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(observation.algorithm).toBe("SHA-256");
      expect(observation.receiver).toBe(subtle);
      expect(observation.data).toBeInstanceOf(ArrayBuffer);
    }
  });

  it("classifies exact replay, different identity, and digest collision", async () => {
    const first = await runEffect(captureFrameworkSchemaArtifact(validInput()));
    const exact = await runEffect(captureFrameworkSchemaArtifact(validInput()));
    const different = await runEffect(captureFrameworkSchemaArtifact(validInput({
      payload: { tables: ["different"] },
    })));

    expect(Result.getOrThrow(classifyFrameworkSchemaArtifactReplay(
      first,
      exact,
    ))).toBe("exact");
    expect(Result.getOrThrow(classifyFrameworkSchemaArtifactReplay(
      first,
      different,
    ))).toBe("differentIdentity");

    const collision = Object.freeze({
      ...first,
      canonicalJson: different.canonicalJson,
    });
    const result = classifyFrameworkSchemaArtifactReplay(first, collision);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "FrameworkSchemaArtifactError",
        operation: "classifyReplay",
        reason: "digestCollision",
        message: "Framework schema artifact digest collision",
        retryable: false,
      });
    }
  });

  it("maps every WebCrypto acquisition and digest failure to one typed error", async () => {
    vi.stubGlobal("crypto", undefined);
    const missing = await runEffectFailure(captureFrameworkSchemaArtifact(
      validInput(),
    ));
    expectHashFailure(missing);

    vi.unstubAllGlobals();
    for (const partialCrypto of [{}, { subtle: {} }]) {
      vi.stubGlobal("crypto", partialCrypto);
      expectHashFailure(await runEffectFailure(
        captureFrameworkSchemaArtifact(validInput()),
      ));
      vi.unstubAllGlobals();
    }

    const globalAccessorCause = new Error("global crypto getter failed");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      get() {
        throw globalAccessorCause;
      },
    });
    const globalAccessor = await runEffectFailure(
      captureFrameworkSchemaArtifact(validInput()),
    );
    expectHashFailure(globalAccessor, globalAccessorCause);

    restoreCryptoDescriptor();
    for (const [cause, cryptoValue] of cryptoFailureFixtures()) {
      vi.stubGlobal("crypto", cryptoValue);
      const failure = await runEffectFailure(captureFrameworkSchemaArtifact(
        validInput(),
      ));
      expectHashFailure(failure, cause);
      vi.unstubAllGlobals();
    }

    const rejectedCause = new Error("one-call rejection");
    let rejectedCalls = 0;
    vi.stubGlobal("crypto", {
      subtle: {
        digest() {
          rejectedCalls += 1;
          return Promise.reject(rejectedCause);
        },
      },
    });
    expectHashFailure(await runEffectFailure(
      captureFrameworkSchemaArtifact(validInput()),
    ), rejectedCause);
    expect(rejectedCalls).toBe(1);
  });

  it("treats malformed fulfilled SHA-256 output as a defect", async () => {
    const detached = new ArrayBuffer(32);
    structuredClone(detached, { transfer: [detached] });
    const outputs: unknown[] = [
      {},
      new ArrayBuffer(31),
      new ArrayBuffer(33),
      detached,
      new Proxy(new ArrayBuffer(32), {}),
    ];
    if (typeof SharedArrayBuffer !== "undefined") {
      outputs.push(new SharedArrayBuffer(32));
    }

    for (const output of outputs) {
      vi.stubGlobal("crypto", cryptoReturning(output));
      const exit = await runEffect(Effect.exit(
        captureFrameworkSchemaArtifact(validInput()),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) {
        throw new Error("Expected malformed digest output to die.");
      }
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Result.getOrThrow(Cause.findDefect(exit.cause)))
        .toBeInstanceOf(FrameworkSchemaArtifactInvariantDefect);
      vi.unstubAllGlobals();
    }
  });

  it("keeps TextEncoder failures and post-measurement byte drift as defects", async () => {
    const intrinsicEncode = TextEncoder.prototype.encode;
    const encoderCause = new Error("canonical encoding failed");
    const throwingEncoder = vi.spyOn(TextEncoder.prototype, "encode")
      .mockImplementation(function (this: TextEncoder, input = "") {
        if (input.startsWith('{"capabilities"')) throw encoderCause;
        return intrinsicEncode.call(this, input);
      });
    try {
      const defect = await captureDefect();
      expect(Object.is(defect, encoderCause)).toBe(true);
    } finally {
      throwingEncoder.mockRestore();
    }

    const driftingEncoder = vi.spyOn(TextEncoder.prototype, "encode")
      .mockImplementation(function (this: TextEncoder, input = "") {
        if (input.startsWith('{"capabilities"')) return new Uint8Array();
        return intrinsicEncode.call(this, input);
      });
    try {
      const defect = await captureDefect();
      expect(defect).toMatchObject({
        _tag: "FrameworkSchemaArtifactInvariantDefect",
        reason: "canonicalByteLengthMismatch",
        observedByteLength: 0,
      });
    } finally {
      driftingEncoder.mockRestore();
    }
  });
});

function validInput(
  overrides: Partial<FrameworkSchemaArtifactCaptureInput> = {},
): FrameworkSchemaArtifactCaptureInput {
  return {
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: "lineage-main",
    payloadCodec: { format: "json", version: 1 },
    provenance: { source: "compiler" },
    capabilities: [],
    dependencies: [],
    payload: { tables: ["posts"] },
    ...overrides,
  };
}

function dependency(overrides: Partial<DependencyInput> = {}): DependencyInput {
  return {
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: "lineage-dependency",
    artifactSha256: digest("a"),
    ...overrides,
  };
}

function digest(character: string): string {
  return character.repeat(64);
}

function expectNormalizationFailure(
  input: unknown,
  reason: "invalidInput" | "ownerNotAdmitted",
  label?: string,
): void {
  const result = normalizeFrameworkSchemaArtifact(input);
  expect(Result.isFailure(result), label).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactError",
      operation: "capture",
      reason,
      message: reason === "ownerNotAdmitted"
        ? "Framework schema artifact owner is not admitted"
        : "Framework schema artifact input is invalid",
      retryable: false,
    });
  }
}

async function identityWithLineage(
  lineageId: string,
): Promise<FrameworkSchemaArtifactIdentity> {
  return (await runEffect(captureFrameworkSchemaArtifact(validInput({
    lineageId,
  })))).identity;
}

function nestedObject(containerLevels: number): object {
  let value: object = {};
  for (let level = 1; level < containerLevels; level += 1) {
    value = { next: value };
  }
  return value;
}

function expectDeeplyFrozen(input: unknown): void {
  if (input === null || typeof input !== "object") return;
  expect(Object.isFrozen(input)).toBe(true);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeeplyFrozen(descriptor.value);
    }
  }
}

function expectHashFailure(
  failure: FrameworkSchemaArtifactError,
  cause?: unknown,
): void {
  expect(failure).toMatchObject({
    _tag: "FrameworkSchemaArtifactError",
    operation: "capture",
    reason: "resourceFailure",
    message: "Framework schema artifact SHA-256 failed",
    retryable: false,
  });
  expect(Object.hasOwn(failure, "canonicalJson")).toBe(false);
  expect(Object.hasOwn(failure, "payload")).toBe(false);
  if (arguments.length === 2) {
    expect(Object.is(failure.cause, cause)).toBe(true);
  }
}

async function captureDefect(): Promise<unknown> {
  const exit = await runEffect(Effect.exit(
    captureFrameworkSchemaArtifact(validInput()),
  ));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected framework schema artifact capture to die.");
  }
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(Cause.hasFails(exit.cause)).toBe(false);
  return Result.getOrThrow(Cause.findDefect(exit.cause));
}

function cryptoFailureFixtures(): ReadonlyArray<readonly [unknown, object]> {
  const subtleAccessorCause = new Error("subtle getter failed");
  const subtleAccessor = {};
  Object.defineProperty(subtleAccessor, "subtle", {
    get() {
      throw subtleAccessorCause;
    },
  });

  const digestAccessorCause = new Error("digest getter failed");
  const digestAccessor = {};
  Object.defineProperty(digestAccessor, "digest", {
    get() {
      throw digestAccessorCause;
    },
  });

  const synchronousCause = new Error("digest call failed");
  const rejectedCause = Object.freeze({ kind: "digest rejected" });
  return [
    [subtleAccessorCause, subtleAccessor],
    [digestAccessorCause, { subtle: digestAccessor }],
    [synchronousCause, {
      subtle: {
        digest() {
          throw synchronousCause;
        },
      },
    }],
    [rejectedCause, {
      subtle: {
        digest() {
          return Promise.reject(rejectedCause);
        },
      },
    }],
  ];
}

function cryptoReturning(output: unknown): object {
  return {
    subtle: {
      digest() {
        return Promise.resolve(output);
      },
    },
  };
}

function installRecordingCrypto(): Readonly<{
  observations: DigestObservation[];
  subtle: object;
}> {
  const observations: DigestObservation[] = [];
  const subtle = {
    digest(
      this: unknown,
      algorithm: AlgorithmIdentifier,
      data: BufferSource,
    ): Promise<ArrayBuffer> {
      observations.push({ algorithm, data, receiver: this });
      const bytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      const output = new ArrayBuffer(32);
      new Uint8Array(output).set(createHash("sha256").update(bytes).digest());
      return Promise.resolve(output);
    },
  };
  vi.stubGlobal("crypto", { subtle });
  return { observations, subtle };
}

function mismatchedDenseArrayProxy(value: unknown): unknown {
  const target = new Array(1);
  return new Proxy(target, {
    ownKeys() {
      return ["length", "extra"];
    },
    getOwnPropertyDescriptor(currentTarget, key) {
      if (key === "0") {
        return {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(currentTarget, key);
    },
  });
}

function restoreCryptoDescriptor(): void {
  if (originalCryptoDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, "crypto");
    return;
  }
  Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
}
