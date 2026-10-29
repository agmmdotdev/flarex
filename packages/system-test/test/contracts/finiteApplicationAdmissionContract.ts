import { Effect } from "effect";
import { it } from "vitest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { proveFiniteApplicationWorkerAdmission } from "../../support/finiteApplicationAdmissionHarness";
import { runSystemTestEffectV1 } from "../../support/systemTestEffectBoundaryV1";

export function defineFiniteApplicationAdmissionContract(input: Readonly<{
  runScenario: (scenario: (fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>) => Promise<void>) => Promise<void>;
}>) {
  for (const revoke of [false, true]) it(revoke
    ? "refuses a second known Worker read after committed revocation before publication"
    : "publishes the unrevoked twin through the current finite dispatcher", () => input.runScenario(async fixture => {
    await runSystemTestEffectV1(Effect.scoped(proveFiniteApplicationWorkerAdmission(fixture, revoke)));
  }), 120_000);
  it("preserves real revocation plus cleanup defect and interruption through the current finite Worker runner", () =>
    input.runScenario(async fixture => {
      await runSystemTestEffectV1(Effect.scoped(proveFiniteApplicationWorkerAdmission(fixture, true, "cleanup")));
    }), 120_000);
}
