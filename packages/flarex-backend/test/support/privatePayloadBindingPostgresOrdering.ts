import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "vitest";
import { Schema } from "effect";
import type { PostgresFlarexPersistence } from "../../../persistence-postgres/src/database/postgres";
import { postgresBackendPid } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { waitForTransactionEntryOrFailure } from "../../../persistence-postgres/test/execution/session/support/postgresLocks";
import type { PrivateBindingSaveCoordinator } from "./privatePayloadBindingOrderingScenario";
import type { PrivateReverseReadCoordinator } from "./privatePayloadReverseFreshnessScenario";

const backendPid = Schema.Int.check(Schema.isGreaterThan(0));
const decodeWaiter = Schema.decodeUnknownSync(Schema.Struct({ pid: backendPid, blockers: Schema.Array(backendPid) }));

/** Observe exact server wait edges on this fixture's pool. Scheduling delays
 * are never acceptance evidence; both native writers must be distinct PIDs. */
async function blockedBy(persistence: PostgresFlarexPersistence, blocker: number, fragment: string) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const rows = (await persistence.query(`select pid::int as pid,
      pg_blocking_pids(pid)::int[] as blockers from pg_stat_activity
      where datname=current_database() and application_name=current_setting('application_name')
        and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid)) and query ilike $2`, [blocker, `%${fragment}%`])).rows;
    if (rows.length === 1) {
      const row = decodeWaiter(rows[0]);
      expect(row.pid).not.toBe(blocker);
      expect(row.blockers).toContain(blocker);
      return row.pid;
    }
    await delay(10);
  }
  const actual = await persistence.query(`select pid, state, wait_event_type, pg_blocking_pids(pid), query
    from pg_stat_activity where datname=current_database() and $1::int=any(pg_blocking_pids(pid))`, [blocker]);
  throw new Error(`No actual PostgreSQL waiter behind ${blocker} for ${fragment}: ${JSON.stringify(actual.rows)}`);
}

/** Test-only triggers pause real owners after their scope locks. The metadata
 * trigger injects the same named drift as LB2 inside activation, so save-first
 * sees valid metadata; only the binding owner repairs/stamps the projection.
 * These probes do not implement activation, publication or retry. */
export const postgresPrivateBindingSaveOrder = (persistence: PostgresFlarexPersistence): PrivateBindingSaveCoordinator => async input => {
  const barrier = await persistence.pool.connect();
  const barrierKey = randomInt(1, 1_000_000_000);
  const pending: Promise<void>[] = [];
  const observations: Promise<number>[] = [];
  try {
    await persistence.query(`create table lb3_order_probe (request_id text, scope_id text, mode text, first_owner text,
      barrier_key bigint, namespace text, owner_key text, contract_key text)`);
    await persistence.query("insert into lb3_order_probe values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [input.requestId, input.scopeId, input.mode, input.first, barrierKey,
        input.metadata.namespace, input.metadata.ownerKey, input.metadata.contractKey]);
    await persistence.query(`create function lb3_activation_probe() returns trigger language plpgsql set search_path from current as $$
      declare probe lb3_order_probe%rowtype;
      begin
        select * into probe from lb3_order_probe where request_id=new.request_id and scope_id=new.scope_id;
        if found then
          if probe.mode='metadata' then
            update fx_system_metadata_contract_observation set semantic_sha256_hex=repeat('f',64)
              where scope_id=probe.scope_id and namespace=probe.namespace and owner_key=probe.owner_key and contract_key=probe.contract_key;
            if not found then raise exception 'Missing actual consumed metadata row'; end if;
          end if;
          if probe.first_owner='activation' then perform pg_advisory_xact_lock(probe.barrier_key); end if;
        end if;
        return new;
      end $$`);
    await persistence.query(`create trigger lb3_activation_probe after insert on fx_system_data_binding_activation
      for each row execute function lb3_activation_probe()`);
    // The installed clock owner deliberately narrows search_path. Capture this
    // fixture's namespace explicitly so its probe remains resolvable inside it.
    await persistence.query(`create function lb3_save_probe() returns trigger language plpgsql set search_path from current as $$
      declare probe lb3_order_probe%rowtype;
      begin
        if new.last_commit_seq > old.last_commit_seq then
          select * into probe from lb3_order_probe where scope_id=new.scope_id and first_owner='save';
          if found then perform pg_advisory_xact_lock(probe.barrier_key); end if;
        end if;
        return new;
      end $$`);
    await persistence.query(`create trigger lb3_save_probe after update on fx_system_scope_clock
      for each row execute function lb3_save_probe()`);
    await barrier.query("select pg_advisory_lock($1::bigint)", [barrierKey]);
    const controllerPid = await postgresBackendPid(barrier);
    const first = input.first === "activation" ? input.activate() : input.save();
    pending.push(first);
    const handledFirst = Promise.allSettled([first]);
    const observingWinner = blockedBy(persistence, controllerPid,
      // The installed publisher advances the clock inside a SQL function;
      // pg_stat_activity exposes this leading projection, not its internal UPDATE.
      input.first === "activation" ? "fx_system_data_binding_activation" : "advanced.last_commit_seq");
    observations.push(observingWinner);
    const winnerPid = await waitForTransactionEntryOrFailure(observingWinner, first, "first binding/save owner");
    const second = input.first === "activation" ? input.save() : input.activate();
    pending.push(second);
    const handledSecond = Promise.allSettled([second]);
    // Both authority and sequencer locks are real owned barriers. The actual
    // statement determines which one this execution profile reaches first.
    const loserPid = await blockedBy(persistence, winnerPid, "fx_system_scope_");
    expect(new Set([controllerPid, winnerPid, loserPid]).size).toBe(3);
    await barrier.query("select pg_advisory_unlock($1::bigint)", [barrierKey]);
    await Promise.all([first, second]);
    await Promise.all([handledFirst, handledSecond]);
  } finally {
    await barrier.query("select pg_advisory_unlock($1::bigint)", [barrierKey]);
    barrier.release();
    await Promise.allSettled([...pending, ...observations]);
    await persistence.query("drop trigger if exists lb3_activation_probe on fx_system_data_binding_activation");
    await persistence.query("drop trigger if exists lb3_save_probe on fx_system_scope_clock");
    await persistence.query("drop function if exists lb3_activation_probe()");
    await persistence.query("drop function if exists lb3_save_probe()");
    await persistence.query("drop table if exists lb3_order_probe");
  }
};

