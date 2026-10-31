import { Cause, Exit } from "effect";
import { expect, it } from "vitest";
import { jsonToFlarexValueV1 } from "flarex-protocol/value";
import { CoreApplicationMutationError } from "@flarex/persistence-postgres/internal/core-application-mutation";
import type { ApplicationCoreFixture } from "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import type { CorePersistenceFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { proveHistoricalSourceWorker, proveSourceValidatorTranslation } from "../../support/sourceValidatorTranslation";

export function defineSourceValidatorTranslationContract(
  runScenario: <A>(scenario: (fixture: ApplicationCoreFixture) => Promise<A>) => Promise<A>,
  createHistoricalFixture: () => Promise<CorePersistenceFixture>,
): void {
  it("authenticates a real pre09 record artifact, replays its outcome and executes it with current Worker transport", async () => {
    const proof = await proveHistoricalSourceWorker(await createHistoricalFixture());
    expect(proof.generation).toBe(1);
    expect(proof.selected.identity).toEqual(proof.originalIdentity);
    expect(proof.coldSelected).toEqual(proof.selected);
    for (const replay of [proof.replay, proof.coldOriginalReplay]) expect(replay).toMatchObject({ disposition: "replayed",
      commitSeq: proof.originalOutcome.timestamp, value: proof.originalOutcome.result });
    expect(proof.replayWorkerLoads).toBe(0);
    expect(proof.fresh).toMatchObject({ disposition: "published", value: { Grace: 7 } });
    expect(proof.freshWorkerLoads).toBe(1);
    expect(proof.coldFreshReplay).toMatchObject({ disposition: "replayed", commitSeq: proof.fresh.commitSeq, value: proof.fresh.value });
    expect(proof.coldReplayWorkerLoads).toBe(0);
    expect(proof.rows).toHaveLength(3);
    expect(proof.rows).toEqual(expect.arrayContaining([expect.objectContaining({ scores: { Grace: 7 } })]));
  }, 180_000);

  it("publishes source records and document roots, executes Function/CommitTs, and reopens the same five-table database", async () => {
    const proof = await runScenario(proveSourceValidatorTranslation);
    expect(proof.coldAnalysisLoads).toBe(2);
    expect(proof.manifest.validatorIdentityEncoding).toBe(2);
    for (const [outcome, clock] of [[proof.first, -9223372036854775808n], [proof.second, 42n]] as const) {
      expect(outcome.disposition).toBe("published");
      expect(jsonToFlarexValueV1(outcome.value)).toMatchObject({ handle: proof.handle, clock, refused: true, emptyRefused: true });
    }
    for (const refusal of [proof.invalidHandle, proof.invalidClock]) {
      expect(Exit.isFailure(refusal)).toBe(true);
      if (Exit.isSuccess(refusal)) throw new Error("Invalid source-typed argument was admitted.");
      expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error instanceof CoreApplicationMutationError && reason.error.reason === "argumentsInvalid")).toBe(true);
    }
    expect(proof.invalidArgumentLoads).toBe(0);
    expect(Exit.isFailure(proof.invalidReturn)).toBe(true);
    expect(proof.beforeInvalidReturn).toHaveLength(2);
    expect(proof.afterInvalidReturn).toEqual(proof.beforeInvalidReturn);
    expect(proof.warm).toHaveLength(2);
    expect(proof.cold).toEqual(proof.warm);
    for (const row of proof.cold) {
      expect(row).toMatchObject({ handle: proof.handle, tag: "literal\u0000é", nested: { _kept: "nested" }, scores: { Ada: 42 } });
      expect(row).not.toHaveProperty("_removed");
    }
    expect(proof.replay).toMatchObject({ disposition: "replayed", commitSeq: proof.first.commitSeq, value: proof.first.value });
    expect(proof.replayWorkerLoads).toBe(0);
    expect(proof.fresh.disposition).toBe("published");
    expect(proof.final).toHaveLength(3);
    expect(proof.wideRows).toHaveLength(3);
    const wide = proof.manifest.schema.tables.find(table => table.name === "wideDocs");
    if (wide?.validator.type !== "object") throw new Error("Wide source document declaration was lost.");
    expect(Object.keys(wide.validator.value)).toHaveLength(1025);
    const singleton = proof.manifest.schema.tables.find(table => table.name === "singletonDocs");
    expect(singleton?.validator.type).toBe("object");
    expect(proof.manifest.schema.tables.find(table => table.name === "openDocs")?.validator.type).toBe("any");
    expect(proof.manifest.schema.tables.find(table => table.name === "emptyDocs")?.validator).toEqual({ type: "union", value: [] });
    expect(proof.storageTables).toEqual(["documents", "indexes", "leases", "persistence_globals", "read_only"]);
  }, 180_000);
}
