import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { Pool } from "pg";
import { expect } from "vitest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { flarexSchema, fxSystemApplicationCandidatesV1, fxSystemPreparedMetadataEpoch } from "../../../src/database/schema";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import { postgresUrl } from "../../support/postgresHelpers";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  type AdvanceScopeAuthorizationRevocationEpochResult, type AdvanceScopeAuthorizationRevocationEpochError } from "../../../src/scope/scopeClock";

/** The ordinary schema owner performs a bounded, valid metadata statement.
 * No grant, trigger, installation policy or durable bytes are changed. */
export async function makeManagedReadMetadataMutationWitness(target: PostgresFlarexPersistence, scopeId: ScopeId) {
  const schemaName = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
  if (postgresUrl === null || schemaName === undefined || !/^[a-z0-9_]+$/.test(schemaName))
    throw new Error("Missing managed metadata mutation owner");
  const owner = new Pool({ connectionString: postgresUrl, options: `-c search_path=${schemaName}` });
  const database = drizzle(owner, { schema: flarexSchema });
  const failure = (cause: unknown) => new Error("Managed metadata mutation statement", { cause });
  const mutate = async (kind: "candidate" | "head") => Effect.runPromise(runEffectTransaction<void, Error, Error, FlarexMetadataTransaction>(
    work => database.transaction(work), "Managed metadata mutation rolled back", tx => Effect.gen(function* () {
      yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '5000ms', true),
        set_config('lock_timeout', '2000ms', true)`), failure);
      const [before] = yield* runDrizzleStatementEffect(tx.select().from(fxSystemPreparedMetadataEpoch), failure);
      if (before === undefined) throw new Error("Missing metadata epoch");
      if (kind === "candidate") {
        const [original] = yield* runDrizzleStatementEffect(tx.select().from(fxSystemApplicationCandidatesV1)
          .where(eq(fxSystemApplicationCandidatesV1.scopeId, scopeId)).limit(1), failure);
        if (original === undefined) throw new Error("Missing authentic Application candidate");
        const changed = yield* runDrizzleStatementEffect(tx.update(fxSystemApplicationCandidatesV1)
          .set({ candidateId: fxSystemApplicationCandidatesV1.candidateId })
          .where(eq(fxSystemApplicationCandidatesV1.candidateId, original.candidateId)).returning(), failure);
        expect(changed).toEqual([original]);
      } else {
        const [original] = yield* runDrizzleStatementEffect(tx.select().from(fxSystemApplicationActiveHeads)
          .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId)).limit(1), failure);
        if (original === undefined) throw new Error("Missing authentic Application head");
        const changed = yield* runDrizzleStatementEffect(tx.update(fxSystemApplicationActiveHeads)
          .set({ updatedAt: fxSystemApplicationActiveHeads.updatedAt })
          .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId)).returning(), failure);
        expect(changed).toEqual([original]);
      }
      const [after] = yield* runDrizzleStatementEffect(tx.select().from(fxSystemPreparedMetadataEpoch), failure);
      expect(after?.generation).toBe(before.generation + 1n);
    }), cause => new Error("Managed metadata mutation settlement", { cause }),
  ));
  const advanceAuthorization = () => Effect.runPromise(runEffectTransaction<AdvanceScopeAuthorizationRevocationEpochResult,
    AdvanceScopeAuthorizationRevocationEpochError | Error, Error, FlarexMetadataTransaction>(
    work => database.transaction(work), "Managed authorization transition rolled back", tx => Effect.gen(function* () {
      yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '5000ms', true),
        set_config('lock_timeout', '2000ms', true)`), failure);
      const [before] = yield* runDrizzleStatementEffect(tx.select().from(fxSystemPreparedMetadataEpoch), failure);
      const result = yield* advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId);
      const [after] = yield* runDrizzleStatementEffect(tx.select().from(fxSystemPreparedMetadataEpoch), failure);
      expect(result.current).toBe(result.previous + 1n);
      expect(after).toEqual(before);
      return result;
    }), cause => new Error("Managed authorization transition settlement", { cause }),
  ));
  return Object.freeze({ invalidateCandidate: () => mutate("candidate"), touchActiveHead: () => mutate("head"), advanceAuthorization,
    close: () => owner.end() });
}
