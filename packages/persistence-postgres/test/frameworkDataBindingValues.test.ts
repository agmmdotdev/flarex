import { describe, expect, it } from "vitest";
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
    for (const predecessor of [{ ...activation, version: 1 },
      (({ strongReferences: _, ...missing }) => missing)(activation)])
      expect(await runEffectFailure(captureBindingValue(predecessor, isDataBindingActivationFrame)))
        .toMatchObject({ reason: "invalidInput" });
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
