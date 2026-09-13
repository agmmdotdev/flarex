import { Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "../src/migrationCoordination/graphReadPass";
import { frameworkMigrationGraphPolicy, withBindingMigrationGraphLimits, withAdditiveMigrationGraphLimits } from "../src/migrationCoordination/graphLimits";
import { FrameworkMigrationRepositoryError } from "../src/migrationCoordination/repositoryErrors";
import { runEffect } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

describe("immutable graph read pass", () => {
  it("does not reuse unrestricted evidence under additive traversal limits", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const memo = makeFrameworkGraphReferenceRead<number>();
    const read = Effect.gen(function* () {
      if ((yield* frameworkMigrationGraphPolicy) !== "ordinary") return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal("readPlan"));
      return 129;
    });
    await persistence.drizzle.transaction(tx => runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
      expect(yield* memo(read, tx, "over-limit-reference")).toBe(129);
      expect(Exit.isFailure(yield* Effect.exit(withAdditiveMigrationGraphLimits(memo(read, tx, "over-limit-reference"))))).toBe(true);
      expect(yield* memo(read, tx, "over-limit-reference")).toBe(129);
    }), tx)));
  }, 30_000);
  it("distinguishes binding from additive policy and never downgrades nested additive reads", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const memo = makeFrameworkGraphReferenceRead<string>();
    const read = Effect.gen(function* () { return yield* frameworkMigrationGraphPolicy; });
    await persistence.drizzle.transaction(tx => runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
      expect(yield* memo(read, tx, "same")).toBe("ordinary");
      expect(yield* withBindingMigrationGraphLimits(memo(read, tx, "same"))).toBe("binding");
      expect(yield* withAdditiveMigrationGraphLimits(withBindingMigrationGraphLimits(memo(read, tx, "same")))).toBe("additive");
      expect(yield* withBindingMigrationGraphLimits(memo(read, tx, "same"))).toBe("binding");
    }), tx)));
  }, 30_000);
  it("reuses exact references only within one pass and transaction", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const other = await createMigratedPGlitePersistence();
    const memo = makeFrameworkGraphReferenceRead<number>();
    let reads = 0;
    const read = Effect.sync(() => ++reads);
    const authority = {};
    await persistence.drizzle.transaction(async tx => {
      await other.drizzle.transaction(async otherTx => {
        await runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
          expect(yield* memo(read, tx, authority, 1n)).toBe(1);
          expect(yield* memo.peek(tx, authority, 1n)).toEqual(Option.some(1));
          expect(yield* memo.peek(otherTx, authority, 1n)).toEqual(Option.none());
          expect(yield* memo(read, tx, authority, 1n)).toBe(1);
          // Equal spelling is not object authority or equal runtime type.
          expect(yield* memo(read, tx, {}, 1n)).toBe(2);
          expect(yield* memo(read, tx, authority, "1")).toBe(3);
          expect(yield* memo(read, otherTx, authority, 1n)).toBe(4);
          expect(yield* withFrameworkGraphReadPass(memo(read, otherTx, authority, 1n), otherTx)).toBe(5);
          expect(yield* memo(read, tx, authority, 1n)).toBe(1);
        }), tx));
        expect(await runEffect(withFrameworkGraphReadPass(memo(read, tx, authority, 1n), tx))).toBe(6);
        expect(await runEffect(memo(read, tx, authority, 1n))).toBe(7);
      });
      expect(await runEffect(memo.peek(tx, authority, 1n))).toEqual(Option.none());
    });
  }, 30_000);

  it("retains no failure and closes inherited contexts on interruption", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const memo = makeFrameworkGraphReferenceRead<number>();
    const sentinel = FrameworkMigrationRepositoryError.storedCorruption("readPlan");
    let reads = 0;
    const read = Effect.sync(() => ++reads);
    await persistence.drizzle.transaction(async tx => {
      const context = await runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
        const failed = yield* Effect.exit(memo(Effect.fail(sentinel), tx, "same"));
        expect(Exit.isFailure(failed)).toBe(true);
        expect(yield* memo(read, tx, "same")).toBe(1);
        return yield* Effect.context();
      }), tx));
      expect(await runEffect(memo(read, tx, "same").pipe(Effect.provideContext(context)))).toBe(2);

      let interruptedContext = Option.none<typeof context>();
      const interrupted = await Effect.runPromiseExit(withFrameworkGraphReadPass(Effect.gen(function* () {
        interruptedContext = Option.some(yield* Effect.context());
        yield* memo(read, tx, "interrupted");
        return yield* Effect.interrupt;
      }), tx));
      expect(Exit.isFailure(interrupted)).toBe(true);
      expect(await runEffect(memo(read, tx, "interrupted").pipe(
        Effect.provideContext(Option.getOrThrow(interruptedContext)),
      ))).toBe(4);
    });
  }, 30_000);

  it("bounds retained references while preserving uncached validation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const memo = makeFrameworkGraphReferenceRead<number>();
    let reads = 0;
    const read = Effect.sync(() => ++reads);
    await persistence.drizzle.transaction(tx => runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
      for (let index = 0; index < 600; index += 1) yield* memo(read, tx, index);
      expect(reads).toBe(600);
      expect(yield* memo(read, tx, 0)).toBe(1);
      expect(yield* memo(read, tx, 599)).toBe(601);
    }), tx)));
  }, 30_000);
});
