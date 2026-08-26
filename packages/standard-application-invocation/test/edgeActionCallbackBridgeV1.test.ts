import { describe, expect, it, vi } from "vitest";

import {
  makeEdgeActionCallbackBridgeV1,
  type EdgeActionCallbackEvidencePortV1,
  type EdgeActionCallbackSystemPortV1,
} from "../src/edgeActionCallbackBridgeV1";
import {
  MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { makeEdgeActionHostSyscallSequencerV1 } from
  "../src/edgeActionHostSyscallSequencerV1";

const LIMITS = Object.freeze({
  maximumSyscalls: 4,
  maximumArgumentBytes: 1_024,
  maximumResultBytes: 1_024,
});
const ANONYMOUS_IDENTITY = Object.freeze({ kind: "anonymous" as const });

describe("edge action callback bridge v1", () => {
  it("binds callbacks to one selection and deterministic child request key", async () => {
    const mutation = vi.fn<
      EdgeActionCallbackSystemPortV1<unknown>["runMutation"]
    >(() => Promise.resolve({ committed: true }));
    const evidence = evidencePort();
    const selection = Object.freeze({ candidate: "candidate-1" });
    const identity = Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "action-user-token",
        issuer: "https://identity.example.test",
        subject: "action-user",
      }),
    });
    const bridge = makeEdgeActionCallbackBridgeV1({
      selection,
      identity,
      evidence,
      sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
      parentRequestKey: "parent-1",
      ...LIMITS,
      system: {
        runQuery: () => Promise.resolve({ found: true }),
        runMutation: mutation,
      },
    });
    const args = { id: "order-1" };
    const result = await bridge.invoke({
      kind: "runMutation",
      ordinal: 1n,
      functionPath: "orders:update",
      arguments: args,
      argumentSemanticBytes: normalizeFlarexValueV1(args).semanticSizeBytes,
    });
    expect(result).toEqual({ committed: true });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[0]).toBe(selection);
    expect(mutation.mock.calls[0]?.[4]).toBe(identity);
    expect(mutation.mock.calls[0]?.[3]).toMatch(
      /^edge-action-mutation:v1:[0-9a-f]{64}$/,
    );
    expect(evidence.prepare).toHaveBeenCalledTimes(1);
    expect(evidence.declareDispatch).toHaveBeenCalledWith(1n);
    expect(evidence.confirm).toHaveBeenCalledWith(
      1n,
      expect.any(Uint8Array),
    );
  });

  it("bounds child keys for a maximum-length parent before dispatch", async () => {
    const parentRequestKey = "é".repeat(
      MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 / 2,
    );
    expect(TransactionRequestKeyV1Schema.make(parentRequestKey))
      .toBe(parentRequestKey);
    const childRequestKeys: string[] = [];
    const evidencePorts: EdgeActionCallbackEvidencePortV1[] = [];
    for (let replay = 0; replay < 2; replay += 1) {
      const evidence = sha256EvidencePort();
      evidencePorts.push(evidence);
      const bridge = makeEdgeActionCallbackBridgeV1({
        selection: "candidate-1",
        identity: ANONYMOUS_IDENTITY,
        evidence,
        sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
        parentRequestKey,
        ...LIMITS,
        system: {
          runQuery: () => Promise.resolve(null),
          runMutation: (_selection, _functionPath, _args, requestKey) => {
            childRequestKeys.push(requestKey);
            expect(TransactionRequestKeyV1Schema.make(requestKey))
              .toBe(requestKey);
            return Promise.resolve(true);
          },
        },
      });
      await expect(bridge.invoke({ ...request(1n), kind: "runMutation" }))
        .resolves.toBe(true);
    }
    expect(childRequestKeys).toEqual([
      childRequestKeys[0],
      childRequestKeys[0],
    ]);
    expect(new TextEncoder().encode(childRequestKeys[0]).byteLength)
      .toBeLessThanOrEqual(MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1);
    for (const evidence of evidencePorts) {
      expect(evidence.prepare).toHaveBeenCalledTimes(1);
      expect(evidence.confirm).toHaveBeenCalledTimes(1);
      expect(evidence.markUncertain).not.toHaveBeenCalled();
    }
  });

  it("binds every child stable-key facet before request-key projection", async () => {
    const baseline = await deriveChildRequestKey({});
    const repeated = await deriveChildRequestKey({});
    const variants = await Promise.all([
      deriveChildRequestKey({ parentRequestKey: "parent-2" }),
      deriveChildRequestKey({ precedingQuery: true }),
      deriveChildRequestKey({ functionPath: "orders:replace" }),
      deriveChildRequestKey({ argumentsValue: { id: "order-2" } }),
    ]);
    expect(repeated).toBe(baseline);
    expect(new Set([baseline, ...variants])).toHaveProperty("size", 5);
  });

  it("rejects an invalid mutation callee before preparing dispatch", async () => {
    const evidence = evidencePort();
    const mutation = vi.fn(() => Promise.resolve(true));
    const bridge = makeEdgeActionCallbackBridgeV1({
      selection: "candidate-1",
      identity: ANONYMOUS_IDENTITY,
      evidence,
      sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
      parentRequestKey: "parent-1",
      ...LIMITS,
      system: {
        runQuery: () => Promise.resolve(null),
        runMutation: mutation,
      },
    });
    await expect(bridge.invoke({
      ...request(1n),
      kind: "runMutation",
      functionPath: "orders:\0update",
    })).rejects.toMatchObject({ reason: "invalidRequest" });
    expect(evidence.prepare).not.toHaveBeenCalled();
    expect(evidence.declareDispatch).not.toHaveBeenCalled();
    expect(evidence.markUncertain).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it("fails closed on replay, gaps, size mismatch, and closed capability", async () => {
    const bridge = makeEdgeActionCallbackBridgeV1({
      selection: "candidate-1",
      identity: ANONYMOUS_IDENTITY,
      evidence: evidencePort(),
      sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
      parentRequestKey: "parent-1",
      ...LIMITS,
      system: {
        runQuery: () => Promise.resolve(null),
        runMutation: () => Promise.resolve(null),
      },
    });
    await expect(bridge.invoke(request(2n))).rejects.toMatchObject({
      reason: "sequenceMismatch",
    });
    await expect(bridge.invoke({ ...request(1n), argumentSemanticBytes: 99 }))
      .rejects.toMatchObject({ reason: "resourceExceeded" });
    await bridge.invoke(request(1n));
    await expect(bridge.invoke(request(1n))).rejects.toMatchObject({
      reason: "sequenceMismatch",
    });
    bridge.close();
    await expect(bridge.invoke(request(2n))).rejects.toMatchObject({
      reason: "closed",
    });
  });

  it("terminalizes a prepared child when dispatch declaration fails", async () => {
    const evidence = evidencePort();
    vi.mocked(evidence.declareDispatch).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const bridge = makeEdgeActionCallbackBridgeV1({
      selection: "candidate-1",
      identity: ANONYMOUS_IDENTITY,
      evidence,
      sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
      parentRequestKey: "parent-1",
      ...LIMITS,
      system: {
        runQuery: () => Promise.resolve(null),
        runMutation: () => Promise.resolve(null),
      },
    });
    await expect(bridge.invoke({ ...request(1n), kind: "runMutation" }))
      .rejects.toMatchObject({ reason: "mutationFailed" });
    expect(evidence.failBeforeDispatch).toHaveBeenCalledWith(
      1n,
      "edge_action_child_dispatch_not_declared",
    );
    expect(evidence.markUncertain).not.toHaveBeenCalled();
  });

  it("marks child mutation uncertainty after possible dispatch", async () => {
    const evidence = evidencePort();
    const bridge = makeEdgeActionCallbackBridgeV1({
      selection: "candidate-1",
      identity: ANONYMOUS_IDENTITY,
      evidence,
      sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
      parentRequestKey: "parent-1",
      ...LIMITS,
      system: {
        runQuery: () => Promise.resolve(null),
        runMutation: () => Promise.reject(new Error("lost outcome")),
      },
    });
    await expect(bridge.invoke({ ...request(1n), kind: "runMutation" }))
      .rejects.toMatchObject({ reason: "mutationFailed" });
    expect(evidence.markUncertain).toHaveBeenCalledWith(
      1n,
      "edge_action_child_mutation_uncertain",
    );
    expect(evidence.confirm).not.toHaveBeenCalled();
  });

  it("shares one host syscall budget across query callbacks and other host effects", async () => {
    const sequencer = makeEdgeActionHostSyscallSequencerV1(1);
    const query = vi.fn(() => Promise.resolve(null));
    const bridge = makeEdgeActionCallbackBridgeV1({
      selection: "candidate-1",
      identity: ANONYMOUS_IDENTITY,
      evidence: evidencePort(),
      sequencer,
      parentRequestKey: "parent-1",
      ...LIMITS,
      system: {
        runQuery: query,
        runMutation: () => Promise.resolve(null),
      },
    });
    await bridge.invoke(request(1n));
    expect(query).toHaveBeenCalledWith(
      "candidate-1",
      "orders:get",
      {},
      ANONYMOUS_IDENTITY,
    );
    expect(() => sequencer.next("outbound")).toThrowError(
      expect.objectContaining({ reason: "resourceExceeded" }),
    );
    await expect(bridge.invoke(request(2n))).rejects.toMatchObject({
      reason: "resourceExceeded",
    });
  });
});

