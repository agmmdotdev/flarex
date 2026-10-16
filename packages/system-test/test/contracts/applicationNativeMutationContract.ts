import { expect, it } from "vitest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { proveApplicationNestedMutation } from "../../support/applicationNativeMutationHarness";

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
}
