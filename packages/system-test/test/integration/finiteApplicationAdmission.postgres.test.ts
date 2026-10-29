import { createApplicationNativeMutationPostgresFixture } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createFileScopedPostgresFixture, postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";
import { FINITE_APPLICATION_WORKER_ADMISSION_OPTIONS } from "../../support/finiteApplicationAdmissionHarness";
import { defineFiniteApplicationAdmissionContract } from "../contracts/finiteApplicationAdmissionContract";
import { runSystemTestEffectV1 } from "../../support/systemTestEffectBoundaryV1";

describe.skipIf(postgresUrl === null)("finite Application Worker admission on ordinary PostgreSQL", () => {
  defineFiniteApplicationAdmissionContract({ runScenario: scenario => runSystemTestEffectV1(Effect.scoped(Effect.gen(function* () {
    const control = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture()),
      owner => Effect.tryPromise(() => owner.dispose()).pipe(Effect.orDie));
    const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({}, {}, "finiteCapture")),
      owner => Effect.tryPromise(() => owner.dispose()).pipe(Effect.orDie));
    expect((yield* Effect.tryPromise(() => target.persistence.query<{ superuser: boolean; bypass: boolean }>(
      "select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user"))).rows)
      .toEqual([{ superuser: false, bypass: false }]);
    const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPostgresFixture(FINITE_APPLICATION_WORKER_ADMISSION_OPTIONS,
      { control: control.persistence, target: target.persistence }));
    yield* Effect.tryPromise(() => scenario(native));
  }))) });
});
