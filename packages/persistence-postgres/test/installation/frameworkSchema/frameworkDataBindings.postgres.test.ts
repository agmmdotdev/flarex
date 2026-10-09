import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "../../support/postgresHelpers";
import { createApplicationNativeMutationPostgresFixture } from "../../application/applicationNativeMutationTestFixture";
import { makeFrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import { makeCatalogControlSessionStarter } from "../../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../src/database/postgresCatalogControlSession";
import { makeFrameworkSchemaArtifactRepository } from "../../../src/installation/frameworkSchema/artifact/repository";
import { exerciseBindingLifecycle, exerciseExactBindingScope } from "./frameworkDataBindingTestSupport";
import {
  exercisePhysicalBindings,
  exerciseBindingAvailabilityLimit,
  installationBindingReference,
} from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect } from "../../support/effectTestRuntime";
import { exerciseBindingNativeRaces } from "./frameworkDataBindingPostgresTestSupport";
import { runBindingRestartWorker } from "./frameworkDataBindingRestartTestSupport";
import { dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readBindingActivation } from "../../../src/installation/frameworkSchema/binding/repository";

describe.skipIf(postgresUrl === null)(
  "native private data bindings",
  { timeout: 180_000 },
  () => {
    it("selects the exact binding scope when a deployment contains two shops", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const schema = await target.query<{ schema: string }>("select current_schema() as schema");
        const schemaName = schema.rows[0]?.schema;
        if (schemaName === undefined) throw new Error("Missing target schema");
        const fixture = await createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: "flarex.test/binding-host", compatibilityDate: "2026-09-05",
          physicalLocator: { kind: "database_per_scope", databaseKey: "application_native_mutation_target", schemaName },
        }, { control, target });
        const migrationTarget = await runEffect(makeFrameworkSchemaTarget({
          database: target.drizzle, deploymentId: fixture.deploymentId,
          canonicalPhysicalDatabaseIdentity: "native-binding-fixture",
          physicalLocator: fixture.active.basis.authority.physicalLocator,
        }));
        await exerciseExactBindingScope(fixture, migrationTarget);
      });
    });
    it("proves the same binding lifecycle and physical evidence under an ordinary role", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const schema = await target.query<{ schema: string }>(
          "select current_schema() as schema",
        );
        const schemaName = schema.rows[0]?.schema;
        if (schemaName === undefined) throw new Error("Missing target schema");
        const role = await target.query<{ superuser: boolean }>(
          "select rolsuper as superuser from pg_roles where rolname = current_user",
        );
        expect(role.rows[0]?.superuser).toBe(false);
        const fixture = await createApplicationNativeMutationPostgresFixture(
          {
            runtimeHostIdentity: "flarex.test/binding-host",
            compatibilityDate: "2026-09-05",
            physicalLocator: {
              kind: "database_per_scope",
              databaseKey: "application_native_mutation_target",
              schemaName,
            },
          },
          { control, target },
        );
        const migrationTarget = await runEffect(makeFrameworkSchemaTarget({
            database: target.drizzle,
            deploymentId: fixture.deploymentId,
            canonicalPhysicalDatabaseIdentity: "native-binding-fixture",
            physicalLocator: fixture.active.basis.authority.physicalLocator,
          }));
        const lifecycle = await exerciseBindingLifecycle(
          fixture,
          migrationTarget,
          true,
        );
        const repository = Result.getOrThrow(
          makeFrameworkSchemaArtifactRepository({
            controlDb: target.drizzle,
            controlSessionStarter:
              makeCatalogControlSessionStarter({
                controlDb: target.drizzle,
                driver: makePostgresCatalogControlSessionDriver(
                  target.pool,
                ),
              }),
            readTimeoutMilliseconds: 10_000,
            attemptTimeoutMilliseconds: 10_000,
            recoveryTimeoutMilliseconds: 10_000,
            lockTimeoutMilliseconds: 2_000,
          }),
        );
        const physical = await exercisePhysicalBindings(
          fixture,
          migrationTarget,
          repository,
          lifecycle.frame,
          lifecycle.head,
        );
        const raced = await exerciseBindingNativeRaces(fixture, physical);
        const commerce = commerceBindings(physical.frame)[0];
        if (commerce === undefined) throw new Error("Commerce fixture missing");
        const restartFrame = {
          ...raced.frame,
          commerce: [{
            ...commerce,
            ...installationBindingReference(raced.restored),
          }],
        };
        const candidate = await runEffect(raced.host.prepare(restartFrame));
        const request = dataBindingActivationRequest(
          restartFrame.application.scopeId,
          restartFrame.application.storageGeneration,
          "process-commit-exit",
          candidate.sha256,
          raced.head,
        );
        const controlSchema = (
          await control.query<{ schema: string }>(
            "select current_schema() as schema",
          )
        ).rows[0]?.schema;
        if (controlSchema === undefined)
          throw new Error("Missing control schema");
        const crashed = await runBindingRestartWorker(
          controlSchema,
          schemaName,
          "commit-exit",
          restartFrame,
          request,
        );
        expect(crashed.code, crashed.output).not.toBe(0);
        const stored = await target.drizzle.transaction((tx) =>
          runEffect(
            readBindingActivation(tx, request.scopeId, request.requestId),
          ),
        );
        // A launch/import failure cannot satisfy this: the exact committed receipt must exist.
        expect(Option.isSome(stored), crashed.output).toBe(true);
        const resumed = await runBindingRestartWorker(
          controlSchema,
          schemaName,
          "recover",
          restartFrame,
          request,
        );
        expect(resumed.code, resumed.output).toBe(0);
        expect(
          (
            await runEffect(
              raced.host
                .recover(request)
                .pipe(Effect.map((value) => value.receipt)),
            )
          ).frame.request,
        ).toEqual(request);
        const recovered = await runEffect(raced.host.recover(request));
        await exerciseBindingAvailabilityLimit(
          fixture,
          raced.host,
          restartFrame,
          raced.restored,
          Result.getOrThrow(recovered.current).head,
        );
      });
    });
  },
);
import { commerceBindings } from "../../../src/installation/frameworkSchema/binding/model";
