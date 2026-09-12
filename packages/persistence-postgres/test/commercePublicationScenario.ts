import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import type { CommerceCommand } from "../src/commerceTransaction/commands";
import { makeCommerceHost } from "../src/commerceTransaction/host";
import { issueRelationalSession, runRelationalSession } from "../src/relationalTransaction/session";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { fxSystemCommitRelationalChanges } from "../src/commitPublication/relationalFactsSchema";
import { readRelationalCommitFactsInTransaction } from "../src/commitPublication/relationalFacts";
import { createCommitFeedRepositoryV1 } from "../src/commitFeed";
import { commerceInventory, compactCommerceHistory } from "./commerceInventory";
import type { CommerceHostTestFixture } from "./commerceHostFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export async function commercePublicationScenario(fixture: CommerceHostTestFixture, command: CommerceCommand, args: Json) {
  const initializationPolicy = fixture.descriptor.initialization;
  if (initializationPolicy === null) throw new Error("This scenario requires initialization");
  const db = fixture.persistence.drizzle;
  const hostInput = { ...fixture.hostInput, commands: [...fixture.hostInput.commands, command] };
  const host = await runEffect(makeCommerceHost(hostInput));
  const before = await commerceInventory(fixture);
  const clock = before.clocks[0];
  if (clock === undefined || clock.scopeUuid === null) throw new Error("Missing fixture clock");
  const scopeUuid = clock.scopeUuid;
  const keyInput = { scopeUuid, commitSeq: CommitSeqSchema.make(1n), installations: [{ installationSha256: fixture.installation.installation.installationSha256, layout: fixture.descriptor.layout }] };
  expect(await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, keyInput)))).toHaveLength(initializationPolicy.expectedRowCount);
  const feed = await runEffect(createCommitFeedRepositoryV1(db).listAfter({ scopeUuid: scopeUuid, exclusiveCommitSeq: CommitSeqSchema.make(0n) }));
  expect(feed.commits.length).toBe(before.commits.length);
  const rollback = new Error("Rollback deliberate fact corruption");
  await db.transaction(async tx => {
    await tx.update(fxSystemCommitRelationalChanges).set({ keyBytes: new TextEncoder().encode('{"wrong":"key"}') }).where(and(
      eq(fxSystemCommitRelationalChanges.scopeUuid, scopeUuid), eq(fxSystemCommitRelationalChanges.commitSeq, CommitSeqSchema.make(1n)), eq(fxSystemCommitRelationalChanges.changeOrdinal, 0)));
    expect(await runEffectFailure(readRelationalCommitFactsInTransaction(tx, keyInput))).toMatchObject({ reason: "storedCorruption" });
    throw rollback;
  }).catch(cause => { if (cause !== rollback) throw cause; });
  expect(await commerceInventory(fixture)).toEqual(before);

  // Deliberate test-only DDL fails each durable publication stage after business
  // DML. These are fixture-owned trigger names in an isolated metadata schema.
  for (const table of ["fx_system_commit", "fx_system_commit_relational_change", "fx_system_idempotency", "fx_system_commit_wake", "fx_system_scope_clock"]) {
    await fixture.persistence.exec("create function fx_test_commerce_failure() returns trigger language plpgsql as $$ begin raise exception 'commerce publication failure'; end $$");
    try {
      await fixture.persistence.exec(`create trigger fx_test_commerce_failure before ${table === "fx_system_scope_clock" ? "update" : "insert"} on "${table}" for each row execute function fx_test_commerce_failure()`);
      await runEffectFailure(host.run(host.newRequestKey(), command, args));
      expect(await commerceInventory(fixture)).toEqual(before);
    } finally {
      await fixture.persistence.exec(`drop trigger if exists fx_test_commerce_failure on "${table}"`);
      await fixture.persistence.exec("drop function fx_test_commerce_failure()");
    }
  }

  // Simulate a lost acknowledgement only after the real physical COMMIT. The
  // host must use a second session to recover; the command cannot execute twice.
  let loseAcknowledgement = true;
  const session = issueRelationalSession(db, work => runRelationalSession(fixture.session, work).pipe(Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))), Effect.flatMap(value => {
    if (!loseAcknowledgement) return Effect.succeed(value);
    loseAcknowledgement = false;
    return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost COMMIT acknowledgement") }));
  })));
  const uncertain = await runEffect(makeCommerceHost({ ...hostInput, session }));
  const requestKey = uncertain.newRequestKey();
  const result = await runEffect(uncertain.run(requestKey, command, args));
  const recovered = await commerceInventory(fixture);
  expect(recovered.commits).toHaveLength(before.commits.length + 1);
  expect(await runEffect(uncertain.run(requestKey, command, args))).toEqual(result);
  expect(await commerceInventory(fixture)).toEqual(recovered);

  if ("pool" in fixture.persistence) {
    expect((await fixture.persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    const simultaneousKey = host.newRequestKey();
    const results = await Promise.allSettled([runEffect(host.run(simultaneousKey, command, args)), runEffect(host.run(simultaneousKey, command, args))]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect((await commerceInventory(fixture)).commits).toHaveLength(recovered.commits.length + 1);
  }

  const retained = await commerceInventory(fixture);
  const last = retained.commits.at(-1);
  if (last === undefined) throw new Error("Missing retained commit");
  const compacted = await compactCommerceHistory(fixture);
  expect(compacted.commits).toHaveLength(1);
  expect(compacted.facts.every(fact => fact.commitSeq === last.commitSeq)).toBe(true);
  expect(compacted.rows).toEqual(retained.rows);
  expect(compacted.initialization).toEqual(retained.initialization);
  const initialization = fixture.prepared.initialization.rows;
  if (initialization === undefined) throw new Error("Missing bootstrap dataset");
  expect(await runEffect(host.initialize(initialization))).toEqual({ rowCount: initializationPolicy.expectedRowCount });
}
