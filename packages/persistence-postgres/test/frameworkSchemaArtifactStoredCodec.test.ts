import { Cause, Effect, Exit, Result } from "effect";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import { hasExactOwnDataKeys } from "../src/exactOwnDataKeys";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import {
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactCaptureInput,
} from "../src/frameworkSchema/artifact/model";
import {
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES,
} from "../src/frameworkSchema/artifact/policy";
import {
  getPreparedFrameworkSchemaArtifactAdmissionEvidence,
  prepareFrameworkSchemaArtifactAdmission,
} from "../src/frameworkSchema/artifact/repository";
import {
  decodeStoredFrameworkSchemaArtifactDependencyRowsResult,
  decodeStoredFrameworkSchemaArtifactRowResult,
  decodeStoredFrameworkSchemaArtifactStorageIdResult,
  reconstructStoredFrameworkSchemaArtifactEffect,
  type DecodedStoredFrameworkSchemaArtifactRow,
  type FrameworkSchemaArtifactStoredIssue,
  type StoredFrameworkSchemaArtifactDependencyRow,
  type StoredFrameworkSchemaArtifactRow,
} from "../src/frameworkSchema/artifact/storedCodec";
import {
  runEffect,
  runEffectFailure,
} from "./effectTestRuntime";

interface DependencyInput {
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly artifactSha256: unknown;
}

interface StoredArtifactFixture {
  readonly artifact: FrameworkSchemaArtifact;
  readonly artifactRow: StoredFrameworkSchemaArtifactRow;
  readonly dependencyRows: readonly StoredFrameworkSchemaArtifactDependencyRow[];
}

