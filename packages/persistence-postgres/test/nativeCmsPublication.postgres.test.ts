import { Deferred, Effect, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createPointCommitPublisherPortV1 } from "../src/pointCommitTransaction";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { prepareNativeRangePublication } from "./nativeCommandPublicationScenario";
import { nativeCmsPublicationCorrectness, verifyNativeAuditPublication } from "./nativeCmsPublicationScenario";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ _id: Schema.String })));

describe.skipIf(postgresUrl === null)("native publication with CMS snapshots", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("preserves native publication, replay and CMS phantom refusal", () => withPersistence(async persistence => {
    await nativeCmsPublicationCorrectness(await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence)));
  }), 120_000);

  it("prepares, seals and publishes a native attempt while a CMS snapshot stays admitted", () => withPersistence(async persistence => {
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    let armed = false;
    const tested = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence), {
      afterAdmission: () => armed ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void,
    });
    const seeded = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "before-native-attempt" }));
    const ids = decodeIds(seeded).map(document => document._id);
    armed = true;
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const reader = yield* tested.host.read(tested.read, ids).pipe(Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
      const prepared = yield* prepareNativeRangePublication(tested.fixture, "during-snapshot");
      const before = yield* Effect.promise(() => tested.inventory());
      const publisher = createPointCommitPublisherPortV1(tested.fixture.pointCommitAuthority, prepared.options);
      expect(yield* publisher.publish(prepared.command)).toMatchObject({ kind: "published" });
      const after = yield* Effect.promise(() => verifyNativeAuditPublication(tested, before));
      expect(yield* publisher.publish(prepared.command)).toMatchObject({ kind: "replayed" });
      expect(yield* Effect.promise(() => tested.inventory())).toEqual(after);
      expect(yield* Deferred.isDone(release)).toBe(false);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(reader)).toEqual(seeded);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);

  it.each(["reader", "publisher"] as const)("overlaps with %s first without exposing uncommitted publication", first => withPersistence(async persistence => {
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const pause = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)));
    let armed = false;
    const tested = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence), {
      afterAdmission: () => armed && first === "reader" ? pause : Effect.void,
    });
    const seeded = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "cms-before-native" }));
    const ids = decodeIds(seeded).map(document => document._id);
    const prepared = await runEffect(prepareNativeRangePublication(tested.fixture, `native-${first}`));
    expect(prepared.command.rowIntents).toHaveLength(1);
    const publisher = createPointCommitPublisherPortV1(tested.fixture.pointCommitAuthority, { ...prepared.options,
      afterTransactionStep: event => event.step === "clockAdvanced" && first === "publisher" ? runEffect(pause) : Promise.resolve(),
    });
    const before = await tested.inventory();
    armed = true;
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const held = yield* (first === "reader" ? tested.host.read(tested.read, ids) : publisher.publish(prepared.command)).pipe(Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
      if (first === "reader") {
        expect(yield* publisher.publish(prepared.command)).toMatchObject({ kind: "published" });
      } else {
        expect(yield* tested.host.read(tested.read, ids)).toEqual(seeded);
        expect(yield* Effect.promise(() => tested.inventory())).toEqual(before);
      }
      expect(yield* Deferred.isDone(release)).toBe(false);
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(held);
      if (first === "reader") expect(result).toEqual(seeded);
      else expect(result).toMatchObject({ kind: "published" });
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
    const after = await verifyNativeAuditPublication(tested, before);
    expect(await runEffect(publisher.publish(prepared.command))).toMatchObject({ kind: "replayed" });
    expect(await tested.inventory()).toEqual(after);
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);
});