/** RR3 pauses real publication/activation after scope ownership and observes
 * the second owner's server lock edge before allowing either to settle. */
export const postgresPrivateReverseReadOrder = (persistence: PostgresFlarexPersistence): PrivateReverseReadCoordinator => async input => {
  const barrier = await persistence.pool.connect();
  const key = randomInt(1, 1_000_000_000);
  const pending: Promise<unknown>[] = [];
  try {
    await persistence.query(`create function rr3_clock_probe() returns trigger language plpgsql set search_path from current as $$
      begin
        if new.scope_id='${input.scopeId}' and new.last_commit_seq > old.last_commit_seq then
          perform pg_advisory_xact_lock(${key});
        end if;
        return new;
      end $$`);
    await persistence.query(`create trigger rr3_clock_probe after update on fx_system_scope_clock for each row execute function rr3_clock_probe()`);
    await persistence.query(`create function rr3_activation_probe() returns trigger language plpgsql set search_path from current as $$
      begin
        if new.scope_id='${input.scopeId}' then perform pg_advisory_xact_lock(${key}); end if;
        return new;
      end $$`);
    await persistence.query(`create trigger rr3_activation_probe after insert on fx_system_data_binding_activation for each row execute function rr3_activation_probe()`);
    await barrier.query("select pg_advisory_lock($1::bigint)", [key]);
    const controller = await postgresBackendPid(barrier);
    const first = input.first === "read" ? input.read() : input.change();
    pending.push(Promise.allSettled([first]));
    const observed = blockedBy(persistence, controller, input.first === "change" && input.activation ? "fx_system_data_binding_activation" : "advanced.last_commit_seq");
    pending.push(observed);
    const winner = await waitForTransactionEntryOrFailure(observed, first, "first RR3 publication owner");
    const second = input.first === "read" ? input.change() : input.read();
    pending.push(Promise.allSettled([second]));
    const waiting = blockedBy(persistence, winner, "fx_system_scope_");
    pending.push(waiting);
    const loser = await waitForTransactionEntryOrFailure(waiting, second, "second RR3 publication owner");
    expect(new Set([controller, winner, loser]).size).toBe(3);
    await barrier.query("select pg_advisory_unlock($1::bigint)", [key]);
    await Promise.all([first, second]);
  } finally {
    await barrier.query("select pg_advisory_unlock($1::bigint)", [key]);
    barrier.release();
    await Promise.allSettled(pending);
    await persistence.query("drop trigger if exists rr3_clock_probe on fx_system_scope_clock");
    await persistence.query("drop trigger if exists rr3_activation_probe on fx_system_data_binding_activation");
    await persistence.query("drop function if exists rr3_clock_probe()");
    await persistence.query("drop function if exists rr3_activation_probe()");
  }
};