const FRAME_KEYS = [
  "format",
  "version",
  "deploymentId",
  "owner",
  "lineageId",
  "payloadCodec",
  "provenance",
  "capabilities",
  "dependencies",
  "payload",
] as const;
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private framework schema artifact stored codec", () => {
  it("reconstructs authentic frozen artifacts with zero, two, and 256 dependencies", async () => {
    expectTypeOf<ReturnType<
      typeof reconstructStoredFrameworkSchemaArtifactEffect
    >>().toEqualTypeOf<Effect.Effect<
      FrameworkSchemaArtifact,
      FrameworkSchemaArtifactStoredIssue
    >>();
    expectTypeOf<ReturnType<
      typeof decodeStoredFrameworkSchemaArtifactRowResult
    >>().toEqualTypeOf<Result.Result<
      DecodedStoredFrameworkSchemaArtifactRow,
      FrameworkSchemaArtifactStoredIssue
    >>();

    const dependencySets: readonly (readonly DependencyInput[])[] = [
      [],
      [
        dependencyInput(1),
        dependencyInput(0),
      ],
      Array.from(
        { length: MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES },
        (_, index) => dependencyInput(index),
      ),
    ];

    for (const dependencies of dependencySets) {
      const fixture = await storedFixture({ dependencies });
      const reconstructed = await runEffect(
        reconstructStoredFrameworkSchemaArtifactEffect(
          fixture.artifact.identity,
          fixture.artifactRow,
          fixture.dependencyRows,
        ),
      );

      expect(reconstructed).toEqual(fixture.artifact);
      expect(reconstructed).not.toBe(fixture.artifact);
      expect(Object.isFrozen(reconstructed)).toBe(true);
      expect(Object.isFrozen(reconstructed.identity)).toBe(true);
      expect(Object.isFrozen(reconstructed.dependencies)).toBe(true);
      expect(Object.hasOwn(reconstructed, "artifactStorageId")).toBe(false);
      expect(Object.hasOwn(reconstructed, "admittedAt")).toBe(false);

      const prepared = Result.getOrThrow(
        prepareFrameworkSchemaArtifactAdmission(reconstructed),
      );
      expect(Result.isSuccess(
        getPreparedFrameworkSchemaArtifactAdmissionEvidence(prepared),
      )).toBe(true);
    }
  });

  it("owns decoded bytes and dates and enforces exact storage-ID bounds", async () => {
    expect(Result.getOrThrow(
      decodeStoredFrameworkSchemaArtifactStorageIdResult(1n),
    )).toBe(1n);
    expect(Result.getOrThrow(
      decodeStoredFrameworkSchemaArtifactStorageIdResult(
        POSTGRES_BIGINT_MAXIMUM,
      ),
    )).toBe(POSTGRES_BIGINT_MAXIMUM);
    for (const invalid of [
      1,
      "1",
      0n,
      -1n,
      POSTGRES_BIGINT_MAXIMUM + 1n,
    ]) {
      expectCorruption(
        decodeStoredFrameworkSchemaArtifactStorageIdResult(invalid),
        "artifactRow",
      );
    }

    const maximumIdentityFixture = await storedFixture({
      deploymentId: "x".repeat(1_024),
      lineageId: "\u200b",
      dependencies: [dependencyInput(0, {
        deploymentId: "x".repeat(1_024),
      })],
    });
    expect(Result.isSuccess(decodeStoredFrameworkSchemaArtifactRowResult(
      maximumIdentityFixture.artifact.identity,
      maximumIdentityFixture.artifactRow,
    ))).toBe(true);

    const fixture = await storedFixture({
      dependencies: [dependencyInput(0)],
    });
    const sourceDigest = requireBytes(fixture.artifactRow.artifactSha256);
    const sourceCanonical = requireBytes(fixture.artifactRow.canonicalBytes);
    const sourceAdmittedAt = requireDate(fixture.artifactRow.admittedAt);
    const expectedDigest = sourceDigest.slice();
    const expectedCanonical = sourceCanonical.slice();
    const expectedAdmittedAt = sourceAdmittedAt.getTime();
    const decoded = Result.getOrThrow(
      decodeStoredFrameworkSchemaArtifactRowResult(
        fixture.artifact.identity,
        fixture.artifactRow,
      ),
    );
    const decodedDependencies = Result.getOrThrow(
      decodeStoredFrameworkSchemaArtifactDependencyRowsResult(
        decoded,
        fixture.dependencyRows,
      ),
    );
    const dependencyDigest = requireBytes(
      fixture.dependencyRows[0]?.dependencyArtifactSha256,
    );
    const expectedDependencyDigestHex = decodedDependencies[0]
      ?.artifactSha256Hex;

    sourceDigest.fill(0);
    sourceCanonical.fill(0);
    sourceAdmittedAt.setTime(0);
    dependencyDigest.fill(0);
    const firstDigestProjection = decoded.artifactSha256Bytes;
    const firstCanonicalProjection = decoded.canonicalBytes;
    const firstDateProjection = decoded.admittedAt;
    firstDigestProjection.fill(1);
    firstCanonicalProjection.fill(1);
    firstDateProjection.setTime(1);

    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decodedDependencies)).toBe(true);
    expect(Object.isFrozen(decodedDependencies[0])).toBe(true);
    expect(decoded.artifactSha256Bytes).toEqual(expectedDigest);
    expect(decoded.canonicalBytes).toEqual(expectedCanonical);
    expect(decoded.admittedAt.getTime()).toBe(expectedAdmittedAt);
    expect(decodedDependencies[0]?.artifactSha256Hex).toBe(
      expectedDependencyDigestHex,
    );
  });

  it("rejects every malformed artifact-row family before reconstruction", async () => {
    const fixture = await storedFixture();
    const canonicalBytes = requireBytes(fixture.artifactRow.canonicalBytes);
    const invalidRows: ReadonlyArray<Readonly<{
      readonly label: string;
      readonly row: StoredFrameworkSchemaArtifactRow;
    }>> = [
      { label: "number storage ID", row: artifactRow(fixture, {
        artifactStorageId: 1,
      }) },
      { label: "zero storage ID", row: artifactRow(fixture, {
        artifactStorageId: 0n,
      }) },
      { label: "oversized storage ID", row: artifactRow(fixture, {
        artifactStorageId: POSTGRES_BIGINT_MAXIMUM + 1n,
      }) },
      { label: "blank deployment", row: artifactRow(fixture, {
        deploymentId: " \t\n",
      }) },
      { label: "NUL deployment", row: artifactRow(fixture, {
        deploymentId: "deployment\0bad",
      }) },
      { label: "unpaired deployment surrogate", row: artifactRow(fixture, {
        deploymentId: "\ud800",
      }) },
      { label: "oversized deployment", row: artifactRow(fixture, {
        deploymentId: "x".repeat(1_025),
      }) },
      { label: "application owner", row: artifactRow(fixture, {
        owner: "application",
      }) },
      { label: "blank lineage", row: artifactRow(fixture, {
        lineageId: "\ufeff",
      }) },
      { label: "short digest", row: artifactRow(fixture, {
        artifactSha256: new Uint8Array(31),
      }) },
      { label: "long digest", row: artifactRow(fixture, {
        artifactSha256: new Uint8Array(33),
      }) },
      { label: "text digest", row: artifactRow(fixture, {
        artifactSha256: "00".repeat(32),
      }) },
      { label: "wrong format", row: artifactRow(fixture, {
        frameFormat: "other",
      }) },
      { label: "wrong version", row: artifactRow(fixture, {
        frameVersion: 2,
      }) },
      { label: "zero stored length", row: artifactRow(fixture, {
        canonicalByteLength: 0,
      }) },
      { label: "fractional stored length", row: artifactRow(fixture, {
        canonicalByteLength: 1.5,
      }) },
      { label: "oversized observed length", row: artifactRow(fixture, {
        canonicalByteLength:
          MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES + 1,
        observedCanonicalByteLength:
          MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES + 1,
        canonicalBytes: null,
      }) },
      { label: "observed length mismatch", row: artifactRow(fixture, {
        observedCanonicalByteLength: canonicalBytes.byteLength + 1,
      }) },
      { label: "byte length mismatch", row: artifactRow(fixture, {
        canonicalBytes: canonicalBytes.subarray(1),
      }) },
      { label: "bounded bytes absent", row: artifactRow(fixture, {
        canonicalBytes: null,
      }) },
      { label: "invalid audit date", row: artifactRow(fixture, {
        admittedAt: new Date(Number.NaN),
      }) },
      { label: "text audit date", row: artifactRow(fixture, {
        admittedAt: "2026-08-31T00:00:00.000Z",
      }) },
    ];

    for (const { label, row } of invalidRows) {
      expectCorruption(
        decodeStoredFrameworkSchemaArtifactRowResult(
          fixture.artifact.identity,
          row,
        ),
        "artifactRow",
        label,
      );
    }
  });

  it("rejects malformed, inexact, and capture-invalid canonical frames", async () => {
    const fixture = await storedFixture();
    const frame = parsedFrame(fixture.artifact.canonicalJson);
    const cases: ReadonlyArray<Readonly<{
      readonly label: string;
      readonly bytes: Uint8Array;
    }>> = [
      { label: "invalid UTF-8", bytes: new Uint8Array([0xff]) },
      { label: "invalid JSON", bytes: encodeText("{") },
      ...FRAME_KEYS.map(key => ({
        label: `missing ${key}`,
        bytes: encodeText(JSON.stringify(withoutKey(frame, key))),
      })),
      {
        label: "extra frame key",
        bytes: encodeText(JSON.stringify({ ...frame, extra: true })),
      },
      {
        label: "wrong frame format",
        bytes: encodeText(JSON.stringify({ ...frame, format: "other" })),
      },
      {
        label: "wrong frame version",
        bytes: encodeText(JSON.stringify({ ...frame, version: 2 })),
      },
      {
        label: "capture-invalid payload",
        bytes: encodeText(JSON.stringify({ ...frame, payload: null })),
      },
      {
        label: "noncanonical whitespace",
        bytes: encodeText(JSON.stringify(frame, null, 2)),
      },
      {
        label: "noncanonical key order",
        bytes: encodeText(JSON.stringify(reverseEntries(frame))),
      },
      {
        label: "duplicate-key collapse",
        bytes: encodeText(
          fixture.artifact.canonicalJson.replace(
            "{",
            '{"format":"other",',
          ),
        ),
      },
    ];

    for (const { bytes, label } of cases) {
      const failure = await runEffectFailure(
        reconstructStoredFrameworkSchemaArtifactEffect(
          fixture.artifact.identity,
          rowWithCanonicalBytes(fixture.artifactRow, bytes),
          fixture.dependencyRows,
        ),
      );
      expectStoredCorruptionIssue(failure, "canonicalFrame", label);
    }

    let hashCalls = 0;
    vi.stubGlobal("crypto", {
      subtle: {
        digest() {
          hashCalls += 1;
          return Promise.reject(new Error("must not hash"));
        },
      },
    });
    const failure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        rowWithCanonicalBytes(fixture.artifactRow, encodeText("{")),
        fixture.dependencyRows,
      ),
    );
    expectStoredCorruptionIssue(failure, "canonicalFrame");
    expect(hashCalls).toBe(0);
  });

  it("distinguishes row drift from authentic canonical-evidence drift", async () => {
    const fixture = await storedFixture();
    expectCorruption(
      decodeStoredFrameworkSchemaArtifactRowResult(
        fixture.artifact.identity,
        artifactRow(fixture, { deploymentId: "deployment-other" }),
      ),
      "artifactRow",
    );

    const different = await storedFixture({ payload: { tables: ["other"] } });
    const digestDriftRow = artifactRow(fixture, {
      artifactSha256: different.artifactRow.artifactSha256,
    });
    const digestFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        different.artifact.identity,
        digestDriftRow,
        fixture.dependencyRows,
      ),
    );
    expectStoredCorruptionIssue(digestFailure, "canonicalFrame");

    const frame = parsedFrame(fixture.artifact.canonicalJson);
    const identityDriftBytes = encodeText(JSON.stringify({
      ...frame,
      deploymentId: "deployment-other",
    }));
    const identityFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        rowWithCanonicalBytes(fixture.artifactRow, identityDriftBytes),
        fixture.dependencyRows,
      ),
    );
    expectStoredCorruptionIssue(identityFailure, "canonicalFrame");
  });

  it("maps only hash rejection to neutral resource failure and preserves defects", async () => {
    const fixture = await storedFixture();
    const hashCause = Object.freeze({ kind: "hash rejected" });
    vi.stubGlobal("crypto", {
      subtle: {
        digest() {
          return Promise.reject(hashCause);
        },
      },
    });
    const resourceFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        fixture.artifactRow,
        fixture.dependencyRows,
      ),
    );
    expect(resourceFailure).toMatchObject({
      _tag: "FrameworkSchemaArtifactStoredResourceIssue",
      persistenceStage: "reconstructArtifact",
    });
    if (resourceFailure._tag !== "FrameworkSchemaArtifactStoredResourceIssue") {
      throw new Error("Expected a stored reconstruction resource issue.");
    }
    expect(Object.is(resourceFailure.cause, hashCause)).toBe(true);
    expect(Object.hasOwn(resourceFailure, "operation")).toBe(false);
    expect(Object.hasOwn(resourceFailure, "storedStage")).toBe(false);

    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", cryptoReturning(new ArrayBuffer(31)));
    const exit = await runEffect(Effect.exit(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        fixture.artifactRow,
        fixture.dependencyRows,
      ),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) {
      throw new Error("Expected malformed digest output to remain a defect.");
    }
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.hasFails(exit.cause)).toBe(false);
  });

  it("rejects every dependency mismatch without sorting or repair", async () => {
    const fixture = await storedFixture({
      dependencies: [dependencyInput(0), dependencyInput(1)],
    });
    const first = requireDependencyRow(fixture.dependencyRows, 0);
    const second = requireDependencyRow(fixture.dependencyRows, 1);
    const extra = {
      ...first,
      dependencyStorageId: 4n,
      dependencyOrdinal: 2,
      dependencyLineageId: "lineage-dependency-2",
      dependencyArtifactSha256: bytesFromHex("f".repeat(64)),
    } satisfies StoredFrameworkSchemaArtifactDependencyRow;
    const reordered = withDependencyRowCount([
      { ...second, dependencyOrdinal: 0 },
      { ...first, dependencyOrdinal: 1 },
    ]);
    const invalidRows: ReadonlyArray<Readonly<{
      readonly label: string;
      readonly rows: readonly StoredFrameworkSchemaArtifactDependencyRow[];
    }>> = [
      { label: "missing row", rows: withDependencyRowCount([first]) },
      { label: "extra row", rows: withDependencyRowCount([
        first,
        second,
        extra,
      ]) },
      { label: "ordinal gap", rows: withDependencyRowCount([
        { ...first, dependencyOrdinal: 1 },
        second,
      ]) },
      { label: "canonical reorder", rows: reordered },
      { label: "duplicate target storage ID", rows: withDependencyRowCount([
        first,
        { ...second, dependencyStorageId: first.dependencyStorageId },
      ]) },
      { label: "invalid target storage ID", rows: withDependencyRowCount([
        { ...first, dependencyStorageId: 0n },
        second,
      ]) },
      { label: "self target storage ID", rows: withDependencyRowCount([
        { ...first, dependencyStorageId: first.artifactStorageId },
        second,
      ]) },
      { label: "wrong parent storage ID", rows: withDependencyRowCount([
        { ...first, artifactStorageId: 2n },
        second,
      ]) },
      { label: "wrong deployment", rows: withDependencyRowCount([
        { ...first, deploymentId: "deployment-other" },
        second,
      ]) },
      { label: "wrong owner", rows: withDependencyRowCount([
        { ...first, owner: "medusa" },
        second,
      ]) },
      { label: "wrong parent lineage", rows: withDependencyRowCount([
        { ...first, artifactLineageId: "lineage-other" },
        second,
      ]) },
      { label: "same dependency lineage", rows: withDependencyRowCount([
        {
          ...first,
          dependencyLineageId: fixture.artifact.identity.lineageId,
        },
        second,
      ]) },
      { label: "wrong dependency lineage", rows: withDependencyRowCount([
        { ...first, dependencyLineageId: "lineage-other" },
        second,
      ]) },
      { label: "short joined digest", rows: withDependencyRowCount([
        { ...first, dependencyArtifactSha256: new Uint8Array(31) },
        second,
      ]) },
      { label: "joined digest drift", rows: withDependencyRowCount([
        {
          ...first,
          dependencyArtifactSha256: bytesFromHex("e".repeat(64)),
        },
        second,
      ]) },
      { label: "window count mismatch", rows: [
        { ...first, dependencyRowCountText: "257" },
        { ...second, dependencyRowCountText: "257" },
      ] },
      {
        label: "257 transferred rows",
        rows: Array.from(
          { length: MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES + 1 },
          () => first,
        ),
      },
    ];

    for (const { label, rows } of invalidRows) {
      const failure = await runEffectFailure(
        reconstructStoredFrameworkSchemaArtifactEffect(
          fixture.artifact.identity,
          fixture.artifactRow,
          rows,
        ),
      );
      expectStoredCorruptionIssue(failure, "dependencyRows", label);
    }
  });

  it("pins row, frame, hash, canonical, then dependency failure precedence", async () => {
    const fixture = await storedFixture({
      dependencies: [dependencyInput(0)],
    });
    const badDependencies = withDependencyRowCount([]);
    const badRowFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        artifactRow(fixture, {
          artifactStorageId: 0n,
          canonicalBytes: new Uint8Array([0xff]),
        }),
        badDependencies,
      ),
    );
    expectStoredCorruptionIssue(badRowFailure, "artifactRow");

    const badFrameFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        rowWithCanonicalBytes(fixture.artifactRow, new Uint8Array([0xff])),
        badDependencies,
      ),
    );
    expectStoredCorruptionIssue(badFrameFailure, "canonicalFrame");

    const hashCause = new Error("hash failed before dependencies");
    vi.stubGlobal("crypto", {
      subtle: {
        digest() {
          return Promise.reject(hashCause);
        },
      },
    });
    const hashFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        fixture.artifactRow,
        badDependencies,
      ),
    );
    expect(hashFailure).toMatchObject({
      _tag: "FrameworkSchemaArtifactStoredResourceIssue",
      persistenceStage: "reconstructArtifact",
    });
    vi.unstubAllGlobals();

    const noncanonical = encodeText(JSON.stringify(
      parsedFrame(fixture.artifact.canonicalJson),
      null,
      2,
    ));
    const canonicalFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        rowWithCanonicalBytes(fixture.artifactRow, noncanonical),
        badDependencies,
      ),
    );
    expectStoredCorruptionIssue(canonicalFailure, "canonicalFrame");

    const dependencyFailure = await runEffectFailure(
      reconstructStoredFrameworkSchemaArtifactEffect(
        fixture.artifact.identity,
        fixture.artifactRow,
        badDependencies,
      ),
    );
    expectStoredCorruptionIssue(dependencyFailure, "dependencyRows");
  });
});

