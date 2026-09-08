import {
  makePostgresPhysicalSessionDriver,
  type PhysicalPostgresPool,
  type PostgresPhysicalSessionOptions,
} from "../../physicalSession/postgres";
import { makePhysicalSessionAccess } from "../../physicalSession/drizzle";
import { flarexSchema } from "../../schema";
import {
  artifactControlPhysicalErrors,
  type FrameworkSchemaArtifactControlSessionDriver,
} from "./controlSession";
import {
  fxControlFrameworkSchemaArtifactDependencies,
  fxControlFrameworkSchemaArtifacts,
} from "./schema";
const access = makePhysicalSessionAccess({
  ...flarexSchema,
  fxControlFrameworkSchemaArtifacts,
  fxControlFrameworkSchemaArtifactDependencies,
});
/** Artifact composition supplies schema and error policy, never physical settlement mechanics. */
export function makePostgresFrameworkSchemaArtifactControlSessionDriver(
  pool: PhysicalPostgresPool,
  options: PostgresPhysicalSessionOptions = {},
): FrameworkSchemaArtifactControlSessionDriver {
  return makePostgresPhysicalSessionDriver(
    pool,
    { access, errors: artifactControlPhysicalErrors },
    options,
  );
}