function evidencePort(): EdgeActionCallbackEvidencePortV1 {
  return {
    hash: vi.fn(() => Promise.resolve(new Uint8Array(32).fill(1))),
    prepare: vi.fn(() => Promise.resolve({ effectOrdinal: 1n })),
    declareDispatch: vi.fn(() => Promise.resolve()),
    failBeforeDispatch: vi.fn(() => Promise.resolve()),
    confirm: vi.fn(() => Promise.resolve()),
    markUncertain: vi.fn(() => Promise.resolve()),
  };
}

function sha256EvidencePort(): EdgeActionCallbackEvidencePortV1 {
  const evidence = evidencePort();
  vi.mocked(evidence.hash).mockImplementation(async bytes => {
    const owned = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(owned).set(bytes);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  });
  return evidence;
}

async function deriveChildRequestKey(options: Readonly<{
  parentRequestKey?: string;
  precedingQuery?: boolean;
  functionPath?: string;
  argumentsValue?: Readonly<{ readonly id: string }>;
}>): Promise<string> {
  const childRequestKeys: string[] = [];
  const bridge = makeEdgeActionCallbackBridgeV1({
    selection: "candidate-1",
    identity: ANONYMOUS_IDENTITY,
    evidence: sha256EvidencePort(),
    sequencer: makeEdgeActionHostSyscallSequencerV1(LIMITS.maximumSyscalls),
    parentRequestKey: options.parentRequestKey ?? "parent-1",
    ...LIMITS,
    system: {
      runQuery: () => Promise.resolve(null),
      runMutation: (_selection, _functionPath, _args, requestKey) => {
        childRequestKeys.push(requestKey);
        return Promise.resolve(true);
      },
    },
  });
  if (options.precedingQuery === true) await bridge.invoke(request(1n));
  const argumentsValue = options.argumentsValue ?? { id: "order-1" };
  const ordinal = options.precedingQuery === true ? 2n : 1n;
  await bridge.invoke({
    kind: "runMutation",
    ordinal,
    functionPath: options.functionPath ?? "orders:update",
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
  });
  const requestKey = childRequestKeys[0];
  if (requestKey === undefined) {
    throw new Error("Child request key was not captured");
  }
  return requestKey;
}

function request(ordinal: bigint) {
  return {
    kind: "runQuery",
    ordinal,
    functionPath: "orders:get",
    arguments: {},
    argumentSemanticBytes: normalizeFlarexValueV1({}).semanticSizeBytes,
  };
}