async function storedFixture(
  overrides: Partial<FrameworkSchemaArtifactCaptureInput> = {},
): Promise<StoredArtifactFixture> {
  const artifact = await runEffect(captureFrameworkSchemaArtifact({
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: "lineage-main",
    payloadCodec: { format: "json", version: 1 },
    provenance: { source: "compiler" },
    capabilities: [],
    dependencies: [],
    payload: { tables: ["posts"] },
    ...overrides,
  }));
  const captured = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (captured === undefined) {
    throw new Error("Expected capture-owned evidence.");
  }
  const artifactStorageId = 1n;
  const artifactRowValue = {
    artifactStorageId,
    deploymentId: artifact.identity.deploymentId,
    owner: artifact.identity.owner,
    lineageId: artifact.identity.lineageId,
    artifactSha256: captured.artifactSha256Bytes,
    frameFormat: "flarex.framework-schema-artifact",
    frameVersion: 1,
    canonicalByteLength: captured.canonicalBytes.byteLength,
    observedCanonicalByteLength: captured.canonicalBytes.byteLength,
    canonicalBytes: captured.canonicalBytes,
    admittedAt: new Date("2026-08-31T00:00:00.000Z"),
  } satisfies StoredFrameworkSchemaArtifactRow;
  const dependencyRows = artifact.dependencies.map((dependency, index) => ({
    artifactStorageId,
    dependencyStorageId: BigInt(index + 2),
    deploymentId: artifact.identity.deploymentId,
    owner: artifact.identity.owner,
    artifactLineageId: artifact.identity.lineageId,
    dependencyOrdinal: index,
    dependencyLineageId: dependency.lineageId,
    dependencyArtifactSha256: bytesFromHex(dependency.artifactSha256),
    dependencyRowCountText: String(artifact.dependencies.length),
  } satisfies StoredFrameworkSchemaArtifactDependencyRow));
  return {
    artifact,
    artifactRow: artifactRowValue,
    dependencyRows,
  };
}

