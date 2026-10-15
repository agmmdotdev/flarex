import { Cause, Deferred, Effect, Exit, Fiber, Result, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeCommerceReadHost, type CommerceReadHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/read/host";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { commerceError, CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { prepareLogicalReadIndexReadinessWitness, prepareLogicalReadDemandReadinessWitness } from "../../persistence-postgres/test/storage/documents/logicalReadIndexReadinessTestSupport";
import { makeManagedReadMetadataMutationWitness } from "../../persistence-postgres/test/storage/documents/managedReadMetadataMutationTestSupport";
import { logicalManagedReadDemandScenario } from "../../persistence-postgres/test/storage/documents/logicalManagedReadDemandScenario";
import { getCoLocatedReadInstallationReferences } from "../../persistence-postgres/src/installation/installationLifecycle";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner } from "./support/logical-product-runner";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

describe.skipIf(process.env.FLAREX_TEST_DRIVER !== "postgres" || postgresUrl === null ||
  !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("native Product managed reads", () => {
  productIntegrationTestRunner({ moduleName: "product", testSuite: ({ service }) => {
    it("reads committed native Products through the protected managed source", async () => {
      const fixture = getLogicalProductRunnerFixture();
      const input = fixture.product.managedReadHostInput;
      if (input === undefined || fixture.currency.managedRead === undefined)
        throw new Error("Missing managed Product fixture");
      expect(input.installation).toBe(fixture.currency.managedRead.readInstallation);
      expect(input.logicalStorage.source).toEqual(fixture.currency.sourcePins.find(pin => pin.sourceKey === "medusa.product"));
      expect(await runEffectFailure(makeCommerceReadHost({ ...input, logicalStorage: {
        ...input.logicalStorage, initialization: { ...input.logicalStorage.initialization,
          contractSha256: `${input.logicalStorage.initialization.contractSha256}\n` },
      } }))).toMatchObject({ reason: "invalidInput" });

      const product = await service.createProducts({ id: "managed_product", title: "Managed Product", handle: "managed-product" });
      expect(await service.retrieveProduct(product.id, { select: ["id", "title", "handle"] }))
        .toMatchObject({ id: product.id, title: "Managed Product", handle: "managed-product" });
      expect(await service.listProducts({ id: product.id }, { select: ["id", "title"] }))
        .toEqual([{ id: product.id, title: "Managed Product" }]);
      await service.softDeleteProducts([product.id]);
      expect(await service.listProducts({ id: product.id }, { select: ["id"] })).toEqual([]);
      await service.restoreProducts([product.id]);
      expect(await service.listProducts({ id: product.id }, { select: ["id"] }))
        .toEqual([{ id: product.id }]);
    }, 120_000);

    it("preserves ordinary writer progress and native snapshots with one and eight admitted readers", async () => {
      const { product } = getLogicalProductRunnerFixture();
      const input = product.managedReadHostInput;
      if (input === undefined) throw new Error("Missing managed Product input");
      for (const count of [1, 8]) {
        const id = `managed_concurrent_${count}`;
        const title = `Before ${count}`;
        await service.createProducts({ id, title, handle: `managed-concurrent-${count}` });
        const entered = await Effect.runPromise(Deferred.make<void>());
        const release = await Effect.runPromise(Deferred.make<void>());
        let arrivals = 0;
        const native = product.runtime.commands.internalProductRetrieve;
        const wait = defineCommerceCommand("managedConcurrentSnapshot", "read", (ctx, value) => Effect.gen(function* () {
          const result = yield* ctx.nested(native, value);
          yield* Effect.sync(() => { arrivals++; });
          if (arrivals === count) yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return result;
        }));
        const host = await Effect.runPromise(makeCommerceReadHost({ ...input, commands: [...input.commands, wait] }));
        const args = { id, config: { select: ["id", "title"] } };
        const pending = Effect.runFork(Effect.all(Array.from({ length: count }, () => host.read(wait, args)),
          { concurrency: count }));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Concurrent native readers did not enter")) })));
          // The public native write must commit while every read remains open.
          // Each admitted reader retains its original repeatable-read snapshot.
          await service.updateProducts(id, { title: `After ${count}` });
          await Effect.runPromise(Deferred.succeed(release, undefined));
          expect(await Effect.runPromise(Fiber.join(pending)))
            .toEqual(Array.from({ length: count }, () => ({ id, title })));
          expect(await Effect.runPromise(host.read(native, args))).toEqual({ id, title: `After ${count}` });
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.interrupt(pending));
          await Effect.runPromise(host.close);
        }
      }
    }, 120_000);

    it("rejects a malformed managed relational predicate before acquiring query facts", async () => {
      const { product } = getLogicalProductRunnerFixture();
      const input = product.managedReadHostInput;
      if (input === undefined) throw new Error("Missing managed Product input");
      const created = await service.createProducts({ id: "managed_invalid_query_product",
        title: "Invalid Query Product", handle: "managed-invalid-query" });
      const command = defineCommerceCommand("managedMalformedRelationalRead", "read", (ctx, value) => Effect.gen(function* () {
        const store = yield* ctx.table("product");
        return yield* store.find(ctx.manager, value);
      }));
      const host = await Effect.runPromise(makeCommerceReadHost({ ...input, commands: [...input.commands, command] }));
      const malformed = { fields: ["id"], order: { column: "id", direction: "asc" }, take: 1,
        predicate: { kind: "in", column: "id", values: [created.id], extra: true } };
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({ span(options) {
        const span = new Tracer.NativeSpan(options); spans.push(span); return span;
      } });
      try {
        expect(await readinessFailure(host.read(command, malformed).pipe(Effect.withTracer(tracer)),
          "cold malformed relational predicate")).toMatchObject({ reason: "invalidInput" });
        expect(spans.filter(span => span.name === "LogicalReadMetadata.queryAccess")).toEqual([]);
        spans.length = 0;
        expect(await Effect.runPromise(host.read(command, { fields: ["id"],
          order: { column: "id", direction: "asc" }, take: 1,
          predicate: { kind: "in", column: "id", values: [created.id] } }).pipe(Effect.withTracer(tracer))))
          .toEqual([{ id: created.id }]);
        expect(spans.some(span => span.name === "LogicalReadMetadata.queryAccess")).toBe(true);
        spans.length = 0;
        expect(await readinessFailure(host.read(command, malformed).pipe(Effect.withTracer(tracer)),
          "warm malformed relational predicate")).toMatchObject({ reason: "invalidInput" });
        expect(spans.filter(span => span.name === "LogicalReadMetadata.queryAccess")).toEqual([]);
      } finally { await Effect.runPromise(host.close); }
    }, 120_000);

    it("retains a conditional scalar anchor through compact managed metadata under a single-identity read profile", async () => {
      const { product } = getLogicalProductRunnerFixture();
      const input = product.managedReadHostInput;
      if (input === undefined) throw new Error("Missing managed Product input");
      const chosen = await service.createProducts({ id: "managed_anchor_selected", title: "Selected Anchor",
        handle: "managed-anchor-selected" });
      await service.createProducts({ id: "managed_anchor_background", title: "Background Anchor",
        handle: "managed-anchor-background" });
      const command = defineCommerceCommand("managedConditionalScalarAnchor", "read", (ctx, value) => Effect.gen(function* () {
        const store = yield* ctx.table("product");
        return yield* store.prepareRead(value).find(ctx.manager);
      }));
      // This trusted reader grants one identity. The declared handle anchor
      // must survive compact metadata selection instead of reading all active
      // Products and applying take after their identities have been hydrated.
      const host = await Effect.runPromise(makeCommerceReadHost({ ...input, commands: [command],
        logicalResources: { ...defaultCommerceResources, catalogRows: 1, queryRows: 1,
          writeBatchRows: 1, facts: 1, eventIds: 1 },
      }));
      const spans: string[] = [];
      const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
      try {
        expect(await Effect.runPromise(host.read(command, { fields: ["id", "handle"],
          order: { column: "id", direction: "asc" }, take: 1,
          predicate: { kind: "and", children: [
            { kind: "in", column: "handle", values: [chosen.handle] },
            { kind: "isNull", column: "deleted_at" },
          ] },
        }).pipe(Effect.withTracer(tracer)))).toEqual([{ id: chosen.id, handle: chosen.handle }]);
        expect(spans).toContain("LogicalReadMetadata.queryAccess");
        expect(spans).toContain("LogicalReadMetadata.selectIndex");
      } finally { await Effect.runPromise(host.close); }
    }, 120_000);

    it("reuses a genuinely managed read program while consuming metadata per operation and revoking escaped work", async () => {
      const { product } = getLogicalProductRunnerFixture();
      const input = product.managedReadHostInput;
      if (input === undefined) throw new Error("Missing managed Product input");
      const created = await service.createProducts({ id: "managed_program_product", title: "Program Product", handle: "managed-program-product" });
      let escaped: Effect.Effect<number, CommerceTransactionError> | undefined;
      let uncaptured: Effect.Effect<readonly JsonObject[], CommerceTransactionError> | undefined;
      let captures = 0;
      const command = defineCommerceCommand("managedOwnedReadProgram", "read", (ctx, value) => Effect.gen(function* () {
        if (!isJsonObject(value) || typeof value.id !== "string") return yield* Effect.fail(commerceError("invalidInput"));
        const store = yield* ctx.table("product");
        const query = { fields: ["id"], order: { column: "id", direction: "asc" }, take: 1,
          predicate: { kind: "in", column: "id", values: [value.id] } };
        const program = store.prepareRead(query);
        const rows = yield* program.find(ctx.manager);
        query.predicate.values[0] = "changed-after-guarded-capture";
        const total = yield* program.count(ctx.manager);
        escaped = program.count(ctx.manager);
        const foreign = new Proxy({}, { ownKeys(): never { captures++; throw new Error("revoked query capture"); } });
        uncaptured = store.prepareRead(foreign).find(ctx.manager);
        return { rows: [...rows], total };
      }));
      const host = await Effect.runPromise(makeCommerceReadHost({ ...input, commands: [...input.commands, command] }));
      const spans: string[] = [];
      const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
      try {
        expect(await Effect.runPromise(host.read(command, { id: created.id }).pipe(Effect.withTracer(tracer))))
          .toEqual({ rows: [{ id: created.id }], total: 1 });
        expect(spans.filter(name => name === "LogicalReadMetadata.queryAccess")).toHaveLength(2);
        if (escaped === undefined || uncaptured === undefined) throw new Error("Missing escaped genuine program work");
        // Request disposal removes the original context identity before its
        // phase check. Re-entry must refuse before metadata or foreign capture.
        expect(await runEffectFailure(escaped.pipe(Effect.withTracer(tracer)))).toMatchObject({ reason: "invalidAuthority" });
        expect(await runEffectFailure(uncaptured.pipe(Effect.withTracer(tracer)))).toMatchObject({ reason: "invalidAuthority" });
        expect(captures).toBe(0);
        expect(spans.filter(name => name === "LogicalReadMetadata.queryAccess")).toHaveLength(2);
      } finally { await Effect.runPromise(host.close); }
    }, 120_000);

    it("preserves native collection projection and missing-record behavior against fullProof", async () => {
      const { product, reader } = getLogicalProductRunnerFixture();
      const collection = await service.createProductCollections({ id: "managed_collection", title: "Managed Collection" });
      const created = await service.createProducts({ id: "managed_related_product", title: "Related Product",
        handle: "managed-related-product", collection_id: collection.id });
      const command = product.runtime.commands.internalProductRetrieve;
      const config = { select: ["id", "title", "collection.id", "collection.title"], relations: ["collection"] };
      const input = { id: created.id, config };
      const baseline = await Effect.runPromise(product.host.read(command, input));
      expect(baseline).toEqual({ id: created.id, title: "Related Product", collection_id: collection.id,
        collection: { id: collection.id, title: "Managed Collection" } });
      expect(await Effect.runPromise(reader.read(command, input))).toEqual(baseline);

      const missing = { id: "managed_missing", config };
      const fullFailure = originalCommerceFailure(await runEffectFailure(product.host.read(command, missing)));
      const managedFailure = originalCommerceFailure(await runEffectFailure(reader.read(command, missing)));
      const expected = { reason: "adapterFailure", cause: { type: "not_found",
        message: "Product with id: managed_missing was not found" } };
      expect(fullFailure).toMatchObject(expected);
      expect(managedFailure).toMatchObject(expected);
      expect(managedFailure.reason).toBe(fullFailure.reason);
      if (!(fullFailure.cause instanceof MedusaError) || !(managedFailure.cause instanceof MedusaError))
        throw new Error("Missing exact native Product failure");
      expect({ type: managedFailure.cause.type, code: managedFailure.cause.code, message: managedFailure.cause.message })
        .toEqual({ type: fullFailure.cause.type, code: fullFailure.cause.code, message: fullFailure.cause.message });
      for (const cause of [fullFailure.cause, managedFailure.cause]) {
        expect(cause.date).toBeInstanceOf(Date);
        expect(Number.isFinite(cause.date.getTime())).toBe(true);
      }
    }, 120_000);

    it("checks the selected collection index freshly while an unrelated status index is unavailable", async () => {
      const { product, reader, currency } = getLogicalProductRunnerFixture();
      const collection = await service.createProductCollections({ id: "managed_index_collection", title: "Indexed Collection" });
      const created = await service.createProducts({ id: "managed_index_product", title: "Indexed Product",
        handle: "managed-index-product", collection_id: collection.id });
      const selectedIndex = (field: "collection_id" | "status") => prepareLogicalReadIndexReadinessWitness({
        controlDb: currency.control.drizzle, targetDb: currency.testOwner.drizzle,
        deploymentId: currency.deploymentId, schemaVersionId: currency.schemaVersionId,
        scopeId: currency.application.authority.scopeId, sourceKey: "medusa.product", localName: "product", field,
      });
      const managedInput = product.managedReadHostInput;
      const managed = currency.managedRead;
      if (managedInput === undefined || managed === undefined) throw new Error("Missing managed Product input");
      const required = await prepareLogicalReadDemandReadinessWitness({
        controlDb: managed.control.drizzle, targetDb: currency.testOwner.drizzle,
        installation: managed.controlInstallation, deploymentId: currency.deploymentId,
        schemaVersionId: currency.schemaVersionId, scopeId: currency.application.authority.scopeId,
        source: managedInput.logicalStorage.source, localName: "product",
        equality: { column: "collection_id", value: collection.id },
      });
      const unrelated = await selectedIndex("status");
      expect(required.indexDefinitionId).not.toBe(unrelated.indexDefinitionId);
      const command = product.runtime.commands.internalProductList;
      const input = { filters: { collection_id: collection.id }, config: { select: ["id", "title"] } };
      const references = await Effect.runPromise(getCoLocatedReadInstallationReferences(managedInput.installation,
        managedInput.database));
      const located = await Effect.runPromise(resolveLocatedTrustedScopeAuthorityByIdEffect({
        deploymentId: currency.deploymentId, scopeId: currency.application.authority.scopeId,
      }, currency.application.authorityPorts));
      await Effect.runPromise(logicalManagedReadDemandScenario({
        controlDb: managedInput.database, controlInstallation: references.controlInstallation,
        targetDb: currency.persistence.drizzle, ownerDb: currency.testOwner.drizzle, deploymentId: currency.deploymentId,
        scopeId: located.authority.scopeId, schemaVersionId: currency.schemaVersionId,
        authority: located.authority, source: managedInput.logicalStorage.source,
        tableName: "product", otherTableName: "product_collection", where: { collection_id: collection.id },
      }));
      const baseline = await Effect.runPromise(product.host.read(command, input));
      expect(baseline).toEqual([{ id: created.id, title: "Indexed Product" }]);
      expect(await Effect.runPromise(reader.read(command, input))).toEqual(baseline);
      try {
        await unrelated.retire();
        expect(await Effect.runPromise(reader.read(command, input))).toEqual(baseline);
        expect(await readinessFailure(product.host.read(command, input), "fullProof unrelated index"))
          .toMatchObject({ reason: "invalidAuthority", cause: { reason: "logicalSchemaNotReady",
            cause: { status: "not_ready", reason: "notEnabled", indexDefinitionId: unrelated.indexDefinitionId, lifecycle: "retiring" } } });
      } finally { await unrelated.restore(); }
      try {
        await required.retire();
        expect(await readinessFailure(reader.read(command, input), "managed required index"))
          .toMatchObject({ reason: "bindingChanged", cause: { reason: "notReady",
            cause: { status: "not_ready", kind: "index", reason: "notEnabled",
              indexDefinitionId: required.indexDefinitionId, lifecycle: "retiring" } } });
      } finally { await required.restore(); }
      expect(await Effect.runPromise(reader.read(command, input))).toEqual(baseline);
    }, 120_000);

    it("withholds a native result after callback metadata invalidation and reconstructs the original owner", async () => {
      const isolated = await makeIsolatedManagedProductFixture();
      try {
      const { product, currency, create } = isolated;
      const input = product.managedReadHostInput;
      if (input === undefined || currency.resource.kind !== "postgres") throw new Error("Missing managed Product input");
      const created = await create({ id: "managed_withheld_product", title: "Withheld Product", handle: "managed-withheld" });
      const native = product.runtime.commands.internalProductRetrieve;
      const args = { id: created.id, config: { select: ["id", "title"] } };
      const expected = { id: created.id, title: "Withheld Product" };
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      let callbackEntries = 0;
      const command = defineCommerceCommand("managedNativeBarrier", "read", Effect.fn("ManagedNativeTest.barrier")(function* (ctx, value) {
        callbackEntries++;
        const result = yield* ctx.nested(native, value);
        expect(result).toEqual(expected);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return result;
      }));
      const writer = await makeManagedReadMetadataMutationWitness(currency.resource.target, currency.application.authority.scopeId);
      try {
        const host = await Effect.runPromise(makeCommerceReadHost({ ...input, commands: [...input.commands, command] }));
        const pending = Effect.runFork(host.read(command, args));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Native Product callback did not enter")) })));
          await writer.invalidateCandidate();
          await Effect.runPromise(Deferred.succeed(release, undefined));
          const outcome = await Effect.runPromise(Fiber.await(pending));
          expect(Exit.isFailure(outcome)).toBe(true);
          if (Exit.isSuccess(outcome)) throw new Error("Invalidated native DTO escaped final guard");
          expect(originalCommerceFailure(Result.getOrThrow(Cause.findError(outcome.cause))))
            .toMatchObject({ reason: "invalidAuthority", cause: { reason: "invalidAuthority",
              cause: { reason: "resourceFailure", cause: { cause: { code: "40001" } } } } });
          const spans: string[] = [];
          const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
          let observed: CommerceTransactionError | undefined;
          const refused = await readinessFailure(host.read(command, args).pipe(Effect.withTracer(tracer),
            Effect.tapError(failure => Effect.sync(() => { observed = failure; }))), "original metadata snapshot");
          // Re-entry authenticates the original preparation epoch before the
          // callback or query metadata. Commerce retains that owner's wrapper;
          // the successful callback above still has its distinct final barrier.
          expect(refused).toBe(observed);
          expect(refused).toMatchObject({ reason: "resourceFailure", cause: {
            _tag: "ApplicationActivationError", operation: "validateSelection", reason: "resourceFailure", retryable: false,
            cause: { _tag: "PreparedMetadataEpochError", reason: "changed" },
          } });
          expect(callbackEntries).toBe(1);
          expect(spans.filter(name => name === "CommerceReadHost.invoke" || name === "LogicalReadMetadata.queryAccess"))
            .toEqual([]);
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.interrupt(pending));
          await Effect.runPromise(host.close);
        }
        const refreshed = await Effect.runPromise(makeCommerceReadHost(input));
        try {
          expect(await Effect.runPromise(refreshed.read(native, args))).toEqual(expected);
          await writer.touchActiveHead();
          expect(await readinessFailure(refreshed.read(native, args), "warmed head snapshot"))
            .toMatchObject({ reason: "resourceFailure", cause: {
              _tag: "ApplicationActivationError", operation: "validateSelection", reason: "resourceFailure", retryable: false,
              cause: { _tag: "PreparedMetadataEpochError", reason: "changed" },
            } });
        } finally { await Effect.runPromise(refreshed.close); }
        const reconstructed = await Effect.runPromise(makeCommerceReadHost(input));
        try { expect(await Effect.runPromise(reconstructed.read(native, args))).toEqual(expected); }
        finally { await Effect.runPromise(reconstructed.close); }
      } finally { await writer.close(); }
      } finally { await isolated.close(); }
    }, 120_000);

    it("cleans a managed native callback after typed failure and interruption", async () => {
      const isolated = await makeIsolatedManagedProductFixture();
      try {
      const { product, create } = isolated;
      const input = product.managedReadHostInput;
      if (input === undefined) throw new Error("Missing managed Product input");
      const created = await create({ id: "managed_cancel_product", title: "Cancel Product", handle: "managed-cancel" });
      const native = product.runtime.commands.internalProductRetrieve;
      const args = { id: created.id, config: { select: ["id", "title"] } };
      const expected = { id: created.id, title: "Cancel Product" };
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const deliberate = commerceError("invalidInput", { witness: "native callback failure" });
      const fail = defineCommerceCommand("managedNativeFailure", "read", Effect.fn("ManagedNativeTest.failure")(function* (ctx, value) {
        expect(yield* ctx.nested(native, value)).toEqual(expected);
        return yield* ctx.refuse(deliberate);
      }));
      const wait = defineCommerceCommand("managedNativeWait", "read", Effect.fn("ManagedNativeTest.wait")(function* (ctx, value) {
        const result = yield* ctx.nested(native, value);
        expect(result).toEqual(expected);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return result;
      }));
      const host = await Effect.runPromise(makeCommerceReadHost({ ...input, commands: [...input.commands, fail, wait] }));
      try {
        expect(await readinessFailure(host.read(fail, args), "typed callback failure")).toBe(deliberate);
        expect(await Effect.runPromise(host.read(native, args))).toEqual(expected);
        const pending = Effect.runFork(host.read(wait, args));
        try {
          await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeoutOrElse({ duration: 10_000,
            orElse: () => Effect.die(new Error("Native cancellation callback did not enter")) })));
          await Effect.runPromise(Fiber.interrupt(pending));
          const interrupted = await Effect.runPromise(Fiber.await(pending));
          expect(Exit.isFailure(interrupted)).toBe(true);
          if (Exit.isSuccess(interrupted)) throw new Error("Native callback interruption was lost");
          expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
        } finally {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.interrupt(pending));
        }
        expect(await Effect.runPromise(host.read(native, args))).toEqual(expected);
      } finally { await Effect.runPromise(host.close); }
      const reconstructed = await Effect.runPromise(makeCommerceReadHost(input));
      try { expect(await Effect.runPromise(reconstructed.read(native, args))).toEqual(expected); }
      finally { await Effect.runPromise(reconstructed.close); }
      } finally { await isolated.close(); }
    }, 120_000);

    it("refuses a fresh authorization revocation on the warmed native reader", async () => {
      const isolated = await makeIsolatedManagedProductFixture();
      try {
      const { product, reader, currency, create } = isolated;
      if (currency.resource.kind !== "postgres") throw new Error("Missing PostgreSQL metadata owner");
      const created = await create({ id: "managed_revoked_product", title: "Revoked Product", handle: "managed-revoked" });
      const native = product.runtime.commands.internalProductRetrieve;
      const args = { id: created.id, config: { select: ["id", "title"] } };
      expect(await Effect.runPromise(reader.read(native, args))).toEqual({ id: created.id, title: "Revoked Product" });
      const writer = await makeManagedReadMetadataMutationWitness(currency.resource.target, currency.application.authority.scopeId);
      try {
        await writer.advanceAuthorization();
        expect(await readinessFailure(reader.read(native, args), "fresh authorization revocation"))
          .toMatchObject({ reason: "invalidAuthority", cause: { reason: "staleApplication" } });
      } finally { await writer.close(); }
      } finally { await isolated.close(); }
    }, 120_000);

    it("refuses an actual new Application head on the warmed native reader", async () => {
      const isolated = await makeIsolatedManagedProductFixture();
      try {
      const { product, reader, currency, create } = isolated;
      const created = await create({ id: "managed_moved_head_product", title: "Moved Head Product", handle: "managed-moved-head" });
      const native = product.runtime.commands.internalProductRetrieve;
      const args = { id: created.id, config: { select: ["id", "title"] } };
      expect(await Effect.runPromise(reader.read(native, args))).toEqual({ id: created.id, title: "Moved Head Product" });
      const next = await currency.application.moveHead();
      expect(next.expectedActiveHead).not.toEqual(currency.application.active.expectedActiveHead);
      const spans: string[] = [];
      const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
      let observed: CommerceTransactionError | undefined;
      const refused = await readinessFailure(reader.read(native, args).pipe(Effect.withTracer(tracer),
        Effect.tapError(failure => Effect.sync(() => { observed = failure; }))), "actual Application head transition");
      // The real publication changes the protected epoch. Original generation
      // authentication therefore refuses before the later head comparison.
      expect(refused).toBe(observed);
      expect(refused).toMatchObject({ reason: "resourceFailure", cause: {
        _tag: "ApplicationActivationError", operation: "validateSelection", reason: "resourceFailure", retryable: false,
        cause: { _tag: "PreparedMetadataEpochError", reason: "changed" },
      } });
      expect(spans.filter(name => name === "CommerceReadHost.invoke" || name === "LogicalReadMetadata.queryAccess"))
        .toEqual([]);
      } finally { await isolated.close(); }
    }, 120_000);

    it("refuses a changed source pin and releases its managed host lifetime", async () => {
      const { product } = getLogicalProductRunnerFixture();
      const input = product.managedReadHostInput;
      if (input === undefined) throw new Error("Missing managed Product fixture");
      await expect(Effect.runPromise(makeCommerceReadHost({ ...input,
        logicalStorage: { ...input.logicalStorage,
          source: { ...input.logicalStorage.source, sourceSha256: "0".repeat(64) } } })))
        .rejects.toMatchObject({ reason: "bindingChanged" });
      const reader = await Effect.runPromise(makeCommerceReadHost(input));
      try {
        const capabilities = { read: true, close: true } satisfies Record<keyof CommerceReadHost, true>;
        expect(Object.keys(reader).sort()).toEqual(Object.keys(capabilities).sort());
        await expect(Effect.runPromise(reader.read(product.runtime.commands.internalProductCreate,
          { id: "refused_product", title: "Refused", handle: "refused-product" })))
          .rejects.toMatchObject({ reason: "invalidAuthority" });
        expect(await Effect.runPromise(reader.read(product.runtime.commands.internalProductList,
          { filters: {}, config: { select: ["id"] } }))).toEqual([]);
      } finally { await Effect.runPromise(reader.close); }
      await expect(Effect.runPromise(reader.read(product.runtime.commands.internalProductList,
        { filters: {}, config: { select: ["id"] } })))
        .rejects.toMatchObject({ reason: "closed" });
    }, 120_000);
  } }, { managedRead: true });
});

