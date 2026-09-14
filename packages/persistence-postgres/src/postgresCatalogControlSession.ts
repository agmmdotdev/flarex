import {
  makePostgresPhysicalSessionDriver,
  type PhysicalPostgresPool,
  type PostgresPhysicalSessionOptions,
} from "./physicalSession/postgres";
import { makePhysicalSessionAccess } from "./physicalSession/drizzle";
import { flarexSchema } from "./schema";
import {
  catalogControlPhysicalErrors,
  type CatalogControlSessionDriver,
} from "./catalogControlSession";
const access = makePhysicalSessionAccess(flarexSchema);
/** Catalog composition supplies schema and error policy, never physical settlement mechanics. */
export function makePostgresCatalogControlSessionDriver(
  pool: PhysicalPostgresPool,
  options: PostgresPhysicalSessionOptions = {},
): CatalogControlSessionDriver {
  return makePostgresPhysicalSessionDriver(
    pool,
    { access, errors: catalogControlPhysicalErrors },
    options,
  );
}
