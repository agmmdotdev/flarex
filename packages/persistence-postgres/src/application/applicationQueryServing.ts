import { drizzle } from "drizzle-orm/node-postgres";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { Client } from "pg";

import {
  RUN_LOCATED_READ_COMMITTED_V1,
  registerLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../database/locatedTransactionIdentity";
import {
  createPostgresClientLocatedReadCommittedTransactionRunnerV1,
  type PostgresClientLocatedReadCommittedRunnerOptionsV1,
} from "../database/postgresLocatedReadCommitted";
import { flarexSchema } from "../database/schema";
import { getScopeClock } from "../scope/scopeClock";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import { captureScopePhysicalLocator } from "../scope/scopePhysicalLocator";
import {
  constructApplicationLegacyServingOwners,
  type ApplicationServingConstruction,
} from "./applicationServing";
import type { ApplicationQuerySnapshotContext } from "./applicationQuerySnapshot";

/** One trusted, co-located control/target profile. The client and its lifetime
 * belong to the invoking host; none of these values comes from query input. */
export type ApplicationQueryServingConfiguration<ColdFailure> = Pick<
  ApplicationServingConstruction<ColdFailure>,
  "deploymentId" | "scopeId" | "cold"
> & Readonly<{ physicalLocator: ScopePhysicalLocator }>;

/** Keep the existing active-selection issuer and its readiness validation,
 * while lending only the read contracts needed by query execution. */
export function constructApplicationQueryServing<ColdFailure>(
  input: ApplicationServingConstruction<ColdFailure>,
) {
  const owners = constructApplicationLegacyServingOwners(input);
  const snapshot: ApplicationQuerySnapshotContext = Object.freeze({
    deploymentId: owners.deploymentId,
    controlDb: owners.controlDatabase,
    authority: owners.authority,
    schema: owners.schema,
    developerIndexes: owners.materialization.developerIndexes,
  });
  return Object.freeze({
    activation: Object.freeze({ readActive: owners.application.readActive }),
    snapshot,
  });
}

/** Adapt an already connected invocation-scoped client. The existing runner
 * owns transaction demarcation/quarantine; the host still owns connect/end.
 * No mutation activation, publication or retention capability is returned. */
export function createPostgresClientApplicationQueryServing<ColdFailure>(
  client: Client,
  configuration: ApplicationQueryServingConfiguration<ColdFailure>,
  options: PostgresClientLocatedReadCommittedRunnerOptionsV1,
) {
  const database = drizzle(client, { schema: flarexSchema });
  const runReadCommitted = createPostgresClientLocatedReadCommittedTransactionRunnerV1(client, options);
  const target: LocatedReadCommittedAttemptTargetV1 = Object.freeze({
    physicalLocator: captureScopePhysicalLocator(configuration.physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(database, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
  registerLocatedReadCommittedTargetDatabaseV1(target, database);
  return constructApplicationQueryServing({
    controlDatabase: database,
    database,
    target,
    deploymentId: configuration.deploymentId,
    scopeId: configuration.scopeId,
    activation: { kind: "fullProof" },
    cold: configuration.cold,
  });
}
