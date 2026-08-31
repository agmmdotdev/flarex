import type { DatabaseSync } from "node:sqlite";

import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalKey,
  prepareEvaluationState,
  snapshotEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";
import {
  acceptanceFor,
  claimInstalledPublication,
  installPendingPublication,
  makePublicationSqlProbe,
} from "./deploymentSyncPublicationTestSupport";

type CorruptionSeed =
  | "empty"
  | "pending"
  | "inFlight"
  | "recorded"
  | "delivered";

interface CorruptionCase {
  readonly name: string;
  readonly seed: CorruptionSeed;
  readonly mutate: (database: DatabaseSync) => void;
}

const corruptionCases: readonly CorruptionCase[] = Object.freeze([
  {
    name: "missing publication-state row",
    seed: "empty",
    mutate: database => database.exec(
      "DELETE FROM deployment_sync_publication_state",
    ),
  },
  {
    name: "excess publication-state row",
    seed: "empty",
    mutate: database => duplicateSingletonTable(
      database,
      "deployment_sync_publication_state",
      "malformed_publication_state",
    ),
  },
  {
    name: "missing physical in-flight row",
    seed: "inFlight",
    mutate: database => database.exec(
      "DELETE FROM deployment_sync_in_flight_publication",
    ),
  },
  {
    name: "excess physical in-flight row",
    seed: "inFlight",
    mutate: database => duplicateSingletonTable(
      database,
      "deployment_sync_in_flight_publication",
      "malformed_in_flight_publication",
    ),
  },
  {
    name: "physical in-flight row without metadata",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET
        attempt_ordinal = NULL,
        first_attempt_at = NULL,
        last_attempt_at = NULL,
        attempt_disposition = NULL,
        attempt_block_reason = NULL`),
  },
  {
    name: "first instant after last instant",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET
        first_attempt_at = '101',
        last_attempt_at = '100'`),
  },
  {
    name: "in-flight identity crossed with delivered generation",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET
        latest_delivered_query_key = (
          SELECT query_key FROM deployment_sync_in_flight_publication
        ),
        latest_delivered_generation = (
          SELECT generation FROM deployment_sync_in_flight_publication
        ),
        latest_delivered_result_digest = (
          SELECT result_digest FROM deployment_sync_in_flight_publication
        )`),
  },
  {
    name: "preceding outcome crossed with delivered digest",
    seed: "delivered",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_publication_state SET
        latest_delivered_result_digest = ?`).run(canonicalKey(201)),
  },
  {
    name: "preceding outcome crossed with in-flight digest",
    seed: "recorded",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_publication_state SET
        preceding_result_digest = ?`).run(canonicalKey(202)),
  },
  {
    name: "preceding outcome crossed with in-flight ordinal",
    seed: "recorded",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET attempt_ordinal = 3`),
  },
  {
    name: "preceding outcome crossed with in-flight disposition",
    seed: "recorded",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET attempt_disposition = 'uncertain'`),
  },
  {
    name: "ordinal above one without preceding evidence",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET attempt_ordinal = 2`),
  },
  {
    name: "uncertain first ordinal",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET attempt_disposition = 'uncertain'`),
  },
  {
    name: "attempt-limit block below ordinal 128",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET
        attempt_disposition = 'blocked',
        attempt_block_reason = 'attemptLimitReached'`),
  },
  {
    name: "terminal block without preceding outcome",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET
        attempt_disposition = 'blocked',
        attempt_block_reason = 'terminalPublisherRefusal'`),
  },
  {
    name: "orphan preceding outcome",
    seed: "empty",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_publication_state SET
        preceding_query_key = ?,
        preceding_generation = '1',
        preceding_result_digest = ?,
        preceding_attempt_ordinal = 1,
        preceding_outcome = 'knownNotAppended',
        preceding_receipt_tag = 'recorded',
        preceding_next_attempt_ordinal = 2,
        preceding_next_disposition = 'ready'`).run(
          canonicalKey(203),
          canonicalKey(204),
        ),
  },
  {
    name: "wrong recorded successor ordinal",
    seed: "recorded",
    mutate: database => database.exec(`UPDATE
      deployment_sync_publication_state SET
        preceding_next_attempt_ordinal = 3`),
  },
  {
    name: "in-flight row with missing owner",
    seed: "inFlight",
    mutate: database => database.exec(
      "DELETE FROM deployment_sync_queries",
    ),
  },
  {
    name: "in-flight row with wrong owner identity",
    seed: "inFlight",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_in_flight_publication SET query_identity = ?`).run(
        canonicalKey(205),
      ),
  },
  {
    name: "in-flight row with future owner generation",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_in_flight_publication SET generation = '2'`),
  },
  {
    name: "in-flight row with wrong owner digest",
    seed: "inFlight",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_in_flight_publication SET result_digest = ?`).run(
        canonicalKey(206),
      ),
  },
  {
    name: "in-flight row beyond the scope sequence",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_in_flight_publication SET
        completed_through_sequence = '999'`),
  },
  {
    name: "pending row with missing owner",
    seed: "pending",
    mutate: database => database.exec(
      "DELETE FROM deployment_sync_queries",
    ),
  },
  {
    name: "pending row with wrong owner identity",
    seed: "pending",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_pending_publications SET query_identity = ?`).run(
        canonicalKey(207),
      ),
  },
  {
    name: "pending row with future owner generation",
    seed: "pending",
    mutate: database => database.exec(`UPDATE
      deployment_sync_pending_publications SET generation = '2'`),
  },
  {
    name: "pending row with wrong owner digest",
    seed: "pending",
    mutate: database => database.prepare(`UPDATE
      deployment_sync_pending_publications SET result_digest = ?`).run(
        canonicalKey(208),
      ),
  },
  {
    name: "pending row beyond the scope sequence",
    seed: "pending",
    mutate: database => database.exec(`UPDATE
      deployment_sync_pending_publications SET
        completed_through_sequence = '999'`),
  },
  {
    name: "in-flight count below physical state",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET in_flight_publication_count = 0`),
  },
  {
    name: "in-flight count above physical state",
    seed: "empty",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET in_flight_publication_count = 1`),
  },
  {
    name: "retained content undercount",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET retained_publication_content_bytes = 0`),
  },
  {
    name: "settlement envelope undercount",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET settlement_envelope_bytes = 0`),
  },
  {
    name: "settlement envelope overcount",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET
        settlement_envelope_bytes = settlement_envelope_bytes + 1`),
  },
  {
    name: "counted canonical bytes undercount",
    seed: "inFlight",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET counted_canonical_bytes = 0`),
  },
  {
    name: "pending row with zero counter",
    seed: "pending",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET pending_publication_count = 0`),
  },
  {
    name: "pending counter without a row",
    seed: "empty",
    mutate: database => database.exec(`UPDATE
      deployment_sync_scope_state SET pending_publication_count = 1`),
  },
]);

