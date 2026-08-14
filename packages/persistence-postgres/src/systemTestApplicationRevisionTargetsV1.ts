import type { PGliteFlarexPersistence } from "./pglite";
import type { PostgresFlarexPersistence } from "./postgres";
import {
  createLocatedApplicationRevisionRegistrationTargetV1,
  type LocatedApplicationRevisionRegistrationTargetV1,
} from "./applicationRevisionRegistrationV1";
import {
  createLocatedApplicationRevisionReadinessTargetV1,
  type LocatedApplicationRevisionReadinessTargetV1,
} from "./applicationRevisionReadinessV1";
import {
  createLocatedApplicationRevisionActivationTargetV1,
  type LocatedApplicationRevisionActivationTargetV1,
} from "./applicationRevisionActivationV1";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "./postgresLocatedReadCommitted";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";

export function createPGliteLocatedApplicationRevisionRegistrationTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionRegistrationTargetV1 {
  return createLocatedApplicationRevisionRegistrationTargetV1(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedApplicationRevisionReadinessTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionReadinessTargetV1 {
  return createLocatedApplicationRevisionReadinessTargetV1(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedApplicationRevisionActivationTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionActivationTargetV1 {
  return createLocatedApplicationRevisionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPostgresLocatedApplicationRevisionRegistrationTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionRegistrationTargetV1 {
  return createLocatedApplicationRevisionRegistrationTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export function createPostgresLocatedApplicationRevisionReadinessTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionReadinessTargetV1 {
  return createLocatedApplicationRevisionReadinessTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export function createPostgresLocatedApplicationRevisionActivationTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionActivationTargetV1 {
  return createLocatedApplicationRevisionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}
