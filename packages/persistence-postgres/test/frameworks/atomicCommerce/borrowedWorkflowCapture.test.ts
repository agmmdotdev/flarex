import { Cause, Effect, Exit, Result } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import { CommitSeqSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import type {
  SessionJournalAttempt,
} from "../../../src/execution/journal/api";
import type {
  BorrowedWorkflowAttemptInput,
} from "../../../src/frameworks/commerceTransaction/borrowedWorkflowAttempt";

const construction = vi.hoisted(() => ({ admissions: [] as unknown[], state: undefined as unknown }));

// Only admitted source construction is stubbed. The borrowed factory, bounded
// lifetime, capture operation, finite root issuer/gate, and workflow decoder run
// unchanged; these tests never execute source commands or storage operations.
vi.mock("../../../src/storage/documents/logicalDocuments/participantAdmission", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/storage/documents/logicalDocuments/participantAdmission")>();
  return { ...original, withLogicalParticipantAdmissionBundleEffect: (
    _bundle: unknown, _attempt: unknown, _participant: unknown, _method: unknown, _revision: unknown,
    work: (input: unknown) => Effect.Effect<unknown, unknown>,
  ) => work({ admissions: construction.admissions,
    readTransaction: () => Effect.die(new Error("Unexpected finite capture storage read")) }) };
});
vi.mock("../../../src/storage/documents/logicalDocuments/relationalAdmission", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/storage/documents/logicalDocuments/relationalAdmission")>();
  return { ...original, withLogicalRelationalAttemptAdmissionEffect: (
    _admission: unknown, _attempt: unknown, _method: unknown,
    _prepare: unknown, work: (state: unknown) => Effect.Effect<unknown, unknown>,
  ) => work(construction.state) };
});
vi.mock("../../../src/frameworks/atomicCommerce/participants", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/frameworks/atomicCommerce/participants")>();
  return { ...original, requirePreparedAtomicCommerceLogicalParticipant: (member: unknown) => Result.succeed(member) };
});
vi.mock("../../../src/storage/documents/logicalDocuments/workingSet", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/storage/documents/logicalDocuments/workingSet")>();
  return { ...original,
    combineLogicalWriteMechanics: () => Effect.succeed({ tables: [], unique: [], indexes: [], searchDefinitions: [], tableName: () => undefined }),
    makeLogicalDocumentWorkingSet: () => Effect.succeed(Object.freeze({})),
  };
});

import {
  makeBorrowedWorkflowAttempt,
} from "../../../src/frameworks/commerceTransaction/borrowedWorkflowAttempt";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../src/frameworks/atomicCommerce/events";
import {
  makeLogicalDocumentRootEvaluator,
} from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import { captureWorkflowValue } from "../../../../medusa-adapter/src/workflow/value";

beforeEach(() => { construction.admissions = []; construction.state = undefined; });