describe("deployment query-sync publication corruption closure", () => {
  it.each(corruptionCases)(
    "fails closed for $name without mutating admitted state",
    async ({ seed, mutate }) => {
      const probe = makePublicationSqlProbe();
      const prepared = await prepareEvaluationState(probe.hooks);
      try {
        await seedCorruptionState(prepared, seed, 80);
        mutate(prepared.database);
        const before = snapshotEvaluationState(prepared.database);
        probe.start();

        const exit = await Effect.runPromiseExit(
          prepared.state.claimPublication(),
        );

        expectStoredCorruption(exit);
        expect(probe.writeCount()).toBe(0);
        expect(probe.stop().every(stage => !stage.endsWith("cas")
          && !stage.endsWith("insert")
          && !stage.endsWith("delete"))).toBe(true);
        expect(snapshotEvaluationState(prepared.database)).toEqual(before);
      } finally {
        prepared.database.close();
      }
    },
  );
});

async function seedCorruptionState(
  prepared: Awaited<ReturnType<typeof prepareEvaluationState>>,
  seed: CorruptionSeed,
  querySeed: number,
): Promise<void> {
  if (seed === "empty") return;
  await installPendingPublication(
    prepared,
    querySeed,
    `publication-corruption-${querySeed}`,
  );
  if (seed === "pending") return;
  const attempt = await claimInstalledPublication(prepared);
  if (seed === "inFlight") return;
  await Effect.runPromise(prepared.state.recordPublicationAttemptOutcome(
    attempt,
    "knownNotAppended",
  ));
  if (seed === "recorded") return;
  await Effect.runPromise(
    prepared.state.completePublication(acceptanceFor(attempt)),
  );
}

function duplicateSingletonTable(
  database: DatabaseSync,
  tableName: string,
  retainedName: string,
): void {
  database.exec(`ALTER TABLE ${tableName} RENAME TO ${retainedName}`);
  database.exec(`CREATE TABLE ${tableName} AS
    SELECT * FROM ${retainedName}`);
  database.exec(`INSERT INTO ${tableName}
    SELECT * FROM ${retainedName}`);
  database.exec(`DROP TABLE ${retainedName}`);
}

function expectStoredCorruption(exit: Exit.Exit<unknown, unknown>): unknown {
  if (!Exit.isFailure(exit)) throw new Error("Expected stored corruption.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(failure).toMatchObject({
    _tag: "QuerySyncStoredStateCorruptError",
    operation: "claimPublication",
    commitCertainty: "notCommitted",
  });
  return failure;
}