function artifactRow(
  fixture: StoredArtifactFixture,
  overrides: Partial<StoredFrameworkSchemaArtifactRow>,
): StoredFrameworkSchemaArtifactRow {
  return { ...fixture.artifactRow, ...overrides };
}

function rowWithCanonicalBytes(
  row: StoredFrameworkSchemaArtifactRow,
  canonicalBytes: Uint8Array,
): StoredFrameworkSchemaArtifactRow {
  return {
    ...row,
    canonicalByteLength: canonicalBytes.byteLength,
    observedCanonicalByteLength: canonicalBytes.byteLength,
    canonicalBytes,
  };
}

function dependencyInput(
  index: number,
  overrides: Partial<DependencyInput> = {},
): DependencyInput {
  return {
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: `lineage-dependency-${index.toString().padStart(3, "0")}`,
    artifactSha256: index.toString(16).padStart(64, "0"),
    ...overrides,
  };
}

function parsedFrame(
  canonicalJson: string,
): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(canonicalJson);
  if (!hasExactOwnDataKeys(parsed, FRAME_KEYS)) {
    throw new Error("Expected the captured canonical frame.");
  }
  return parsed;
}

function withoutKey(
  record: Readonly<Record<string, unknown>>,
  omitted: string,
): Readonly<Record<string, unknown>> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== omitted) copy[key] = value;
  }
  return copy;
}

