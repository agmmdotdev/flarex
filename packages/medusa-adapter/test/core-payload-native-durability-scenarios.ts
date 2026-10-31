import { Effect, Result, Schema } from "effect";
import { expect, it } from "vitest";
import { inspectPayloadRuntimeForTest, PayloadValidationError } from "../../payload-adapter/src/testing";
import { defineCmsCommand } from "../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import { createCorePayloadFixture } from "./support/core-payload-fixture";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String }));

/** Actual Local API bodies, shared claims/outcomes and physical owner reopen. */
export function registerCorePayloadNativeDurability(driver: "pglite" | "postgres"): void {
  it("replays the exact committed native result after owner replacement without another body", async () => {
    const fixture = await createCorePayloadFixture(driver);
    try {
      let bodies = 0;
      const create = inspectPayloadRuntimeForTest(fixture.runtime).commands.create;
      const command = defineCmsCommand({ name: "nativeDurableCreate", mode: "write", run: Effect.fn(function* (ctx, title) {
        bodies += 1;
        return yield* ctx.nested(create, { collection: "news", data: { title } });
      }) });
      const originalHost = await fixture.run(fixture.openHost([command]));
      const key = originalHost.newRequestKey();
      const created = await fixture.run(originalHost.run(key, command, "durable-native"));
      const decoded = document(created);
      expect(bodies).toBe(1);
      await fixture.reopen();
      const reopenedHost = await fixture.run(fixture.openHost([command]));
      expect(await fixture.run(reopenedHost.run(key, command, "durable-native"))).toEqual(created);
      expect(bodies).toBe(1);
      expect(await fixture.run(fixture.reader.findByID({ collection: "news", id: decoded.id }))).toEqual(created);
      expect(await fixture.run(Effect.result(reopenedHost.run(key, command, "different-arguments"))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(bodies).toBe(1);
      expect(await fixture.run(fixture.reader.count({ collection: "news", where: {} }))).toEqual({ totalDocs: 1 });
    } finally { await fixture.close(); }
  });

  it("reconciles a lost commit acknowledgement after reopen without executing native work again", async () => {
    const fixture = await createCorePayloadFixture(driver);
    try {
      let bodies = 0;
      const create = inspectPayloadRuntimeForTest(fixture.runtime).commands.create;
      let created: unknown;
      const command = defineCmsCommand({ name: "nativeLostAcknowledgement", mode: "write", run: Effect.fn(function* (ctx) {
        bodies += 1;
        const value = yield* ctx.nested(create, { collection: "news", data: { title: "lost-native-ack" } });
        created = value;
        // Claim acquisition and all native work are complete. Fault only the
        // following actual persistence write's acknowledgement, after SQL saves.
        fixture.loseNextWriteAcknowledgement();
        return value;
      }) });
      const originalHost = await fixture.run(fixture.openHost([command]));
      const key = originalHost.newRequestKey();
      expect(await fixture.run(Effect.result(originalHost.run(key, command, null))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "decisionUncertain", cause: { reason: "uncertainWrite" } } });
      expect(bodies).toBe(1);
      await fixture.reopen();
      const reopenedHost = await fixture.run(fixture.openHost([command]));
      expect(await fixture.run(reopenedHost.run(key, command, null))).toEqual(created);
      expect(bodies).toBe(1);
      expect(await fixture.run(fixture.reader.count({ collection: "news", where: { title: { equals: "lost-native-ack" } } })))
        .toEqual({ totalDocs: 1 });
    } finally { await fixture.close(); }
  });

  it("keeps a caught native uniqueness rejection rollback-only and permits pending key release", async () => {
    const fixture = await createCorePayloadFixture(driver);
    try {
      const seeded = document(await fixture.run(fixture.writer.create(fixture.writer.newRequestKey(), {
        collection: "news", data: { title: "already-owned" },
      })));
      const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
      let failedBodies = 0;
      const caught = defineCmsCommand({ name: "nativeCaughtUnique", mode: "write", run: Effect.fn(function* (ctx) {
        failedBodies += 1;
        const own = yield* ctx.nested(commands.create, { collection: "news", data: { title: "must-roll-back" } });
        const observed = yield* Effect.result(ctx.nested(commands.create, { collection: "news", data: { title: "already-owned" } }));
        if (Result.isSuccess(observed)) return yield* Effect.die(new Error("Expected the known native uniqueness rejection"));
        const failure = observed.failure;
        expect(failure.cause).toBeInstanceOf(PayloadValidationError);
        expect(failure).toMatchObject({ reason: "documentInvalid", cause: { status: 400,
          data: { errors: [{ path: "title", message: "Value must be unique" }] } } });
        return own;
      }) });
      const release = defineCmsCommand({ name: "nativeReleaseAndReacquire", mode: "write", run: Effect.fn(function* (ctx) {
        yield* ctx.nested(commands.update, { collection: "news", id: seeded.id, data: { title: "released" } });
        const replacement = yield* ctx.nested(commands.create, { collection: "news", data: { title: "already-owned" } });
        expect(yield* ctx.nested(commands.count, { collection: "news", where: { title: { equals: "already-owned" } } }))
          .toEqual({ totalDocs: 1 });
        return replacement;
      }) });
      const host = await fixture.run(fixture.openHost([caught, release]));
      expect(await fixture.run(Effect.result(host.run(host.newRequestKey(), caught, null))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      expect(failedBodies).toBe(1);
      expect(await fixture.run(fixture.reader.count({ collection: "news", where: {} }))).toEqual({ totalDocs: 1 });
      const replacement = document(await fixture.run(host.run(host.newRequestKey(), release, null)));
      expect(replacement.id).not.toBe(seeded.id);
      expect(replacement.title).toBe("already-owned");
      expect(document(await fixture.run(fixture.reader.findByID({ collection: "news", id: seeded.id }))).title).toBe("released");
      expect(await fixture.run(fixture.reader.count({ collection: "news", where: {} }))).toEqual({ totalDocs: 2 });
    } finally { await fixture.close(); }
  });
}
