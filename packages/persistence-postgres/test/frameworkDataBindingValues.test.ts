import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import {
  captureBindingValue,
  isDataBindingSetFrame,
  isDataBindingActivationFrame,
  isDataBindingHeadFrame,
  restoreBindingValue,
} from "../src/frameworkSchema/binding/canonical";
import {
  readAdmittedDataBinding,
  readSyntheticTestSelection,
  type AdmittedDataBinding,
  type SyntheticTestSelection,
} from "../src/frameworkSchema/binding/selection";
import type { DataBindingSetFrame } from "../src/frameworkSchema/binding/model";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { capturePrivateCanonicalValue } from "../src/frameworkSchema/privateCanonicalValue";

function frame(): DataBindingSetFrame {
  return {
    format: "flarex.data-binding-set", logicalSchema: null,
    application: {
      deploymentId: "test-deployment",
      scopeId: "scope_34000000-0000-4000-8000-000000000001",
      physicalLocator: {
        kind: "database_per_scope",
        databaseKey: "test",
        schemaName: "public",
      },
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: "1",
      epoch: "epoch_34000000-0000-4000-8000-000000000002",
      authorizationRevocationEpoch: "0",
      activationSequence: "1",
      headSha256: "a".repeat(64),
      activationSha256: "b".repeat(64),
      revisionId: "test-revision",
      schemaVersionId: "test-schema",
      applicationSchemaSha256: "c".repeat(64),
      schemaManifestSha256: "d".repeat(64),
      readinessSha256: "e".repeat(64),
      readiness: { kind: "legacy", schemaBindingSha256: "f".repeat(64) },
    },
    payloadContent: null,
    payloadLifecycle: null,
    commerce: [],
    crossDomainReferences: [],
  };
}

