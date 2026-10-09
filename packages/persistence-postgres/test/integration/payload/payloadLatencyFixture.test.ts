import { Data, Effect, Tracer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { runEffect } from "../../support/effectTestRuntime";
import { compilePayloadLatencyCollections, createProtectedPayloadLatencyResource, preparePayloadLatencyHostInput } from "./payloadLatencyFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { sql } from "drizzle-orm";
import { fxControlIndexDefinitions } from "../../../src/database/schema";

class FixtureDriverFailure extends Data.TaggedError("FixtureDriverFailure")<{ readonly code: string }> {}

describe("Payload latency fixture Promise boundary", () => {
  it("preserves a classified driver refusal and an unexpected defect as their original rejections", async () => {
    // Construct the real facade without opening a connection. Only its first
    // driver query is injected; later fixture owners must never be entered.
    const persistence = await createPostgresPersistence({ connectionString: "postgresql://unused@localhost/unused" });
    const compiled = await runEffect(compilePayloadLatencyCollections());
    const query = vi.spyOn(persistence, "query");
    try {
      const expected = new FixtureDriverFailure({ code: "connectionRefused" });
      const defect = new TypeError("unexpected query implementation defect");
      for (const rejection of [expected, defect]) {
        query.mockRejectedValueOnce(rejection);
        await expect(preparePayloadLatencyHostInput(persistence, compiled)).rejects.toBe(rejection);
      }
      expect(query).toHaveBeenCalledTimes(2);
      expect(persistence.pool.totalCount).toBe(0);
    } finally { query.mockRestore(); await persistence.close(); }
  });
});

it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "uses genuine protected Payload runtime roles while retaining readiness and fresh complete requests", async () => {
    const owner = await createFileScopedPostgresFixture();
    let resource: Awaited<ReturnType<typeof createProtectedPayloadLatencyResource>> | undefined;
    try {
      resource = await createProtectedPayloadLatencyResource(owner);
      const active = resource;
      const input = await preparePayloadLatencyHostInput(owner.persistence, active.compiled, active);
      const ownerLogin = (await owner.persistence.query<{ login: string }>("select session_user as login")).rows[0]?.login;
      for (const persistence of [active.persistence, active.control.persistence]) {
        const identity = (await persistence.query<{ login: string; role: string; superuser: boolean; bypass: boolean; createRole: boolean }>(
          `select session_user as login, current_user as role, rolsuper as superuser, rolbypassrls as bypass, rolcreaterole as "createRole"
           from pg_roles where rolname=session_user`)).rows[0];
        expect(identity).toMatchObject({ superuser: false, bypass: false, createRole: false });
        expect(identity?.login).toBe(identity?.role);
        expect(identity?.login).not.toBe(ownerLogin);
        expect(persistence.pool).not.toBe(owner.persistence.pool);
      }
      const epochs = async () => Promise.all([active.persistence, active.control.persistence].map(async persistence =>
        (await persistence.query<{ generation: string }>("select generation::text from fx_system_prepared_metadata_epoch")).rows));
      const before = await epochs();
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span; } });
      const id = (value: Json) => {
        if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Missing native Payload document id");
        return value.id;
      };
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* makePayloadRuntime(active.compiled);
        const host = yield* runtime.bind(input);
        const commandInput = { collection: "news-items", data: { headline: "protected-owner" } };
        const requestKey = host.newRequestKey();
        const created = yield* host.run(requestKey, runtime.commands.create, commandInput);
        expect(created).toMatchObject({ headline: "protected-owner", score: 0 });
        const documentId = id(created);
        const coldValidations = spans.filter(span => span.name === "ApplicationRelationReadinessFold.validatePreparedInTransaction").length;
        expect(coldValidations).toBe(1);
        expect(yield* host.read(runtime.commands.findByID, { collection: "news-items", id: documentId })).toEqual(created);
        expect(yield* host.run(requestKey, runtime.commands.create, commandInput)).toEqual(created);
        expect(yield* host.read(runtime.commands.count, { collection: "news-items" })).toEqual({ totalDocs: 1 });
        expect(yield* host.run(host.newRequestKey(), runtime.commands.update,
          { collection: "news-items", id: documentId, data: { score: 1 } })).toMatchObject({ id: documentId, score: 1 });
        expect(id(yield* host.run(host.newRequestKey(), runtime.commands.delete, { collection: "news-items", id: documentId }))).toBe(documentId);
        expect(yield* host.read(runtime.commands.count, { collection: "news-items" })).toEqual({ totalDocs: 0 });
        expect(spans.filter(span => span.name === "ApplicationRelationReadinessFold.validatePreparedInTransaction")).toHaveLength(coldValidations);
        // A real metadata writer invalidates the original retained generation
        // even with zero affected rows; the next request reconstructs it once.
        yield* Effect.promise(() => active.controlOwner.persistence.drizzle.update(fxControlIndexDefinitions)
          .set({ physicalSpecCodecVersion: sql`${fxControlIndexDefinitions.physicalSpecCodecVersion}` }).where(sql`false`));
        expect(yield* host.read(runtime.commands.count, { collection: "news-items" })).toEqual({ totalDocs: 0 });
        expect(spans.filter(span => span.name === "ApplicationRelationReadinessFold.validatePreparedInTransaction")).toHaveLength(coldValidations + 1);
      })).pipe(Effect.provideService(Tracer.Tracer, tracer)));
      const after = await epochs();
      expect(after[0]).toEqual(before[0]);
      const priorControl = before[1]?.[0]?.generation;
      if (priorControl === undefined) throw new Error("Missing actual control epoch");
      expect(after[1]).toEqual([{ generation: (BigInt(priorControl) + 1n).toString() }]);
    } finally { await resource?.dispose(); await owner.dispose(); }
  }, 240_000);
