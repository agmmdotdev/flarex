import { Effect } from "effect";
import { it } from "vitest";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "../../application/applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { FINITE_INDEXED_QUERY_OPTIONS } from "./finiteIndexedQueriesScenario";
import { finiteApplicationAdmissionScenario } from "./finiteApplicationAdmissionScenario";
import { privatePermissionFixture } from "../../application/ownership/privatePermissionFixture";
import { finitePrivateApplicationAdmissionScenario } from "./finitePrivateApplicationAdmissionScenario";

it("freshly admits finite Application local values and receipt replays (PGlite)", () => runEffect(Effect.scoped(Effect.gen(function* () {
  const control = yield* Effect.tryPromise(() => createMigratedPGlitePersistence());
  const target = yield* Effect.tryPromise(() => createMigratedPGlitePersistence(undefined, "finiteCapture"));
  const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPGliteFixtureWithPersistence(FINITE_INDEXED_QUERY_OPTIONS, { control, target }));
  yield* finiteApplicationAdmissionScenario(native);
}))), 120_000);

it("freshly admits eligible protected Application commands and permission replays (PGlite)", () => runEffect(Effect.scoped(Effect.gen(function* () {
  const target = yield* Effect.tryPromise(() => createMigratedPGlitePersistence(undefined, "finiteCapture"));
  const fixture = yield* Effect.acquireRelease(Effect.tryPromise(() => privatePermissionFixture(target)),
    owner => Effect.tryPromise(() => owner.close()).pipe(Effect.orDie));
  yield* finitePrivateApplicationAdmissionScenario(fixture, target);
}))), 180_000);