/** Follow only the existing typed transaction wrappers; preserve the terminal
 * native error or exact readiness failure and refuse an unexpected Cause. */
function originalCommerceFailure(failure: CommerceTransactionError): CommerceTransactionError {
  let current = failure;
  for (let depth = 0; depth < 4; depth++) {
    if (current.reason !== "rollbackOnly" && current.reason !== "adapterFailure") return current;
    const underlying = Cause.isCause(current.cause) ? Result.getOrThrow(Cause.findError(current.cause)) : current.cause;
    if (!(underlying instanceof CommerceTransactionError)) return current;
    current = underlying;
  }
  throw new Error("Unexpected nested Commerce failure");
}

async function readinessFailure(effect: Effect.Effect<unknown, CommerceTransactionError>, witness: string) {
  const outcome = await Effect.runPromise(Effect.exit(effect));
  expect(Exit.isFailure(outcome), `${witness} must refuse the read`).toBe(true);
  if (Exit.isSuccess(outcome)) throw new Error(`${witness} unexpectedly returned ${JSON.stringify(outcome.value)}`);
  return originalCommerceFailure(Result.getOrThrow(Cause.findError(outcome.cause)));
}

/** Destructive authority transitions own a separate disposable fixture so the
 * shared native service runner never resets or rebases stale preparations. */
