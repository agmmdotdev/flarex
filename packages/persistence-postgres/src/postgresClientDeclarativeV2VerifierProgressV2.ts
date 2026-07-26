import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";

import {
  makeDeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryOptionsV2,
  type DeclarativeV2VerifierProgressRepositoryV2,
} from "./declarativeV2VerifierProgressRepositoryV2";
import {
  createPostgresClientLocatedReadCommittedTransactionRunnerV1,
  type PostgresClientLocatedReadCommittedRunnerOptionsV1,
} from "./postgresLocatedReadCommitted";
import { flarexSchema } from "./schema";
import { createLocatedScopeAuthorizationEpochTarget } from
  "./scopeAuthorizationEpochAuthority";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

export interface PostgresClientDeclarativeV2VerifierProgressV2Options {
  readonly repository: DeclarativeV2VerifierProgressRepositoryOptionsV2;
  readonly quarantine:
    PostgresClientLocatedReadCommittedRunnerOptionsV1["quarantine"];
}

/**
 * Adapts one executor-owned, already-connected request Client into the private
 * Declarative V2 progress repository. Client lifecycle and quarantine remain
 * with the request owner; raw database and transaction capabilities never
 * leave this factory.
 */
export function createPostgresClientDeclarativeV2VerifierProgressRepositoryV2(
  client: Client,
  physicalLocator: ScopePhysicalLocator,
  options: PostgresClientDeclarativeV2VerifierProgressV2Options,
): DeclarativeV2VerifierProgressRepositoryV2 {
  const database = drizzle(client, { schema: flarexSchema });
  const scopeClock = createLocatedScopeAuthorizationEpochTarget(
    database,
    physicalLocator,
  );
  const target = Object.freeze({
    physicalLocator: scopeClock.physicalLocator,
    getCurrentClock: scopeClock.getCurrentClock,
    [RUN_LOCATED_READ_COMMITTED_V1]:
      createPostgresClientLocatedReadCommittedTransactionRunnerV1(
        client,
        { quarantine: options.quarantine },
      ),
  }) satisfies LocatedReadCommittedAttemptTargetV1;

  return makeDeclarativeV2VerifierProgressRepositoryV2(
    target,
    options.repository,
  );
}
