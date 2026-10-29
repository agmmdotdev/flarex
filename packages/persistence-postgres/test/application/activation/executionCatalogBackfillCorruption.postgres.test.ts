import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { createApplicationNativeMutationPostgresFixture } from "../applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import {
  EXECUTION_CATALOG_BACKFILL_CORRUPTION_OPTIONS,
  executionCatalogBackfillCorruptionScenario,
} from "./executionCatalogBackfillCorruptionScenario";

describe.skipIf(postgresUrl === null)(
  "execution catalog backfill corruption on ordinary PostgreSQL", () => {
    it("keeps public fullProof maintenance and its successor drained on a mismatched stored catalog", () => runEffect(Effect.scoped(Effect.gen(function* () {
      const control = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture()),
        fixture => Effect.tryPromise(fixture.dispose).pipe(Effect.orDie));
      const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({},
        { immutableCatalog: control.persistence.drizzle }, "finiteCapture")),
        fixture => Effect.tryPromise(fixture.dispose).pipe(Effect.orDie));
      expect((yield* Effect.tryPromise(() => target.persistence.query<{ superuser: boolean; bypass: boolean; ownsSchema: boolean }>(
        `select r.rolsuper as superuser,r.rolbypassrls as bypass,n.nspowner=r.oid as "ownsSchema"
         from pg_roles r join pg_namespace n on n.nspname=current_schema() where r.rolname=current_user`))).rows)
        .toEqual([{ superuser: false, bypass: false, ownsSchema: true }]);
      // Native execution and public migrate use the ordinary schema owner's
      // fullProof compatibility profile in this isolated negative witness.
      const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPostgresFixture(EXECUTION_CATALOG_BACKFILL_CORRUPTION_OPTIONS,
        { control: control.persistence, target: target.persistence }));
      yield* executionCatalogBackfillCorruptionScenario(native,
        { kind: "postgres", writer: target.persistence, migrate: () => target.persistence.migrate() });
    }))), 180_000);
  },
);
