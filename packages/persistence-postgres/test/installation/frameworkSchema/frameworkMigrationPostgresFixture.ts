import { Client, type ClientConfig } from "pg";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";
import { installRetainedPhysicalProfile, type InstallationMigrationJournal } from "../../../src/database/postgresInstallationMaintenance";
import type { FrameworkFreshInstallationRequest, FrameworkInstallerPolicy } from "../../../src/installation/migrationCoordination/installer";
import type { FrameworkSchemaArtifactRepository } from "../../../src/installation/frameworkSchema/artifact/repository";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";

interface MaintenanceFixtureRegistration {
  readonly config: ClientConfig;
  readonly schemaName: string;
  readonly journal: InstallationMigrationJournal;
  readonly runtimePolicies: ReadonlyArray<Readonly<{ database: FlarexMetadataDatabase; endpointPolicy: string }>>;
  readonly runtimeDatabases?: readonly FlarexMetadataDatabase[];
}
const maintenanceFixtures = new WeakMap<PostgresFlarexPersistence, MaintenanceFixtureRegistration>();
export function registerFrameworkMaintenanceFixture(persistence: PostgresFlarexPersistence,
  registration: MaintenanceFixtureRegistration): void {
  maintenanceFixtures.set(persistence, registration);
}

/** The fixture forwards a fixed operation and never hands a maintenance
 * Client, handle or arbitrary SQL callback to the consumer. */
export const installPostgresPhysicalProfileFixture = Effect.fn("FrameworkFixture.installPhysicalProfile")(
  function* (input: Readonly<{ persistence: PostgresFlarexPersistence; target: FrameworkSchemaTarget;
    artifactRepository: FrameworkSchemaArtifactRepository; requests: readonly FrameworkFreshInstallationRequest[];
    policy: FrameworkInstallerPolicy;
    observeStartup?: (observed: Readonly<{ dedicated: boolean; options: string | undefined }>) => void }>) {
    const registered = maintenanceFixtures.get(input.persistence);
    if (registered === undefined) return yield* Effect.fail(new Error("Missing exact physical-profile maintenance fixture registration"));
    return yield* installRetainedPhysicalProfile({ ...registered, database: input.persistence.drizzle,
      target: input.target, artifactRepository: input.artifactRepository, requests: input.requests, policy: input.policy,
      ...(input.observeStartup === undefined ? {} : { options: { observe: event => {
        if (event.phase !== "begin" || event.edge !== "before") return;
        const parameters: unknown = Reflect.get(event.client, "connectionParameters");
        const options = isNonArrayRecord(parameters) && typeof parameters.options === "string"
          ? parameters.options : undefined;
        input.observeStartup?.({ dedicated: event.client instanceof Client && !("release" in event.client), options });
      } } }) });
  },
);