describe("data binding value boundaries", () => {
  it("issues the checked detached frozen frame with one canonical digest", async () => {
    const input = { ...frame(), application: { ...frame().application } };
    let checked: DataBindingSetFrame | undefined;
    let checks = 0;
    const guard = (value: unknown): value is DataBindingSetFrame => {
      checks += 1;
      if (!isDataBindingSetFrame(value)) return false;
      checked = value;
      return true;
    };
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      const captured = await runEffect(captureBindingValue(input, guard));
      expect(checks).toBe(1);
      expect(digest).toHaveBeenCalledTimes(1);
      expect(captured.frame).toBe(checked);
      expect(captured.frame).not.toBe(input);
      expect(captured.frame.application).not.toBe(input.application);
      expect(Object.isFrozen(captured)).toBe(true);
      expect(Object.isFrozen(captured.frame)).toBe(true);
      expect(Object.isFrozen(captured.frame.application.readiness)).toBe(true);
      expect(Object.isFrozen(captured.frame.commerce)).toBe(true);
      const canonical = encodeCanonicalJson(input, () => { throw new Error("invalid test frame"); });
      expect(captured.canonicalJson).toBe(canonical);
      expect(captured.copyCanonicalBytes()).toEqual(new TextEncoder().encode(canonical));
      expect(captured.sha256Hex).toBe(createHash("sha256").update(canonical).digest("hex"));
      expect(captured.canonicalByteLength).toBe(captured.copyCanonicalBytes().byteLength);
      const bytes = captured.copyCanonicalBytes();
      const hash = captured.copySha256Bytes();
      expect(bytes).not.toBe(captured.copyCanonicalBytes());
      expect(hash).not.toBe(captured.copySha256Bytes());
      bytes.fill(0);
      hash.fill(0);
      input.application.revisionId = "mutated";
      expect(captured.frame.application.revisionId).toBe("test-revision");
      expect(captured.copyCanonicalBytes()).toEqual(new TextEncoder().encode(canonical));
      expect(captured.copySha256Bytes()).toEqual(new Uint8Array(createHash("sha256").update(canonical).digest()));
    } finally {
      digest.mockRestore();
    }
  });
  it("preserves intrinsic format/version refusals after hashing a broadly guarded frame", async () => {
    const guard = (value: unknown): value is JsonObject => value !== null &&
      typeof value === "object" && !Array.isArray(value);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      for (const input of [
        { format: "flarex.data-binding-set", version: 1 },
        { format: "flarex.data-binding-head", version: 1 },
        { format: "flarex.data-binding-activation", version: 1 },
        { format: "flarex.data-binding-activation", version: "2" },
        { format: "flarex.data-binding-activation", version: 4 },
        { format: "other", version: 2 },
        { format: "other" },
        { format: 1, version: 1 },
      ]) {
        digest.mockClear();
        expect(await runEffectFailure(captureBindingValue(input, guard)))
          .toMatchObject({ reason: "storedCorruption" });
        expect(digest).toHaveBeenCalledTimes(1);
      }
      for (const input of [
        { format: "flarex.data-binding-set" },
        { format: "flarex.data-binding-head", version: 2 },
        { format: "flarex.data-binding-activation", version: 2 },
        { format: "flarex.data-binding-activation", version: 3 },
        { format: "other", version: 1 },
      ]) expect((await runEffect(captureBindingValue(input, guard))).frame).toEqual(input);
      digest.mockClear();
      const refusal = new Error("digest unavailable");
      digest.mockRejectedValueOnce(refusal);
      expect(await runEffectFailure(captureBindingValue({ format: 1 }, guard)))
        .toMatchObject({ reason: "resourceFailure", cause: refusal });
      expect(digest).toHaveBeenCalledTimes(1);
      digest.mockClear();
      expect(await runEffectFailure(captureBindingValue(frame(), (_value): _value is JsonObject => false)))
        .toMatchObject({ reason: "invalidInput" });
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });
  it("issues the canonical zero frame without changing stored binding bytes", async () => {
    const input = { ...frame(), application: { ...frame().application, readiness: {
      kind: "relation", manifestSchemaBindingSha256: "a".repeat(64), boundPublicationSha256: "b".repeat(64),
      relationFrontierCommitSeq: "0", relationSetReadinessSha256: "c".repeat(64), relationCount: -0,
    } } };
    if (!isDataBindingSetFrame(input)) throw new Error("Invalid relation readiness fixture");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      const captured = await runEffect(captureBindingValue(input, isDataBindingSetFrame));
      expect(digest).toHaveBeenCalledTimes(1);
      expect(Object.is(input.application.readiness.relationCount, -0)).toBe(true);
      const readiness = captured.frame.application.readiness;
      if (readiness.kind !== "relation") throw new Error("Wrong captured readiness fixture");
      expect(Object.is(readiness.relationCount, -0)).toBe(false);
      expect(readiness.relationCount).toBe(0);
      expect(captured.canonicalJson).toBe(encodeCanonicalJson(input, () => { throw new Error("Invalid fixture"); }));
      expect(await runEffect(restoreBindingValue(captured.copyCanonicalBytes(), captured.sha256Hex,
        captured.frame.format, isDataBindingSetFrame))).toEqual(captured.frame);
    } finally {
      digest.mockRestore();
    }
  });
  it("still authenticates and detaches each foreign stored frame", async () => {
    const captured = await runEffect(captureBindingValue(frame(), isDataBindingSetFrame));
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      const restored = await runEffect(restoreBindingValue(captured.copyCanonicalBytes(),
        captured.sha256Hex, captured.frame.format, isDataBindingSetFrame));
      expect(digest).toHaveBeenCalledTimes(1);
      expect(restored).toEqual(captured.frame);
      expect(restored).not.toBe(captured.frame);
      expect(restored.application).not.toBe(captured.frame.application);
      expect(Object.isFrozen(restored.application.readiness)).toBe(true);
      for (const [bytes, sha256Hex] of [
        [captured.copyCanonicalBytes(), "0".repeat(64)],
        [new TextEncoder().encode(` ${captured.canonicalJson}`),
          createHash("sha256").update(` ${captured.canonicalJson}`).digest("hex")],
      ] as const) {
        digest.mockClear();
        expect(await runEffectFailure(restoreBindingValue(bytes, sha256Hex,
          captured.frame.format, isDataBindingSetFrame))).toMatchObject({ reason: "storedCorruption" });
        expect(digest).toHaveBeenCalledTimes(1);
      }
    } finally {
      digest.mockRestore();
    }
  });
  it("binds sorted strong-reference endpoints into the current head format", async () => {
    const head = { format: "flarex.data-binding-head", version: 2,
      scopeId: frame().application.scopeId, storageGeneration: "flarexdb_v1", sequence: "1",
      activationSha256: "a".repeat(64), candidateSha256: "b".repeat(64),
      strongReferenceTableIds: [1, 3] };
    const captured = await runEffect(captureBindingValue(head, isDataBindingHeadFrame));
    expect(await runEffect(restoreBindingValue(captured.copyCanonicalBytes(), captured.sha256Hex,
      head.format, isDataBindingHeadFrame))).toEqual(head);
    for (const predecessor of [{ ...head, version: 1 }, { ...head, strongReferenceTableIds: [3, 1] },
      { ...head, strongReferenceTableIds: [1, 1] }])
      expect(await runEffectFailure(captureBindingValue(predecessor, isDataBindingHeadFrame)))
        .toMatchObject({ reason: "invalidInput" });
  });
  it("requires the activation-owned reference projection", async () => {
    const activation = { format: "flarex.data-binding-activation", version: 2,
      request: { format: "flarex.data-binding-activation-request", version: 1,
        scopeId: frame().application.scopeId, storageGeneration: "flarexdb_v1",
        requestId: "reference-projection", candidateSha256: "a".repeat(64), expectedHead: null },
      sequence: "1", activatedAt: "2026-09-05T00:00:00.000Z", strongReferences: [] };
    const captured = await runEffect(captureBindingValue(activation, isDataBindingActivationFrame));
    expect(await runEffect(restoreBindingValue(captured.copyCanonicalBytes(), captured.sha256Hex,
      activation.format, isDataBindingActivationFrame))).toEqual(activation);
    const accepted = { ...activation, version: 3, authorizationRevocationEpoch: "1" };
    const current = await runEffect(captureBindingValue(accepted, isDataBindingActivationFrame));
    expect(await runEffect(restoreBindingValue(current.copyCanonicalBytes(), current.sha256Hex,
      activation.format, isDataBindingActivationFrame))).toEqual(accepted);
    for (const invalid of [{ ...accepted, authorizationRevocationEpoch: "-1" },
      { ...accepted, authorizationRevocationEpoch: "01" }, { ...activation, authorizationRevocationEpoch: "1" },
      { ...activation, version: 3 }])
      expect(await runEffectFailure(captureBindingValue(invalid, isDataBindingActivationFrame)))
        .toMatchObject({ reason: "invalidInput" });
    for (const predecessor of [{ ...activation, version: 1 },
      (({ strongReferences: _, ...missing }) => missing)(activation)])
      expect(await runEffectFailure(captureBindingValue(predecessor, isDataBindingActivationFrame)))
        .toMatchObject({ reason: "invalidInput" });
    // Stored decoding must authenticate exact durable versions independently
    // of the writer's input guard, including a hash-valid malformed artifact.
    for (const invalid of [{ ...activation, version: 1 }, { ...accepted, version: 4 },
      (({ version: _, ...missing }) => missing)(activation),
      { ...accepted, authorizationRevocationEpoch: "01" },
      { ...activation, authorizationRevocationEpoch: "1" }]) {
      const stored = await runEffect(capturePrivateCanonicalValue(invalid, 1_048_576, {
        invalidInput: () => new Error("Invalid test canonical artifact"),
        hashFailure: cause => new Error("Cannot hash test canonical artifact", { cause }),
      }));
      expect(await runEffectFailure(restoreBindingValue(stored.copyCanonicalBytes(), stored.sha256Hex,
        activation.format, isDataBindingActivationFrame))).toMatchObject({ reason: "storedCorruption" });
    }
  });
  it("round-trips the current contract and rejects development-only predecessor formats", async () => {
    for (const input of [frame()]) {
      const captured = await runEffect(captureBindingValue(input, isDataBindingSetFrame));
      expect(await runEffect(restoreBindingValue(captured.copyCanonicalBytes(), captured.sha256Hex,
        captured.frame.format, isDataBindingSetFrame))).toEqual(input);
    }
    for (const input of [{ ...frame(), version: 1, commerce: null }, { ...frame(), version: 2 }, { ...frame(), commerce: null }, { ...frame(), version: 3 }]) {
      expect(await runEffectFailure(captureBindingValue(input, isDataBindingSetFrame))).toMatchObject({ reason: "invalidInput" });
    }
  });
  it.each([
    ["unknown slot", () => ({ ...frame(), system: null })],
    ["cross-domain slot", () => ({ ...frame(), crossDomainReferences: [{}] })],
    ["missing Application", () => ({ ...frame(), application: null })],
    ["missing logical selection", () => { const { logicalSchema, ...previous } = frame(); return previous; }],
    ["invalid logical selection", () => ({ ...frame(), logicalSchema: { schemaVersionId: "logical", manifestSha256: "bad" } })],
    ["logical digest trailing newline", () => ({ ...frame(), logicalSchema: { schemaVersionId: "logical", manifestSha256: "a".repeat(64) + "\n" } })],
    ["logical digest trailing carriage return", () => ({ ...frame(), logicalSchema: { schemaVersionId: "logical", manifestSha256: "a".repeat(64) + "\r" } })],
    ["extra logical authority", () => ({ ...frame(), logicalSchema: { schemaVersionId: "logical", manifestSha256: "a".repeat(64), ready: true } })],
    [
      "generation vocabulary",
      () => ({
        ...frame(),
        application: { ...frame().application, storageGeneration: "1" },
      }),
    ],
    [
      "noncanonical fence",
      () => ({
        ...frame(),
        application: { ...frame().application, storageGenerationFence: "01" },
      }),
    ],
    [
      "counter in identity",
      () => ({
        ...frame(),
        application: { ...frame().application, lastCommitSeq: "1" },
      }),
    ],
    [
      "unknown readiness",
      () => ({
        ...frame(),
        application: { ...frame().application, readiness: { kind: "ready" } },
      }),
    ],
    [
      "digest spelling",
      () => ({
        ...frame(),
        application: { ...frame().application, headSha256: "A".repeat(64) },
      }),
    ],
    ["symbol property", () => ({ ...frame(), [Symbol("hidden")]: true })],
    [
      "accessor",
      () =>
        Object.defineProperty(frame(), "commerce", {
          get: () => {
            throw new Error("must not execute getter");
          },
        }),
    ],
    [
      "throwing proxy",
      () =>
        new Proxy(frame(), {
          ownKeys: () => {
            throw new Error("foreign reflection");
          },
        }),
    ],
  ] as const)("rejects %s without database work", async (_name, make) => {
    expect(
      await runEffectFailure(
        captureBindingValue(make(), isDataBindingSetFrame),
      ),
    ).toMatchObject({ reason: "invalidInput" });
  });
  it("detaches caller state before digest suspension and authenticates stored bytes", async () => {
    const input = { ...frame(), application: { ...frame().application } };
    const pending = runEffect(
      captureBindingValue(input, isDataBindingSetFrame),
    );
    input.application.revisionId = "changed-after-capture";
    const captured = await pending;
    expect(captured.frame.application.revisionId).toBe("test-revision");
    expect(Object.isFrozen(captured.frame.application.readiness)).toBe(true);
    expect(
      await runEffect(
        restoreBindingValue(
          captured.copyCanonicalBytes(),
          captured.sha256Hex,
          captured.frame.format,
          isDataBindingSetFrame,
        ),
      ),
    ).toEqual(captured.frame);
    const bytes = captured.copyCanonicalBytes();
    bytes[0] = 32;
    expect(
      await runEffectFailure(
        restoreBindingValue(
          bytes,
          captured.sha256Hex,
          captured.frame.format,
          isDataBindingSetFrame,
        ),
      ),
    ).toMatchObject({ reason: "storedCorruption" });
  });
  it("refuses oversized bytes and sequence overflow before authority is issued", async () => {
    expect(
      await runEffectFailure(
        restoreBindingValue(
          new Uint8Array(1_048_577),
          "a".repeat(64),
          "flarex.data-binding-set",
          isDataBindingSetFrame,
        ),
      ),
    ).toMatchObject({ reason: "storedCorruption" });
    expect(
      isDataBindingActivationFrame({
        format: "flarex.data-binding-activation",
        version: 2,
        request: {
          format: "flarex.data-binding-activation-request",
          version: 1,
          scopeId: frame().application.scopeId,
          storageGeneration: "flarexdb_v1",
          requestId: "max",
          candidateSha256: "a".repeat(64),
          expectedHead: {
            sequence: "9223372036854775807",
            sha256: "b".repeat(64),
          },
        },
        sequence: "9223372036854775808",
        activatedAt: "2026-09-05T00:00:00.000Z",
        strongReferences: [],
      }),
    ).toBe(false);
  });
  it("keeps serving and synthetic authority nominal", async () => {
    // SAFETY: deliberate unissued handles exercise runtime authority validation.
    expect(
      await runEffectFailure(
        readAdmittedDataBinding({} as AdmittedDataBinding),
      ),
    ).toMatchObject({ reason: "invalidAuthority" });
    // SAFETY: the synthetic family has independent issuance and lifetime.
    expect(
      await runEffectFailure(
        readSyntheticTestSelection({} as SyntheticTestSelection),
      ),
    ).toMatchObject({ reason: "invalidAuthority" });
  });
});