async function makeIsolatedManagedProductFixture() {
  const cleanup: Array<() => Promise<void>> = [];
  const close = async () => {
    const failures: unknown[] = [];
    for (const dispose of cleanup.splice(0).reverse()) await dispose().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Managed Product witness cleanup");
  };
  try {
    const currency = await logicalCurrencyFixture("postgres", dispose => cleanup.push(dispose),
      { includeProduct: true, managedRead: true });
    const product = await prepareLogicalProductHost(currency);
    cleanup.push(() => Effect.runPromise(product.host.close));
    await Effect.runPromise(product.host.initialize([]));
    const input = product.managedReadHostInput;
    if (input === undefined) throw new Error("Missing isolated managed Product host");
    const reader = await Effect.runPromise(makeCommerceReadHost(input));
    cleanup.push(() => Effect.runPromise(reader.close));
    const create = async (data: Readonly<{ id: string; title: string; handle: string }>) => {
      const output = await Effect.runPromise(product.host.run(product.host.newRequestKey(),
        product.runtime.commands.internalProductCreate, data));
      const record = Array.isArray(output) && output.length === 1 ? output[0] : output;
      if (!isJsonObject(record) || typeof record.id !== "string") throw new Error("Missing native Product seed");
      return { id: record.id };
    };
    return { currency, product, reader, create, close };
  } catch (cause) {
    await close();
    throw cause;
  }
}
