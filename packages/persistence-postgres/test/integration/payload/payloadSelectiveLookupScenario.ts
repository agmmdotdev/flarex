import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError, cmsLimits } from "../../../src/frameworks/cmsTransaction/model";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import type { payloadScalarScenario } from "./payloadScalarScenario";

const decodeDocument = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const decodeCoreDocument = Schema.decodeUnknownEffect(Schema.Struct({ _id: Schema.String }));
const decodeBatch = Schema.decodeUnknownEffect(Schema.Number);
const decodeRollback = Schema.decodeUnknownEffect(Schema.Boolean);
const decodeInventory = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }));
const decodePage = Schema.decodeUnknownSync(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String })), totalDocs: Schema.Number }));
const fields = (title: string) => ({ title, score: 0, enabled: false,
  publishedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

/** Real Payload reads plus core transaction-local key movement over a collection
 * larger than the request identity budget. Setup uses the same materializer. */
export const payloadSelectiveLookupScenario: NonNullable<Parameters<typeof payloadScalarScenario>[2]> = async ({ conformance, hostInput, inventory }) => {
  let scans = 0;
  let points = 0;
  let executions = 0;
  const seed = defineCmsCommand({ name: "seedSelectiveLookup", mode: "write", run: Effect.fn(function* (ctx, args) {
    const batch = yield* decodeBatch(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    for (let index = 0; index < 32; index++) yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", fields(`selective-${batch}-${index}`));
    return null;
  }) });
  const move = defineCmsCommand({ name: "moveSelectiveLookup", mode: "write", run: Effect.fn(function* (ctx, args) {
    executions++;
    const rollback = yield* decodeRollback(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    const find = (where: Record<string, string | number>, offset = 0) => ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where, offset, limit: 1 });
    expect((yield* find({ title: "move-first" })).total).toBe(0);
    const inserted = yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", fields("move-first"));
    const first = yield* decodeCoreDocument(inserted).pipe(Effect.mapError(cause => cmsError("documentInvalid", cause)));
    expect((yield* find({ title: "move-first" })).docs).toEqual([inserted]);
    expect((yield* find({ _id: first._id })).docs).toEqual([inserted]);
    expect(yield* find({ title: "move-first" }, 1)).toEqual({ docs: [], total: 1 });
    expect((yield* find({ title: "move-first", score: 1 })).total).toBe(0);
    yield* ctx.documents.patch(ctx.context, ctx.transactionId, first._id, { title: "move-second" });
    expect((yield* find({ title: "move-first" })).total).toBe(0);
    expect((yield* find({ title: "move-second" })).total).toBe(1);
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, first._id);
    expect((yield* find({ _id: first._id })).total).toBe(0);
    expect((yield* find({ title: "move-second" })).total).toBe(0);
    const replacement = yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", fields("move-second"));
    expect((yield* find({ title: "move-second" })).docs).toEqual([replacement]);
    if (rollback) return yield* Effect.fail(cmsError("documentInvalid"));
    return replacement;
  }) });
  const host = await runEffect(makeCmsHost({ ...hostInput, commands: [...Object.values(conformance.runtime.commands), seed, move] }, {
    documentReads: { beforeRead: selection => Effect.sync(() => { if (selection === "scan") scans++; else if (selection === "point") points++; }) },
    afterDocumentClosure: closed => Effect.sync(() => { expect(closed.scans).toEqual([]); }),
  }));
  for (let batch = 0; batch < Math.floor(cmsLimits.identities / 32) + 1; batch++) await runEffect(host.run(host.newRequestKey(), seed, batch));
  expect(decodeInventory(await inventory()).rows.length).toBeGreaterThan(cmsLimits.identities);
  const beforeReads = points;
  const queried = await runEffect(host.read(conformance.runtime.commands.find, { collection: "posts", where: { title: { equals: "selective-0-0" } } }));
  const page = decodePage(queried);
  expect(page.totalDocs).toBe(1);
  const selected = page.docs[0];
  if (selected === undefined) throw new Error("Missing selected Payload row");
  expect(await runEffect(host.read(conformance.runtime.commands.find, { collection: "posts", where: { id: { equals: selected.id } } }))).toEqual(queried);
  expect(await runEffect(host.read(conformance.runtime.commands.count, { collection: "posts", where: { title: { equals: "selective-0-0" } } }))).toEqual({ totalDocs: 1 });
  expect(await runEffect(host.read(conformance.runtime.commands.count, { collection: "posts", where: { title: { equals: "selective-absent" } } }))).toEqual({ totalDocs: 0 });
  expect(points - beforeReads).toBe(3);
  const created = decodeDocument(await runEffect(host.run(host.newRequestKey(), conformance.runtime.commands.create,
    { collection: "posts", data: { title: "selective-native", publishedAt: "2026-01-01" } })));
  expect(await runEffect(host.run(host.newRequestKey(), conformance.runtime.commands.update,
    { collection: "posts", id: created.id, data: { title: "selective-renamed" } }))).toMatchObject({ id: created.id, title: "selective-renamed" });
  const beforeRollback = await inventory();
  expect(await runEffectFailure(host.run(host.newRequestKey(), move, true))).toMatchObject({ reason: "documentInvalid" });
  expect(await inventory()).toEqual(beforeRollback);
  const key = host.newRequestKey();
  const moved = await runEffect(host.run(key, move, false));
  const afterMove = await inventory();
  expect(await runEffect(host.run(key, move, false))).toEqual(moved);
  expect(await inventory()).toEqual(afterMove);
  expect(executions).toBe(2);
  expect(scans).toBe(0);
};