const fixture = (calls = 20, commandBytes = defaultCommerceResources.commandBytes) => {
  // SAFETY: the real local evaluator authenticates this opaque journal handle
  // by exact identity; the unused admission construction is isolated above.
  const attempt = Object.freeze({}) as SessionJournalAttempt;
  const pins = { attempt, scopeId: ScopeIdSchema.make("scope_91000000-0000-4000-8000-000000000001"),
    snapshotCommitSeq: CommitSeqSchema.make(1n), attemptFence: "capture-root" };
  const evaluator = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 65_536 });
  const prepared = Object.freeze({});
  const admission = Object.freeze({});
  const command = defineCommerceCommand("captureSource", "read", () => Effect.die(new Error("Unexpected source invocation")));
  construction.admissions = [admission];
  construction.state = { root: { ...pins, executionProfile: "finiteRoot", sessionId: "capture-session" },
    preparedSource: prepared, writeMechanics: Object.freeze({}) };
  const event = defineCommerceEventContract({ name: "capture.event", revision: "a".repeat(64), internal: true,
    decode: () => Effect.fail(commerceError("unadmittedEvent")) });
  // SAFETY: only the unused source-construction ports are inert. Actual pins,
  // resource policy, event contract, and request/root lifetime remain real.
  const input = { bundle: Object.freeze({}), admissions: [admission], attempt,
    participant: "capture", method: "run", profileRevision: "a".repeat(64),
    members: [{ participant: defineAtomicCommerceParticipant("capture"), prepared, commands: new Set([command]) }],
    events: { producerRevision: "a".repeat(64), contracts: [event],
      subscribers: [{ id: "capture", revision: "a".repeat(64) }], validate: () => Effect.void },
    resources: { ...defaultCommerceResources, calls, commandBytes }, rootEvaluator: evaluator, rootAttemptFence: pins.attemptFence,
    captureStorage: () => Effect.die(new Error("Unexpected finite capture storage demand")),
  } as unknown as BorrowedWorkflowAttemptInput;
  const inspect = vi.fn();
  const getter = vi.fn(() => "unsafe");
  const foreign = new Proxy(Object.defineProperty({}, "value", { get: getter, enumerable: true }), {
    getPrototypeOf: target => { inspect(); return Reflect.getPrototypeOf(target); },
    ownKeys: target => { inspect(); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor: (target, key) => { inspect(); return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  return { input, evaluator, inspect, getter, foreign };
};

it.each(["finiteRoot", "abortedLifetime", "exhaustedCalls"] as const)(
  "refuses foreign workflow reflection after actual borrowed %s closure", async reason => {
    const { input, evaluator, inspect, getter, foreign } = fixture(reason === "exhaustedCalls" ? 2 : 20);
    const borrowed = await Effect.runPromise(makeBorrowedWorkflowAttempt(input));
    try {
      if (reason === "finiteRoot") evaluator.close();
      if (reason === "abortedLifetime") await Effect.runPromise(borrowed.abort);
      const exit = await Effect.runPromise(Effect.exit(captureWorkflowValue(borrowed.context, foreign)));
      if (Exit.isSuccess(exit)) throw new Error("Expected borrowed root refusal");
      const expected = reason === "finiteRoot" ? "closed" : reason === "abortedLifetime" ? "invalidAuthority" : "limitExceeded";
      expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({ reason: expected });
      if (reason !== "abortedLifetime") {
        const sticky = await Effect.runPromise(Effect.exit(captureWorkflowValue(borrowed.context, foreign)));
        if (Exit.isSuccess(sticky)) throw new Error("Expected sticky borrowed root refusal");
        const refusal = sticky.cause.reasons.find(Cause.isFailReason)?.error;
        expect(refusal).toMatchObject({ reason: "rollbackOnly" });
        if (refusal === undefined || !Cause.isCause(refusal.cause)) throw new Error("Expected original root Cause");
        expect(refusal.cause.reasons.find(Cause.isFailReason)?.error)
          .toBe(exit.cause.reasons.find(Cause.isFailReason)?.error);
      }
      expect(inspect).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(borrowed.abort); evaluator.close(); }
  },
);

it("preserves a decoder defect in the original borrowed lifetime Cause and refuses later reflection", async () => {
  const { input, evaluator, foreign, inspect } = fixture();
  const borrowed = await Effect.runPromise(makeBorrowedWorkflowAttempt(input));
  const defect = new Error("borrowed decoder defect");
  try {
    const first = await Effect.runPromise(Effect.exit(borrowed.context.capture(null, () => { throw defect; })));
    if (Exit.isSuccess(first)) throw new Error("Expected decoder defect");
    expect(first.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect);
    const second = await Effect.runPromise(Effect.exit(captureWorkflowValue(borrowed.context, foreign)));
    if (Exit.isSuccess(second)) throw new Error("Expected sticky decoder refusal");
    expect(second.cause.reasons.find(Cause.isFailReason)?.error)
      .toMatchObject({ reason: "rollbackOnly", cause: first.cause });
    const sealed = await Effect.runPromise(Effect.exit(borrowed.close));
    if (Exit.isSuccess(sealed)) throw new Error("Expected original refusal at seal");
    expect(sealed.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect);
    expect(inspect).not.toHaveBeenCalled();
  } finally { await Effect.runPromise(borrowed.abort); evaluator.close(); }
});

it("charges the complete normalized omission envelope once through the borrowed root", async () => {
  const { input, evaluator } = fixture();
  const borrowed = await Effect.runPromise(makeBorrowedWorkflowAttempt(input));
  const foreign = { missing: undefined, nested: { count: 1, missing: undefined } };
  try {
    const before = borrowed.currentUsage();
    const owned = await Effect.runPromise(captureWorkflowValue(borrowed.context, foreign));
    expect(owned).toEqual(foreign);
    expect(owned).not.toBe(foreign);
    const envelope = { payload: { value: { nested: { count: 1 } } },
      omitted: [["value", "missing"], ["value", "nested", "missing"]] };
    expect(borrowed.currentUsage()).toEqual({
      workCalls: before.workCalls + 1,
      workBytes: before.workBytes + new TextEncoder().encode(JSON.stringify(envelope)).byteLength,
    });
    expect(Object.getOwnPropertyDescriptor(owned, "missing"))
      .toMatchObject({ value: undefined, writable: true, enumerable: true, configurable: true });
  } finally { await Effect.runPromise(borrowed.abort); evaluator.close(); }
});

it("keeps byte exhaustion sticky before inspecting another foreign workflow input", async () => {
  const { input, evaluator, foreign, inspect, getter } = fixture(20, 32);
  const borrowed = await Effect.runPromise(makeBorrowedWorkflowAttempt(input));
  try {
    const first = await Effect.runPromise(Effect.exit(captureWorkflowValue(borrowed.context, { value: "x".repeat(100) })));
    if (Exit.isSuccess(first)) throw new Error("Expected captured envelope byte refusal");
    expect(first.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({ reason: "limitExceeded" });
    const second = await Effect.runPromise(Effect.exit(captureWorkflowValue(borrowed.context, foreign)));
    if (Exit.isSuccess(second)) throw new Error("Expected sticky byte refusal");
    expect(second.cause.reasons.find(Cause.isFailReason)?.error)
      .toMatchObject({ reason: "rollbackOnly", cause: first.cause });
    const sealed = await Effect.runPromise(Effect.exit(borrowed.close));
    if (Exit.isSuccess(sealed)) throw new Error("Expected original byte refusal at seal");
    expect(sealed.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded") !== undefined).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  } finally { await Effect.runPromise(borrowed.abort); evaluator.close(); }
});
