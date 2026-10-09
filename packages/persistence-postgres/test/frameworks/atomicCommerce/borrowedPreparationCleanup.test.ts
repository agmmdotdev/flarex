import { Effect, Result } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const witness = vi.hoisted(() => ({
  tailFailure: new Error("checked preparation transaction did not settle"),
  closeCount: 0,
  constructionCount: 0,
}));

vi.mock("../../../src/execution/preparation/boundedRequestLifetime", async () => {
  const { Effect } = await import("effect");
  return { makeBoundedRequestLifetime: () => Effect.succeed({
    context: Object.freeze({}),
    begin: () => Effect.succeed("prepared-request"),
    close: Effect.sync(() => { witness.closeCount++; }),
  }) };
});

vi.mock("../../../src/storage/documents/logicalDocuments/workingSet", async () => {
  const { Effect } = await import("effect");
  return { makeLogicalDocumentWorkingSet: () => Effect.sync(() => {
    witness.constructionCount++;
    return Object.freeze({});
  }) };
});

vi.mock("../../../src/storage/documents/logicalDocuments/relationalAdmission", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/storage/documents/logicalDocuments/relationalAdmission")>();
  const { Effect } = await import("effect");
  return { ...original, withLogicalRelationalAttemptAdmissionEffect: (
    _admission: unknown, _attempt: unknown, _method: unknown,
    prepare: (state: unknown, checkedRead: unknown, tx: unknown) => Effect.Effect<unknown>,
  ) => Effect.gen(function* () {
    yield* prepare({
      root: { scopeId: "prepared-scope", snapshotCommitSeq: 1n, executionProfile: "durableOperations" },
      clock: {}, schema: { capabilities: [] }, tables: [],
      writeMechanics: { tables: [], unique: [], indexes: [], searchDefinitions: [] },
      values: { validate: () => Effect.void },
    }, () => Effect.void, Object.freeze({}));
    return yield* Effect.fail(witness.tailFailure);
  }) };
});

vi.mock("../../../src/storage/documents/logicalDocuments/documentAdmission", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/storage/documents/logicalDocuments/documentAdmission")>();
  const { Effect } = await import("effect");
  return { ...original, withLogicalDocumentAttemptAdmissionEffect: (
    _admission: unknown, _attempt: unknown, _method: unknown,
    prepare: (state: unknown, checkedRead: unknown, tx: unknown) => Effect.Effect<unknown>,
  ) => Effect.gen(function* () {
    yield* prepare({
      configuration: { profile: "payload.scalar" },
      root: { scopeId: "prepared-scope", snapshotCommitSeq: 1n, executionProfile: "durableOperations" },
      clock: {}, tables: [{ tableId: 1, localName: "posts" }],
      writeMechanics: { tables: [], unique: [], indexes: [], searchDefinitions: [] },
      validate: () => Effect.void,
    }, () => Effect.void, Object.freeze({}));
    return yield* Effect.fail(witness.tailFailure);
  }) };
});

import { makeBorrowedLogicalAttempt } from "../../../src/frameworks/commerceTransaction/borrowedLogicalAttempt";
import { makeBorrowedCmsInvocation } from "../../../src/frameworks/cmsTransaction/borrowedLogicalAttempt";
import type { BorrowedLogicalAttemptInput } from "../../../src/frameworks/commerceTransaction/borrowedLogicalAttempt";
import type { BorrowedCmsAttemptInput } from "../../../src/frameworks/cmsTransaction/borrowedLogicalAttempt";

beforeEach(() => {
  witness.closeCount = 0;
  witness.constructionCount = 0;
});

const assertCleanupAfterTailFailure = async (borrowed: Effect.Effect<unknown, unknown>) => {
  const result = await Effect.runPromise(Effect.result(borrowed));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure).toMatchObject({ cause: witness.tailFailure });
  expect(witness.constructionCount).toBe(1);
  expect(witness.closeCount).toBe(1);
};

it("closes the Product borrowed lifetime when checked construction fails at transaction settlement", async () => {
  // SAFETY: admission and attempt are opaque inert inputs to this targeted
  // factory lifecycle test; mocked issuer callbacks model a checked SQL tail.
  const input = { admission: Object.freeze({}), attempt: Object.freeze({}), method: "read",
    pendingRows: [] } as unknown as BorrowedLogicalAttemptInput & BorrowedCmsAttemptInput;
  await assertCleanupAfterTailFailure(makeBorrowedLogicalAttempt(input));
});

it("closes the Payload borrowed lifetime when checked construction fails at transaction settlement", async () => {
  const input = { admission: Object.freeze({}), attempt: Object.freeze({}), method: "read",
    pendingRows: [] } as unknown as BorrowedCmsAttemptInput;
  await assertCleanupAfterTailFailure(makeBorrowedCmsInvocation(input));
});
