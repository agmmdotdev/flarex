import type { DatabaseSync } from "node:sqlite";

import { Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ensureDeploymentQuerySyncStorageReady,
} from "../src/deploymentSync/StorageContract";
import {
  GENERATION_3_CONTRACT_TABLE_DDL,
} from "../src/deploymentSync/StorageContractGeneration3";
import {
  GENERATION_4_IN_FLIGHT_PUBLICATION_TABLE_DDL,
} from "../src/deploymentSync/StorageContractGeneration4";
import {
  createGeneration2Catalog,
  makeBinding,
  makeSqliteHarness,
  migrateSqliteHarnessToGeneration3,
  seedProvisionalOnlyGeneration2,
  snapshotGeneration3Predecessor,
  storageWithMutationObserver,
} from "./deploymentSyncStorageContractGeneration3TestSupport";
import {
  canonicalKey,
} from "./deploymentSyncEvaluationStateTestSupport";

interface PredecessorRefusalCase {
  readonly name: string;
  readonly initialized: boolean;
  readonly mutate: (database: DatabaseSync) => void;
  readonly expected: Readonly<Record<string, unknown>>;
}

const incompatibleCatalog = Object.freeze({
  _tag: "QuerySyncStoredStateIncompatibleError",
  operation: "initializeOrInspectNamespace",
  commitCertainty: "notCommitted",
  reason: "unsupportedStoredContract",
});

const corruptAggregate = Object.freeze({
  _tag: "QuerySyncStoredStateCorruptError",
  operation: "initializeOrInspectNamespace",
  commitCertainty: "notCommitted",
  reason: "storedAggregateInvalid",
});

