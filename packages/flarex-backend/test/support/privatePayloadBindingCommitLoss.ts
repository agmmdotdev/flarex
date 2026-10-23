import { Schema } from "effect";
import { expect } from "vitest";
import { projectScopeIdUuidV1, type ScopeId } from "flarex-protocol/storage-authority";
import type { PostgresFlarexPersistence } from "../../../persistence-postgres/src/database/postgres";
import { installPoolCommitResponseFault } from "./postgresCommitResponseFault";

export type PrivateBindingCommitLossTarget = Readonly<{ kind: "activation"; requestId: string }> |
  Readonly<{ kind: "save"; baselineCommits: number }>;
const pid = Schema.Int.check(Schema.isGreaterThan(0));
const decodePid = Schema.decodeUnknownSync(Schema.Struct({ pid }));
const decodeObservation = Schema.decodeUnknownSync(Schema.Struct({ pid, count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }));

/** Actual driver COMMIT is forwarded first. Only an independent ordinary-role
 * pool's durable observation can arm response loss and the later transition.
 * This fixture never commits, retries or resolves an outcome on the owner's behalf. */
export async function privatePayloadBindingCommitLoss(input: Readonly<{
  producer: PostgresFlarexPersistence;
  observer: PostgresFlarexPersistence;
  scopeId: ScopeId;
  target: PrivateBindingCommitLossTarget;
  run: () => Promise<void>;
  afterDurable: () => Promise<void>;
}>) {
  let fired = 0;
  const target = input.target;
  const fault = installPoolCommitResponseFault(input.producer.pool, client => ({ commit: forward => {
    if (fired !== 0) return forward();
    return (async () => {
      const committer = decodePid((await client.query("select pg_backend_pid()::int as pid")).rows[0]);
      const result = await forward();
      const observed = decodeObservation((target.kind === "activation"
        ? await input.observer.query(`select pg_backend_pid()::int as pid, count(*)::int as count
          from fx_system_data_binding_activation where scope_id=$1 and request_id=$2`, [input.scopeId, target.requestId])
        : await input.observer.query(`select pg_backend_pid()::int as pid, count(*)::int as count
          from fx_system_commit where scope_uuid=$1`, [projectScopeIdUuidV1(input.scopeId).scopeUuid])).rows[0]);
      const baseline = target.kind === "activation" ? 0 : target.baselineCommits;
      if (observed.count === baseline) return result;
      expect(observed.pid).not.toBe(committer.pid);
      expect(observed.count).toBe(baseline + 1);
      fired++;
      await input.afterDurable();
      throw new Error(`Private ${target.kind} COMMIT acknowledgement lost after independently observed durability`);
    })();
  } }), () => fired === 1);
  try { await input.run(); expect(fired).toBe(1); }
  finally { fault.restore(); }
}
