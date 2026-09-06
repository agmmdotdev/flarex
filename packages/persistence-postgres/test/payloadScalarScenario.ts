import { UnsupportedPayloadScalarCapability } from "../src/payloadScalar/adapter";
import { expect } from "vitest";
import { Effect } from "effect";
import { ValidationError } from "payload";
import { isJsonObject } from "flarex-protocol/json";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";

import { makePayloadScalarRuntime } from "../src/payloadScalar/runtime";
import { payloadScalarFields, payloadScalarContentIdentity } from "../src/payloadScalar/profile";
import type { RelationalSession } from "../src/relationalTransaction/session";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemOutbox, fxSystemCommitAppRowChanges, fxSystemScopeClocks, fxAppUniqueKeys, fxAppIndexEntryCurrent } from "../src/schema";
import { cmsHostFixture } from "./cmsHostFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export function payloadScalarScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  native?: (context: { runtime: Effect.Success<ReturnType<typeof makePayloadScalarRuntime>>;
    hostInput: Parameters<Effect.Success<ReturnType<typeof makePayloadScalarRuntime>>["bind"]>[0];
    host: Effect.Success<ReturnType<typeof makeCmsHost>>; inventory: () => Promise<unknown> }) => Promise<void>) {
  return runEffect(Effect.scoped(makePayloadScalarRuntime().pipe(Effect.flatMap(runtime => Effect.promise(async () => {
    const { fixture } = await cmsHostFixture(persistence, { cmsFields: payloadScalarFields });
    const hostInput = { database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session,
      deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority,
      application: fixture.relationActivation,
      identityAndAccessPolicy: { profile: "payload.scalar", release: "3.88.0", access: "closed-headless-local-api", hook: "fixed-nested-conformance" },
      materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
        developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle), uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
        candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }) } };
    const host = await runEffect(runtime.bind(hostInput));
    const inventory = async () => ({ rows: await persistence.drizzle.select().from(fxAppRowCurrent), revisions: await persistence.drizzle.select().from(fxAppRowRevisions),
      commits: await persistence.drizzle.select().from(fxSystemCommits), outcomes: await persistence.drizzle.select().from(fxSystemIdempotency),
      wakes: await persistence.drizzle.select().from(fxSystemOutbox), facts: await persistence.drizzle.select().from(fxSystemCommitAppRowChanges),
      clocks: await persistence.drizzle.select().from(fxSystemScopeClocks), unique: await persistence.drizzle.select().from(fxAppUniqueKeys), indexes: await persistence.drizzle.select().from(fxAppIndexEntryCurrent) });
    const initial = await inventory();
    expect(await runEffect(host.read(runtime.commands.find, {}))).toEqual({ docs: [], totalDocs: 0, limit: 10, totalPages: 1,
      page: 1, pagingCounter: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null });
    const key = host.newRequestKey();
    const input = { data: { title: "first", publishedAt: "2026-01-01" } };
    const created = await runEffect(host.run(key, runtime.commands.create, input));
    if (!isJsonObject(created) || typeof created.id !== "string") throw new Error("Expected Payload document");
    expect(created).toMatchObject({ title: "first", score: 0, enabled: false, publishedAt: "2026-01-01T00:00:00.000Z" });
    expect(typeof created.createdAt).toBe("string");
    expect(created).not.toHaveProperty("_id");
    const published = await inventory();
    expect(published.rows).toHaveLength(initial.rows.length + 1);
    for (const name of ["commits", "outcomes", "wakes", "facts"] as const) expect(published[name]).toHaveLength(initial[name].length + 1);
    const expected = { ...payloadScalarContentIdentity };
    const capturedHost = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(runtime.commands), expectedContentIdentity: expected }));
    expected.configSha256 = "0".repeat(64);
    expect(await runEffect(capturedHost.run(key, runtime.commands.create, input))).toEqual(created);
    const mismatched = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(runtime.commands), expectedContentIdentity: expected }));
    expected.configSha256 = payloadScalarContentIdentity.configSha256;
    const beforeMismatch = runtime.executions();
    expect(await runEffectFailure(mismatched.run(key, runtime.commands.create, input))).toMatchObject({ reason: "invalidAuthority" });
    expect(await runEffectFailure(mismatched.read(runtime.commands.find, {}))).toMatchObject({ reason: "invalidAuthority" });
    expect(runtime.executions()).toBe(beforeMismatch);
    expect(await runEffect(host.run(key, runtime.commands.create, input))).toEqual(created);
    expect(await inventory()).toEqual(published);
    expect(await runEffect(host.read(runtime.commands.findByID, { id: created.id }))).toEqual(created);
    expect(await runEffect(host.read(runtime.commands.count, { where: { title: { equals: "first" } } }))).toEqual({ totalDocs: 1 });
    const updated = await runEffect(host.run(host.newRequestKey(), runtime.commands.update, { id: created.id, data: { title: "updated", score: 2, enabled: true } }));
    expect(updated).toMatchObject({ id: created.id, createdAt: created.createdAt, title: "updated", score: 2, enabled: true });
    const stable = await inventory();
    const invalid = await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.create, { data: { publishedAt: "2026-01-01" } }));
    expect(invalid).toMatchObject({ reason: "documentInvalid", cause: { status: 400, data: { errors: [{ path: "title" }] } } });
    expect(invalid.cause).toBeInstanceOf(ValidationError);
    const duplicate = await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.create, { data: { title: "updated", publishedAt: "2026-01-01" } }));
    expect(duplicate.cause).toBeInstanceOf(ValidationError);
    expect(duplicate).toMatchObject({ reason: "documentInvalid", cause: { status: 400, data: { errors: [{ path: "title", message: "Value must be unique" }] } } });
    expect(await inventory()).toEqual(stable);
    await runEffect(host.run(host.newRequestKey(), runtime.commands.create, { data: { title: "nested-ok", publishedAt: "2026-01-01" } }));
    const nested = await inventory();
    expect(nested.rows).toHaveLength(stable.rows.length + 2);
    expect(nested.commits).toHaveLength(stable.commits.length + 1);
    expect(nested.facts).toHaveLength(stable.facts.length + 2);
    for (const title of ["nested-fail", "nested-caught"]) {
      await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.create, { data: { title, publishedAt: "2026-01-01" } }));
      expect(await inventory()).toEqual(nested);
    }
    expect(runtime.hookRuns()).toBe(3);
    const page = await runEffect(host.read(runtime.commands.find, { limit: 1, page: 2 }));
    expect(page).toMatchObject({ totalDocs: 3, totalPages: 3, page: 2, pagingCounter: 2, hasPrevPage: true, hasNextPage: true, prevPage: 1, nextPage: 3 });
    // Regression for the upstream profile gap: real delete reaches mandatory
    // preferences cleanup. Refusal must roll the pending content deletion back.
    const beforeDelete = await inventory();
    const deletion = await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.delete, { id: created.id }));
    expect(deletion.cause).toBeInstanceOf(UnsupportedPayloadScalarCapability);
    expect(deletion.cause).toMatchObject({ capability: "deleteMany:payload-preferences" });
    expect(await inventory()).toEqual(beforeDelete);
    expect(await runEffect(host.read(runtime.commands.findByID, { id: created.id }))).toEqual(updated);
    expect(await runEffect(host.read(runtime.commands.count, {}))).toEqual({ totalDocs: 3 });
    const unpaginated = await runEffect(host.read(runtime.commands.find, { limit: 1, page: 2, pagination: false }));
    expect(unpaginated).toMatchObject({ totalDocs: 1, totalPages: 1, page: 2, pagingCounter: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null });
    const unsupportedQueries = [{ where: { or: [{ title: { equals: "updated" } }] } }, { where: { title: { contains: "updated" } } },
      { where: { score: { equals: 2 } } }, { limit: 33 }, { page: 0 }, { sort: "-id" }, { select: { title: true } }, { depth: 1 }];
    for (const query of unsupportedQueries) await runEffectFailure(host.read(runtime.commands.find, query));
    expect(await inventory()).toEqual(beforeDelete);
    const pending = await runEffect(host.run(host.newRequestKey(), runtime.commands.create, { data: { title: "id-pending", publishedAt: "2026-01-01" } }));
    expect(pending).toMatchObject({ title: "id-pending" });
    const beforeInvalidIds = await inventory();
    for (const title of ["id-foreign", "id-blank", "id-zero", "id-removed"]) {
      await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.create, { data: { title, publishedAt: "2026-01-01" } }));
      expect(await inventory()).toEqual(beforeInvalidIds);
    }
    expect(new Set(runtime.touched())).toEqual(new Set(["posts"]));
    if (native !== undefined) await native({ runtime, hostInput, host, inventory });
    const beforeClose = await inventory();
    // These escaped capabilities execute only after Effect.scoped has destroyed Payload.
    return async () => {
      expect(await runEffectFailure(runtime.bind(hostInput))).toMatchObject({ reason: "closed" });
      expect(await runEffectFailure(host.run(key, runtime.commands.create, input))).toMatchObject({ reason: "closed" });
      expect(await runEffectFailure(host.run(host.newRequestKey(), runtime.commands.create, input))).toMatchObject({ reason: "closed" });
      expect(await runEffectFailure(host.read(runtime.commands.find, {}))).toMatchObject({ reason: "closed" });
      expect(await inventory()).toEqual(beforeClose);
    };
  }))))).then(checkClosed => checkClosed());
}
