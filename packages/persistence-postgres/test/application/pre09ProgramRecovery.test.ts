import { createHash, randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { readCoreApplicationProgram } from "../../src/application/coreProgram";
import { openCoreDatabase } from "../../src/core/database";
import { loadBootstrapRegistry } from "../../src/core/bootstrap";
import { loadCoreRegistry } from "../../src/core/registry";
import { createCorePGliteFixture } from "../core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../core/schemaFixture";
import { readPre09CapturedProgramStore, seedPre09CapturedProgramStore } from "./pre09CapturedProgramStore";

const hash = (value: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(value).digest()));
it("cold reopens frozen pre09 positive-record identities, actual head and committed outcome unchanged", async () => {
  const fixture = await createCorePGliteFixture();
  try {
    const store = await readPre09CapturedProgramStore();
    await seedPre09CapturedProgramStore(fixture, store);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), {
        schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Effect.succeed(2_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
      });
      for (const frozen of store.programs) {
        const selected = yield* database.selectProgram(frozen.identity.functionPath);
        expect(selected).toEqual(frozen);
        const authenticated = yield* readCoreApplicationProgram(selected, hash);
        expect(authenticated.validatorIdentityEncoding).toBe(1);
        expect(authenticated.runtimeTarget.validatorIdentityEncoding).toBeUndefined();
      }
      const snapshot = yield* fixture.persistence.readSnapshot(yield* database.publishedTimestamp);
      const registry = yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(fixture.persistence, snapshot));
      expect(registry.head(store.requestIdentity.program.functionPath)).toEqual(store.head);
      expect(yield* database.recoverRequest(store.requestIdentity)).toEqual(store.outcome);
      expect(yield* database.claimRequest(store.requestIdentity)).toEqual(store.outcome);
      const frozen = store.programs.find(program => program.identity.functionPath === "items:mutation");
      if (frozen === undefined) throw new Error("Frozen mutation missing");
      for (const metadata of [{ ...frozen.metadata, validatorIdentityEncoding: 3 },
        { ...frozen.metadata, format: "unknown" }, { ...frozen.metadata, version: 2 }]) {
        const result = yield* Effect.result(readCoreApplicationProgram({ ...frozen, metadata }, hash));
        expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "metadataInvalid" });
      }
    })));
  } finally { await fixture.close(); }
}, 120_000);
