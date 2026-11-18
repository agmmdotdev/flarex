import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { withReadyDeploymentAuthority } from "../../../executor/src/index";
import { getDeploymentMetadata } from "../../src/application/deployments";
import { CoreApplicationLegacyDeploymentError, makeCoreApplicationLegacyAdmissionWithReader } from
  "../../src/application/coreApplicationLegacyAdmission";
import { classifyCoreQueryFailure, makeCorePGliteDriver } from "../../src/database/corePersistence/driver";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import { installCorePersistence } from "../../src/database/corePersistence/target";
import { createPGlitePersistence } from "../../src/database/pglite";
import { flarexSchema } from "../../src/database/schema";
import { registerCoreApplicationLegacyAdmissionScenarios } from "./coreApplicationLegacyAdmissionScenarios";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";

registerCoreApplicationLegacyAdmissionScenarios("PGlite legacy deployment exclusion", async () => {
  const client = new PGlite(), driver = makeCorePGliteDriver(client), metadata = drizzle(client, { schema: flarexSchema });
  try {
    const coreNamespace = "isolated_core_target";
    await Effect.runPromise(createCorePersistence(await Effect.runPromise(installCorePersistence(driver, coreNamespace)), "application"));
    const reader = { query: driver.query, getDeploymentMetadata: (id: string) => Effect.tryPromise({
      try: () => getDeploymentMetadata(metadata, id),
      catch: cause => new CoreApplicationLegacyDeploymentError({ reason: "metadataReadFailed", cause }),
    }) };
    const persistence = withReadyDeploymentAuthority(await createPGlitePersistence({ db: client }), {
      ensure: async () => { throw new Error("Legacy provisioning is excluded by this fixture"); },
    });
    return { metadata, persistence, query: driver.query, reader, namespace: "public", coreNamespace,
      admit: makeCoreApplicationLegacyAdmissionWithReader(reader), close: () => client.close() };
  } catch (cause) { await client.close(); throw cause; }
});

it("probes the full genuine migrated legacy catalog and refuses retained session state", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const admit = makeCoreApplicationLegacyAdmissionWithReader({
    query: (statement, parameters = []) => Effect.tryPromise({
      try: () => persistence.query(statement, [...parameters]), catch: classifyCoreQueryFailure,
    }).pipe(Effect.map(result => result.rows)),
    getDeploymentMetadata: id => Effect.tryPromise({ try: () => persistence.getDeploymentMetadata(id),
      catch: cause => new CoreApplicationLegacyDeploymentError({ reason: "metadataReadFailed", cause }),
    }),
  });
  await expect(Effect.runPromise(admit("fresh-in-full-catalog"))).resolves.toBeUndefined();
  await persistence.insertInvokeSessionMetadata({ deploymentId: "orphan-in-full-catalog", projectId: "project", sessionId: "old-session",
    packageId: "old-package", functionPath: "items:get", functionKind: "query", partitionKey: "1:old", scopeJson: {},
    argsJson: {}, beginTs: 1, schemaVersion: 1, executionModule: "old.js" });
  expect(await Effect.runPromise(Effect.result(admit("orphan-in-full-catalog"))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "legacyDeploymentExists" } });
}, 180_000);
