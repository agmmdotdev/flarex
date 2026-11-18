import { Cause, Effect, Exit } from "effect";
import { expect } from "vitest";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import type { Json } from "flarex-protocol/json";
import { CoreTransactionError, type CoreProgramDefinition } from "../../../persistence-postgres/src/core/api";
import { CoreApplicationMutationError } from "../../../persistence-postgres/src/application/coreMutation";
import { coreNativeFixtureData } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { createNativeProtectedWorkerFixture } from "./nativeProtectedWorkerFixture";

const handlerSource = `export async function save(ctx, args) {
  return ctx.db.insert("users", { name: args.name });
}`;

/** Genuine program publication and schema lifecycle run at an actual Worker
 * point-operation boundary. No metadata rows or dependency sets are fabricated. */
export async function nativeProtectedMetadataWorkerScenarios(driver: "pglite" | "postgres") {
  let afterInsert: (() => Promise<void>) | undefined;
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource,
    onCapabilityResult: async method => {
      if (method !== "insertPointDocument") return;
      const action = afterInsert; afterInsert = undefined;
      await action?.();
    } });
  try {
    const { run, access, path } = fixture;
    const root = fixture.sourceRoot([]);
    const invoke = (label: string, args: Json = { name: label }) => fixture.port(root, { kind: "sourceRead", ids: [] })
      .invoke(path, args, TransactionRequestKeyV1Schema.make(`native-metadata-${label}`), access);
    const activate = (programs: readonly CoreProgramDefinition[]) => run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const proposal = yield* database.prepareSchema({ bundle: fixture.bundle });
      for (let step = 0; step < 512; step++) {
        const status = yield* database.schemaStatus(proposal);
        if (status.state === "failed" || status.state === "overwritten") throw new Error(`Actual protected metadata publication failed: ${status.error}`);
        if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
          yield* database.activateSchema(proposal, { bundle: fixture.bundle, programs });
          return;
        }
        yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
      }
      throw new Error("Actual protected metadata publication exceeded its work allowance");
    })));

    // An incidental active schema document handoff changes no consumed table,
    // index, actor or explicit revocation meaning and does not fence this root.
    const beforeCompatible = await fixture.inventory(), compatibleLoads = fixture.loader.loads;
    afterInsert = () => activate(fixture.programs);
    const compatible = await run(invoke("compatible-schema-handoff"));
    expect(compatible.disposition).toBe("published");
    expect(fixture.loader.loads).toBe(compatibleLoads + 1);
    const afterCompatible = await fixture.inventory();
    expect(afterCompatible.rows.length - beforeCompatible.rows.length).toBe(1);
    expect(afterCompatible.revisions.filter(row => row.timestamp === compatible.timestamp)).toHaveLength(1);

    // Even this source-only profile declares an Application actor. Its exact
    // revision/head was consumed up front, before any permission-table read.
    const alternate = await run(fixture.programsForGeneration(2));
    expect(alternate[0]?.identity.programHash).not.toBe(fixture.program.identity.programHash);
    const beforeAba = await fixture.inventory(), abaLoads = fixture.loader.loads;
    afterInsert = async () => { await activate(alternate); await activate(fixture.programs); };
    const aba = await run(Effect.exit(invoke("actor-head-aba")));
    if (Exit.isSuccess(aba)) throw new Error("Protected actor head ABA unexpectedly published");
    const failures = aba.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
    expect(failures.some(error => error instanceof CoreTransactionError && error.reason === "conflict"), Cause.pretty(aba.cause)).toBe(true);
    expect(fixture.loader.loads).toBe(abaLoads + 1);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeAba));
    expect((await run(invoke("fresh-after-actor-restoration"))).disposition).toBe("published");

    // Explicit global revocation is consumed even when unrelated schema heads
    // are not. A newly issued grant may enter a fresh invocation afterwards.
    const beforeRevocation = await fixture.inventory(), revokedLoads = fixture.loader.loads;
    afterInsert = () => run(fixture.useGeneration(({ database }) => database.advanceAuthorityEpoch(1n))).then(() => undefined);
    const revoked = await run(Effect.exit(invoke("explicit-authority-revocation")));
    if (Exit.isSuccess(revoked)) throw new Error("Revoked protected Worker unexpectedly published");
    const revokedFailures = revoked.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
    expect(revokedFailures.some(error => error instanceof CoreApplicationMutationError && error.reason === "revoked"
      || error instanceof CoreTransactionError && error.reason === "authorityRevoked"), Cause.pretty(revoked.cause)).toBe(true);
    expect(fixture.loader.loads).toBe(revokedLoads + 1);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeRevocation));
    expect((await run(invoke("fresh-after-explicit-revocation"))).disposition).toBe("published");
  } finally { await fixture.close(); }
}