function reverseEntries(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const reversed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record).reverse()) {
    reversed[key] = value;
  }
  return reversed;
}

function withDependencyRowCount(
  rows: ReadonlyArray<StoredFrameworkSchemaArtifactDependencyRow>,
): readonly StoredFrameworkSchemaArtifactDependencyRow[] {
  return rows.map(row => ({
    ...row,
    dependencyRowCountText: String(rows.length),
  }));
}

function requireDependencyRow(
  rows: readonly StoredFrameworkSchemaArtifactDependencyRow[],
  index: number,
): StoredFrameworkSchemaArtifactDependencyRow {
  const row = rows[index];
  if (row === undefined) throw new Error("Expected a dependency row.");
  return row;
}

function requireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error("Expected Uint8Array evidence.");
  }
  return value;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date)) throw new Error("Expected Date evidence.");
  return value;
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesFromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "hex"));
}

function expectCorruption(
  result: Result.Result<unknown, FrameworkSchemaArtifactStoredIssue>,
  storedStage: "artifactRow" | "canonicalFrame" | "dependencyRows",
  label?: string,
): void {
  expect(Result.isFailure(result), label).toBe(true);
  if (Result.isFailure(result)) {
    expectStoredCorruptionIssue(result.failure, storedStage, label);
  }
}

function expectStoredCorruptionIssue(
  issue: FrameworkSchemaArtifactStoredIssue,
  storedStage: "artifactRow" | "canonicalFrame" | "dependencyRows",
  label?: string,
): void {
  expect(issue, label).toEqual({
    _tag: "FrameworkSchemaArtifactStoredCorruptionIssue",
    storedStage,
  });
  expect(Object.hasOwn(issue, "cause"), label).toBe(false);
  expect(Object.hasOwn(issue, "operation"), label).toBe(false);
  expect(Object.hasOwn(issue, "message"), label).toBe(false);
  expect(Object.hasOwn(issue, "retryable"), label).toBe(false);
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
