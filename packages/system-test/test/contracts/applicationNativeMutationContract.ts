import { expect, it } from "vitest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  proveApplicationNestedMutation,
  proveApplicationNestedMutationFailure,
} from "../../support/applicationNativeMutationHarness";

export function defineApplicationNestedMutationContract(adapter: Readonly<{
  runScenario: <A>(scenario: (fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>) => Promise<A>) => Promise<A>;
}>): void {
  it("shares staged deletes across nested calls and publishes only the parent", async () => {
    const proof = await adapter.runScenario(proveApplicationNestedMutation);
    expect(proof.published).toMatchObject({ disposition: "published", value: { before: "Ada", child: null, after: null } });
    expect(proof.replayed).toMatchObject({ disposition: "replayed", commitSeq: proof.published.commitSeq, value: proof.published.value });
    expect(proof.workerLoads).toBe(1);
    expect(proof.tombstones).toBe(1);
    expect(proof.after).toEqual({
      commits: proof.before.commits + 1,
      outcomes: proof.before.outcomes + 1,
      feed: proof.before.feed + 1,
      outbox: proof.before.outbox + 1,
    });
  }, 120_000);

  it("rejects the Standard root after a caught child patch failure without publishing either write", async () => {
    const proof = await adapter.runScenario(proveApplicationNestedMutationFailure);
    expect(proof.before.document).toMatchObject({ _id: proof.documentId, name: "Ada" });
    expect(proof.before.history).toHaveLength(1);
    expect(proof.before.membership.length).toBeGreaterThanOrEqual(2);
    expect(proof.before.membershipHistory.length).toBeGreaterThanOrEqual(2);
    expect(proof.failure.outcome).toEqual({
      disposition: "rejected",
      errorTag: "PointMutationOccApplicationErrorV1",
      code: "NESTED_PATCH_FAILED",
      message: "Fixture nested patch failed.",
      data: { id: proof.documentId, childName: "child-patched" },
    });
    // The exact scoped row, all its revisions and both index histories survive.
    // Abort/session metadata may change; committed publication must not.
    expect(proof.failure.state).toEqual(proof.before);
    expect(proof.failure.workerLoads).toBe(1);

    const patchMarkers = ["parent-before-child", "child-patched", "parent-after-catch"];
    expect(proof.failure.calls.filter(call => call.method === "patchPointDocument"))
      .toEqual(patchMarkers.map(name => ({
        method: "patchPointDocument",
        arguments: [proof.documentId, { name }],
      })));
    expect(proof.failure.receipts.filter(receipt => receipt.operationKind === "patch"))
      .toMatchObject(patchMarkers.map(name => ({
        operationKind: "patch",
        outcomeKind: "unit",
        request: {
          kind: "patch",
          tableId: proof.before.tableId,
          documentId: proof.documentId,
          changes: [{ kind: "set", field: "name", valueJson: name }],
        },
        outcome: { kind: "unit", operation: "patch" },
      })));
    expect(proof.failure.receipts.filter(receipt => receipt.operationKind === "get"))
      .toMatchObject(["child-patched", "parent-after-catch"].map(name => ({
        outcomeKind: "present",
        request: { kind: "get", tableId: proof.before.tableId, documentId: proof.documentId },
        outcome: { kind: "present", documentValueJson: { _id: proof.documentId, name } },
      })));

    expect(proof.success.outcome).toMatchObject({
      disposition: "published",
      value: {
        child: { _id: proof.documentId, name: "child-patched" },
        caught: false,
        after: { _id: proof.documentId, name: "parent-after-success" },
      },
    });
    expect(proof.success.workerLoads).toBe(1);
    expect(proof.success.state.document).toMatchObject({
      _id: proof.documentId, name: "parent-after-success",
    });
    expect(proof.success.state.commitSeq).toBe(proof.success.outcome.commitSeq);
    expect(proof.success.state.history).toHaveLength(proof.before.history.length + 1);
    expect(proof.success.state.membership).not.toEqual(proof.before.membership);
    expect(proof.success.state.publication).toEqual({
      commits: proof.before.publication.commits + 1,
      successfulOutcomes: proof.before.publication.successfulOutcomes + 1,
      feed: proof.before.publication.feed + 1,
      outbox: proof.before.publication.outbox + 1,
    });

    expect(proof.subsequent.outcome).toMatchObject({ disposition: "published" });
    expect(proof.subsequent.outcome.commitSeq).toBe(proof.success.outcome.commitSeq + 1n);
    expect(proof.subsequent.outcome.value).not.toBe(proof.documentId);
    expect(proof.subsequent.workerLoads).toBe(1);
    expect(proof.subsequent.state).toEqual({
      ...proof.success.state,
      publication: {
        commits: proof.before.publication.commits + 2,
        successfulOutcomes: proof.before.publication.successfulOutcomes + 2,
        feed: proof.before.publication.feed + 2,
        outbox: proof.before.publication.outbox + 2,
      },
    });
  }, 120_000);
}
