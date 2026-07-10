import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  createSharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
} from "./scopeAuthorityProvisioning";
import { flarexSchema } from "./schema";

export interface PostgresSharedScopeAuthorityPersistence {
  readonly drizzle: NodePgDatabase<typeof flarexSchema>;
}

export function createPostgresSharedScopeAuthorityProvisioner(
  persistence: PostgresSharedScopeAuthorityPersistence,
  options: SharedScopeAuthorityProvisionerOptions,
): SharedScopeAuthorityProvisioner {
  return createSharedScopeAuthorityProvisioner(
    persistence.drizzle,
    options,
  );
}
