import { Cause, Deferred, Effect, Exit, Fiber, Result, Tracer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { commerceError, CommerceTransactionError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { createCoreProductFixture, type CoreProductFixture } from "./core-product-fixture";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "../../../flarex/src/server";
import { v } from "../../../flarex/src/values";

function originalFailure(failure: CommerceTransactionError): CommerceTransactionError {
  let selected = failure;
  for (let depth = 0; depth < 4; depth++) {
    if (selected.reason !== "rollbackOnly" && selected.reason !== "adapterFailure") return selected;
    const cause = Cause.isCause(selected.cause) ? Result.getOrThrow(Cause.findError(selected.cause)) : selected.cause;
    if (!(cause instanceof CommerceTransactionError)) return selected;
    selected = cause;
  }
  throw new Error("Unexpected nested Commerce failure");
}
async function failure<A>(work: Effect.Effect<A, CommerceTransactionError>) {
  return originalFailure(await Effect.runPromise(Effect.flip(work)));
}

/** Actual native Product read consumers over the shared Core read lifetime.
 * Metadata mutation/revocation witnesses stay explicit in their owning suite. */
export function registerCoreManagedProductReadScenarios(driver: "pglite" | "postgres"): void {
  describe(`native Product managed reads on Core ${driver}`, () => {
    let fixture: CoreProductFixture;
    beforeAll(async () => { fixture = await createCoreProductFixture(driver); }, 180_000);
    afterAll(async () => { if (fixture !== undefined) await fixture.close(); }, 180_000);
    const create = (id: string, title: string, handle = id.replaceAll("_", "-"), extra: JsonObject = {}) => fixture.run(fixture.host.run(
      fixture.host.newRequestKey(), fixture.runtime.commands.create, { id, title, handle, ...extra }));
    const retrieve = (id: string) => ({ id, config: { select: ["id", "title"] } });

    it("reads committed native Products through the protected managed source", async () => {
      const host = await fixture.run(fixture.openReadHost());
      try {
        expect(await fixture.run(Effect.result(fixture.openReadHost({ initialization: { ...fixture.initialization,
          datasetSha256: `${fixture.initialization.datasetSha256}\n` } }))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
        await create("managed_product", "Managed Product");
        expect(await fixture.run(host.read(fixture.runtime.commands.internalProductRetrieve, retrieve("managed_product"))))
          .toEqual({ id: "managed_product", title: "Managed Product" });
        const list = { filters: { id: "managed_product" }, config: { select: ["id", "title"] } };
        expect(await fixture.run(host.read(fixture.runtime.commands.internalProductList, list)))
          .toEqual([{ id: "managed_product", title: "Managed Product" }]);
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.softDelete, ["managed_product"]));
        expect(await fixture.run(host.read(fixture.runtime.commands.internalProductList, list))).toEqual([]);
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.restore, ["managed_product"]));
        expect(await fixture.run(host.read(fixture.runtime.commands.internalProductList, list)))
          .toEqual([{ id: "managed_product", title: "Managed Product" }]);
      } finally { await fixture.run(host.close); }
    }, 120_000);

    it("preserves ordinary writer progress and native snapshots with one and eight admitted readers", async () => {
      for (const count of [1, 8]) {
        const id = `managed_concurrent_${count}`, title = `Before ${count}`;
        await create(id, title);
        const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
        let arrivals = 0;
        const native = fixture.runtime.commands.internalProductRetrieve;
        const wait = defineCommerceCommand("managedConcurrentSnapshot", "read", (ctx, input) => Effect.gen(function* () {
          const result = yield* ctx.nested(native, input);
          arrivals++;
          if (arrivals === count) yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return result;
        }));
        const host = await fixture.run(fixture.openReadHost({ commands: [native, wait] }));
        const pending = Effect.runFork(Effect.all(Array.from({ length: count }, () => host.read(wait, retrieve(id))), { concurrency: count }));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Concurrent native readers did not enter")) })));
          await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.update, { id, data: { title: `After ${count}` } }));
          await Effect.runPromise(Deferred.succeed(release, undefined));
          expect(await Effect.runPromise(Fiber.join(pending))).toEqual(Array.from({ length: count }, () => ({ id, title })));
          expect(await fixture.run(host.read(native, retrieve(id)))).toEqual({ id, title: `After ${count}` });
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.interrupt(pending));
          await fixture.run(host.close);
        }
      }
    }, 120_000);

    it("rejects a malformed managed relational predicate before executing the query", async () => {
      await create("managed_invalid_query_product", "Invalid Query Product");
      const command = defineCommerceCommand("managedMalformedRelationalRead", "read", (ctx, input) => Effect.gen(function* () {
        const store = yield* ctx.table("product");
        return yield* store.find(ctx.manager, input);
      }));
      const host = await fixture.run(fixture.openReadHost({ commands: [command] }));
      const spans: string[] = [];
      const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
      const query = { fields: ["id"], order: { column: "id", direction: "asc" }, take: 1,
        predicate: { kind: "in", column: "id", values: ["managed_invalid_query_product"] } };
      try {
        const malformed = { ...query, predicate: { ...query.predicate, extra: true } };
        for (const warmed of [false, true]) {
          spans.length = 0;
          expect(await failure(host.read(command, malformed).pipe(Effect.withTracer(tracer)))).toMatchObject({ reason: "invalidInput" });
          expect(spans.filter(name => name === "CoreNativeRelational.read")).toEqual([]);
          if (!warmed) expect(await fixture.run(host.read(command, query).pipe(Effect.withTracer(tracer))))
            .toEqual([{ id: "managed_invalid_query_product" }]);
        }
      } finally { await fixture.run(host.close); }
    }, 120_000);

    it("retains a conditional scalar anchor under a single-identity read profile", async () => {
      await create("managed_anchor_selected", "Selected Anchor", "managed-anchor-selected");
      await create("managed_anchor_background", "Background Anchor", "managed-anchor-background");
      const command = defineCommerceCommand("managedConditionalScalarAnchor", "read", (ctx, input) => Effect.gen(function* () {
        return yield* (yield* ctx.table("product")).prepareRead(input).find(ctx.manager);
      }));
      const host = await fixture.run(fixture.openReadHost({ commands: [command], resources: { ...defaultCommerceResources,
        catalogRows: 1, queryRows: 1, writeBatchRows: 1, facts: 1, eventIds: 1 }, nativeLimits: { maxIdentities: 1, maxDocumentBytes: 65_536 } }));
      try {
        expect(await fixture.run(host.read(command, { fields: ["id", "handle"], order: { column: "id", direction: "asc" }, take: 1,
          predicate: { kind: "and", children: [{ kind: "in", column: "handle", values: ["managed-anchor-selected"] },
            { kind: "isNull", column: "deleted_at" }] } }))).toEqual([{ id: "managed_anchor_selected", handle: "managed-anchor-selected" }]);
      } finally { await fixture.run(host.close); }
    }, 120_000);

    it("reuses a captured managed read program and revokes escaped work before foreign capture", async () => {
      await create("managed_program_product", "Program Product");
      let escaped: Effect.Effect<number, CommerceTransactionError> | undefined;
      let uncaptured: Effect.Effect<readonly JsonObject[], CommerceTransactionError> | undefined;
      let captures = 0;
      const command = defineCommerceCommand("managedOwnedReadProgram", "read", (ctx, input) => Effect.gen(function* () {
        if (!isJsonObject(input) || typeof input.id !== "string") return yield* commerceError("invalidInput");
        const store = yield* ctx.table("product");
        const query = { fields: ["id"], order: { column: "id", direction: "asc" }, take: 1,
          predicate: { kind: "in", column: "id", values: [input.id] } };
        const program = store.prepareRead(query);
        const rows = yield* program.find(ctx.manager);
        query.predicate.values[0] = "changed-after-guarded-capture";
        const total = yield* program.count(ctx.manager);
        escaped = program.count(ctx.manager);
        const foreign = new Proxy({}, { ownKeys(): never { captures++; throw new Error("revoked query capture"); } });
        uncaptured = store.prepareRead(foreign).find(ctx.manager);
        return { rows: [...rows], total };
      }));
      const host = await fixture.run(fixture.openReadHost({ commands: [command] }));
      try {
        expect(await fixture.run(host.read(command, { id: "managed_program_product" })))
          .toEqual({ rows: [{ id: "managed_program_product" }], total: 1 });
        if (escaped === undefined || uncaptured === undefined) throw new Error("Missing escaped native work");
        expect(await failure(escaped)).toMatchObject({ reason: "invalidAuthority" });
        expect(await failure(uncaptured)).toMatchObject({ reason: "invalidAuthority" });
        expect(captures).toBe(0);
      } finally { await fixture.run(host.close); }
    }, 120_000);

    it("preserves native collection projection and missing-record behavior against the writer", async () => {
      await fixture.run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.createCollections,
        { id: "managed_collection", title: "Managed Collection" }));
      await create("managed_related_product", "Related Product", "managed-related", { collection_id: "managed_collection" });
      const native = fixture.runtime.commands.internalProductRetrieve;
      const host = await fixture.run(fixture.openReadHost({ commands: [native] }));
      const config = { select: ["id", "title", "collection.id", "collection.title"], relations: ["collection"] };
      try {
        const input = { id: "managed_related_product", config };
        const baseline = await fixture.run(fixture.host.read(native, input));
        expect(baseline).toEqual({ id: "managed_related_product", title: "Related Product", collection_id: "managed_collection",
          collection: { id: "managed_collection", title: "Managed Collection" } });
        expect(await fixture.run(host.read(native, input))).toEqual(baseline);
        const missing = { id: "managed_missing", config };
        const writerFailure = await failure(fixture.host.read(native, missing)), readerFailure = await failure(host.read(native, missing));
        expect(readerFailure).toMatchObject({ reason: "adapterFailure", cause: { type: "not_found", message: "Product with id: managed_missing was not found" } });
        if (!(writerFailure.cause instanceof MedusaError) || !(readerFailure.cause instanceof MedusaError)) throw new Error("Missing exact native Product failure");
        expect({ type: readerFailure.cause.type, code: readerFailure.cause.code, message: readerFailure.cause.message })
          .toEqual({ type: writerFailure.cause.type, code: writerFailure.cause.code, message: writerFailure.cause.message });
        expect(readerFailure.cause.date).toBeInstanceOf(Date);
      } finally { await fixture.run(host.close); }
    }, 120_000);

    it("cleans a managed native callback after typed failure and interruption", async () => {
      await create("managed_cancel_product", "Cancel Product");
      const native = fixture.runtime.commands.internalProductRetrieve;
      const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
      const deliberate = commerceError("invalidInput", { witness: "native callback failure" });
      const fail = defineCommerceCommand("managedNativeFailure", "read", (ctx, input) => Effect.gen(function* () {
        yield* ctx.nested(native, input);
        return yield* ctx.refuse(deliberate);
      }));
      const wait = defineCommerceCommand("managedNativeWait", "read", (ctx, input) => Effect.gen(function* () {
        const result = yield* ctx.nested(native, input);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return result;
      }));
      const host = await fixture.run(fixture.openReadHost({ commands: [native, fail, wait] }));
      try {
        expect(await failure(host.read(fail, retrieve("managed_cancel_product")))).toBe(deliberate);
        const pending = Effect.runFork(host.read(wait, retrieve("managed_cancel_product")));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Native cancellation callback did not enter")) })));
          await Effect.runPromise(Fiber.interrupt(pending));
          const interrupted = await Effect.runPromise(Fiber.await(pending));
          expect(Exit.isFailure(interrupted)).toBe(true);
          if (Exit.isSuccess(interrupted)) throw new Error("Native callback interruption was lost");
          expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
        } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await Effect.runPromise(Fiber.interrupt(pending)); }
        expect(await fixture.run(host.read(native, retrieve("managed_cancel_product"))))
          .toEqual({ id: "managed_cancel_product", title: "Cancel Product" });
      } finally { await fixture.run(host.close); }
    }, 120_000);

    it("refuses a forged source and confines the managed host to its open read lifetime", async () => {
      expect(await fixture.run(Effect.result(fixture.useGeneration(({ database }) => database.bindNative({ definition: { ...fixture.definition },
        protectedMetadata: true }).pipe(Effect.asVoid))))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedCapability" } });
      expect(await fixture.run(Effect.result(fixture.openReadHost({ commands: [fixture.runtime.commands.internalProductCreate] }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      const native = fixture.runtime.commands.internalProductRetrieve;
      const host = await fixture.run(fixture.openReadHost({ commands: [native] }));
      expect(Object.keys(host).sort()).toEqual(["close", "read"]);
      expect(await failure(host.read(fixture.runtime.commands.internalProductCreate, { id: "refused_product", title: "Refused" })))
        .toMatchObject({ reason: "invalidAuthority" });
      await fixture.run(host.close);
      expect(await failure(host.read(native, retrieve("managed_program_product")))).toMatchObject({ reason: "closed" });
    }, 120_000);

    it("withholds a native result after grant invalidation and reconstructs an explicitly fresh reader", async () => {
      const isolated = await createCoreProductFixture(driver);
      try {
        const native = isolated.runtime.commands.internalProductRetrieve;
        await isolated.run(isolated.host.run(isolated.host.newRequestKey(), isolated.runtime.commands.create,
          { id: "managed_withheld_product", title: "Withheld Product", handle: "managed-withheld" }));
        const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
        let entries = 0;
        const wait = defineCommerceCommand("managedNativeGrantBarrier", "read", (ctx, input) => Effect.gen(function* () {
          entries++;
          const result = yield* ctx.nested(native, input);
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return result;
        }));
        const host = await isolated.run(isolated.openReadHost({ commands: [native, wait] }));
        const args = retrieve("managed_withheld_product");
        const pending = Effect.runFork(host.read(wait, args));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Native grant callback did not enter")) })));
          await isolated.run(isolated.useGeneration(({ database }) => Effect.gen(function* () {
            yield* database.advanceAuthorityEpoch((yield* database.readAuthorityEpoch) + 1n);
          })));
          await Effect.runPromise(Deferred.succeed(release, undefined));
          const completed = await Effect.runPromise(Fiber.await(pending));
          expect(Exit.isFailure(completed)).toBe(true);
          if (Exit.isSuccess(completed)) throw new Error("Revoked native result escaped completion");
          expect(originalFailure(Result.getOrThrow(Cause.findError(completed.cause)))).toMatchObject({ reason: "bindingChanged" });
          expect(await failure(host.read(wait, args))).toMatchObject({ reason: "bindingChanged" });
          expect(entries).toBe(1);
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.interrupt(pending));
          await isolated.run(host.close);
        }
        const reconstructed = await isolated.run(isolated.openReadHost({ commands: [native] }));
        try { expect(await isolated.run(reconstructed.read(native, args))).toEqual({ id: "managed_withheld_product", title: "Withheld Product" }); }
        finally { await isolated.run(reconstructed.close); }
      } finally { await isolated.close(); }
    }, 120_000);

    it("refuses a fresh authorization revocation on a warmed native reader", async () => {
      const isolated = await createCoreProductFixture(driver);
      try {
        await isolated.run(isolated.host.run(isolated.host.newRequestKey(), isolated.runtime.commands.create,
          { id: "managed_revoked_product", title: "Revoked Product", handle: "managed-revoked" }));
        const native = isolated.runtime.commands.internalProductRetrieve;
        const host = await isolated.run(isolated.openReadHost({ commands: [native] }));
        try {
          expect(await isolated.run(host.read(native, retrieve("managed_revoked_product")))).toEqual({ id: "managed_revoked_product", title: "Revoked Product" });
          await isolated.run(isolated.useGeneration(({ database }) => Effect.gen(function* () {
            yield* database.advanceAuthorityEpoch((yield* database.readAuthorityEpoch) + 1n);
          })));
          expect(await failure(host.read(native, retrieve("managed_revoked_product")))).toMatchObject({ reason: "bindingChanged" });
        } finally { await isolated.run(host.close); }
      } finally { await isolated.close(); }
    }, 120_000);

    it("preserves an in-flight native result across an unconsumed Application program head change", async () => {
      const application = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ audits: defineTable({ label: v.string() }) })));
      // This program is deliberately unconsumed: Core stores its trusted test
      // metadata, while the actual callback under proof is the native Product service.
      const initial = { identity: { functionPath: "audit:unused", programHash: "before", schemaHash: application.source.sourceSha256 },
        metadata: { purpose: "unconsumed-audit-head" } };
      const isolated = await createCoreProductFixture(driver, { sources: [{ kind: "application", definition: application }], programs: [initial] });
      try {
        await isolated.run(isolated.host.run(isolated.host.newRequestKey(), isolated.runtime.commands.create,
          { id: "managed_unrelated_head", title: "Unrelated Head", handle: "managed-unrelated-head" }));
        const native = isolated.runtime.commands.internalProductRetrieve;
        const entered = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
        const wait = defineCommerceCommand("managedUnrelatedHeadBarrier", "read", (ctx, input) => Effect.gen(function* () {
          const result = yield* ctx.nested(native, input);
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return result;
        }));
        const host = await isolated.run(isolated.openReadHost({ commands: [native, wait] }));
        const args = retrieve("managed_unrelated_head"), pending = Effect.runFork(host.read(wait, args));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Unrelated head callback did not enter")) })));
          await isolated.run(isolated.useGeneration(({ database }) => Effect.gen(function* () {
            const proposal = yield* database.prepareSchema({ bundle: isolated.bundle });
            const next = { ...initial, identity: { ...initial.identity, programHash: "after" } };
            yield* database.activateSchema(proposal, { bundle: isolated.bundle, programs: [next] });
            expect((yield* database.selectProgram("audit:unused")).identity.programHash).toBe("after");
          })));
          await Effect.runPromise(Deferred.succeed(release, undefined));
          expect(await Effect.runPromise(Fiber.join(pending))).toEqual({ id: "managed_unrelated_head", title: "Unrelated Head" });
          expect(await isolated.run(host.read(native, args))).toEqual({ id: "managed_unrelated_head", title: "Unrelated Head" });
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.interrupt(pending));
          await isolated.run(host.close);
        }
      } finally { await isolated.close(); }
    }, 120_000);
  });
}