const refusalCases: readonly PredecessorRefusalCase[] = Object.freeze([
  {
    name: "altered generation-3 contract DDL",
    initialized: false,
    mutate: alterGeneration3ContractDefinition,
    expected: incompatibleCatalog,
  },
  {
    name: "additive generation-3 index",
    initialized: false,
    mutate: database => database.exec(`CREATE INDEX
      unexpected_pending_generation_index
      ON deployment_sync_pending_publications (generation)`),
    expected: incompatibleCatalog,
  },
  {
    name: "partial generation-3 catalog",
    initialized: false,
    mutate: database => database.exec(
      "DROP TABLE deployment_sync_pending_publications",
    ),
    expected: incompatibleCatalog,
  },
  {
    name: "mixed generation-3 and generation-4 catalog",
    initialized: false,
    mutate: database => database.exec(
      GENERATION_4_IN_FLIGHT_PUBLICATION_TABLE_DDL,
    ),
    expected: incompatibleCatalog,
  },
  {
    name: "unsupported generation marker",
    initialized: false,
    mutate: database => withIgnoredChecks(database, () => database.exec(`UPDATE
      deployment_sync_contract_state SET local_contract_generation = 5`)),
    expected: incompatibleCatalog,
  },
  {
    name: "missing contract row",
    initialized: false,
    mutate: database => database.exec(
      "DELETE FROM deployment_sync_contract_state",
    ),
    expected: corruptAggregate,
  },
  {
    name: "excess contract row",
    initialized: false,
    mutate: database => withIgnoredChecks(database, () => database.exec(`INSERT
      INTO deployment_sync_contract_state (
        singleton,
        local_contract_generation,
        durable_initialized_history
      ) VALUES (2, 3, 0)`)),
    expected: corruptAggregate,
  },
  {
    name: "malformed contract history flag",
    initialized: false,
    mutate: database => withIgnoredChecks(database, () => database.exec(`UPDATE
      deployment_sync_contract_state SET durable_initialized_history = 2`)),
    expected: corruptAggregate,
  },
  {
    name: "initialized history without scope",
    initialized: false,
    mutate: database => database.exec(`UPDATE
      deployment_sync_contract_state SET durable_initialized_history = 1`),
    expected: Object.freeze({ ...corruptAggregate, reason: "aggregateMissing" }),
  },
  {
    name: "scope without initialized history",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_contract_state SET durable_initialized_history = 0`),
    expected: corruptAggregate,
  },
  {
    name: "orphan query without initialized history",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_contract_state SET durable_initialized_history = 0;
      DELETE FROM deployment_sync_scope_state`),
    expected: corruptAggregate,
  },
  {
    name: "orphan dependency without initialized history",
    initialized: false,
    mutate: database => database.prepare(`INSERT INTO
      deployment_sync_query_dependencies (
        role,
        query_key,
        generation,
        dependency_key
      ) VALUES ('active', ?, '1', ?)`).run(
        canonicalKey(210),
        Encoding.encodeBase64Url("orphan-dependency"),
      ),
    expected: corruptAggregate,
  },
  {
    name: "orphan pending publication without initialized history",
    initialized: false,
    mutate: database => database.prepare(`INSERT INTO
      deployment_sync_pending_publications (
        query_key,
        generation,
        query_identity,
        completed_through_sequence,
        result_digest,
        content
      ) VALUES (?, '1', ?, '0', ?, ?)`).run(
        canonicalKey(211),
        Encoding.encodeBase64Url("orphan-query"),
        canonicalKey(212),
        Encoding.encodeBase64Url("orphan-publication"),
      ),
    expected: corruptAggregate,
  },
  {
    name: "noncanonical scope fence",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET storage_generation_fence = '07'`),
    expected: corruptAggregate,
  },
  {
    name: "closed scope binding mismatch",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET
        scope_uuid = '00000000-0000-4000-8000-000000000099'`),
    expected: Object.freeze({
      ...corruptAggregate,
      reason: "namespaceBindingMismatch",
    }),
  },
  {
    name: "closed storage-fence binding mismatch",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET storage_generation_fence = '8'`),
    expected: Object.freeze({
      ...incompatibleCatalog,
      reason: "bootstrapBindingMismatch",
    }),
  },
  {
    name: "generation-3 in-flight lifecycle counter",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET in_flight_publication_count = 1`),
    expected: corruptAggregate,
  },
  {
    name: "generation-3 settlement lifecycle counter",
    initialized: true,
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET settlement_envelope_bytes = 1`),
    expected: corruptAggregate,
  },
]);

describe("generation-3 predecessor refusal before generation 4", () => {
  it.each(refusalCases)(
    "leaves the exact predecessor unchanged for $name",
    ({ initialized, mutate, expected }) => {
      const harness = makeSqliteHarness();
      try {
        const binding = makeBinding();
        if (initialized) {
          seedProvisionalOnlyGeneration2(harness.database, binding);
        } else {
          createGeneration2Catalog(harness.database, false);
        }
        migrateSqliteHarnessToGeneration3(harness);
        mutate(harness.database);
        const before = snapshotGeneration3Predecessor(harness.database);
        const mutationSql: string[] = [];

        const result = ensureDeploymentQuerySyncStorageReady(
          storageWithMutationObserver(
            harness.storage,
            query => mutationSql.push(query),
          ),
          binding,
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject(expected);
        }
        expect(mutationSql).toEqual([]);
        expect(snapshotGeneration3Predecessor(harness.database)).toEqual(
          before,
        );
      } finally {
        harness.database.close();
      }
    },
  );
});

function alterGeneration3ContractDefinition(database: DatabaseSync): void {
  database.exec(`ALTER TABLE deployment_sync_contract_state
    RENAME TO retained_generation_3_contract`);
  database.exec(GENERATION_3_CONTRACT_TABLE_DDL.replace(
    "CHECK (local_contract_generation = 3)",
    "CHECK (local_contract_generation IN (3))",
  ));
  database.exec(`INSERT INTO deployment_sync_contract_state
    SELECT * FROM retained_generation_3_contract`);
  database.exec("DROP TABLE retained_generation_3_contract");
}

function withIgnoredChecks(database: DatabaseSync, mutation: () => void): void {
  database.exec("PRAGMA ignore_check_constraints = ON");
  try {
    mutation();
  } finally {
    database.exec("PRAGMA ignore_check_constraints = OFF");
  }
}
