import { createHash } from "node:crypto";
import { Effect } from "effect";
import { expect } from "vitest";
import { count } from "drizzle-orm";
import { fxSystemCommits } from "../../../../persistence-postgres/src/database/schema";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyFixture } from "../../../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalProductHost } from "../../../../medusa-adapter/test/support/logical-product-fixture";
import type { CorePerformanceScenario } from "./scenario";
import type { MixedMutationEffectDiagnostics } from "./measurement";
import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import { selectedCorePerformanceScenarios, type CorePerformanceScenarioName, type CorePerformanceSize } from "./scenarioCatalog";

/** Only fixture composition lives here. Native commands and their receipt
 * validator remain the owners of graph/lifecycle/event semantics. */
export async function prepareProductFlows(driver: "pglite" | "postgres", size: CorePerformanceSize,
  postgresEndpoints?: PostgresFixtureEndpoints) {
  const started = performance.now();
  const releases: Array<() => Promise<void>> = [];
  let closed = false;
  const dispose = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    for (const release of releases.toReversed()) try { await release(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Product measurement cleanup failed");
  };
  try {
    const currency = await logicalCurrencyFixture(driver, release => { releases.push(release); }, {
      includeProduct: true, ...(postgresEndpoints === undefined ? {} : { postgresEndpoints }),
    });
    const product = await prepareLogicalProductHost(currency);
    releases.push(() => Effect.runPromise(product.host.close));
    await Effect.runPromise(product.host.initialize([]));
    const participant = defineAtomicCommerceParticipant("product");
    const commands = product.runtime.commands;
    const roots = {
      create: defineAtomicCommerceCommand("measuredProductCreate", (ctx, input) => ctx.call(participant, commands.create, input)),
      update: defineAtomicCommerceCommand("measuredProductUpdate", (ctx, input) => ctx.call(participant, commands.update, input)),
      delete: defineAtomicCommerceCommand("measuredProductDelete", (ctx, input) => ctx.call(participant, commands.delete, input)),
      softDelete: defineAtomicCommerceCommand("measuredProductSoftDelete", (ctx, input) => ctx.call(participant, commands.softDelete, input)),
      restore: defineAtomicCommerceCommand("measuredProductRestore", (ctx, input) => ctx.call(participant, commands.restore, input)),
    };
    const revision = createHash("sha256").update("executor-product-measurement").digest("hex");
    const policy = product.runtime.logicalPolicy;
    const contracts = new Map(product.runtime.metadata.entities.flatMap(entity =>
      [entity.createdEvent, entity.updatedEvent, entity.deletedEvent, entity.restoredEvent])
      .map(name => [name, defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture })] as const));
    const eventContracts = [...contracts.values()];
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
      identityAndAccessPolicy: { profile: "executor-product-measurement" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
        commands: [commands.create, commands.update, commands.delete, commands.softDelete, commands.restore],
        validateLogicalCall: policy.validateLogicalCall,
        events: { contracts: eventContracts, select: event => {
          const contract = isJsonObject(event) && typeof event.name === "string" ? contracts.get(event.name) : undefined;
          return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
        } } }],
      commands: Object.values(roots), events: { producerRevision: revision, contracts: eventContracts,
        subscribers: [{ id: "executor-product-measurement", revision }],
        validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    releases.push(() => Effect.runPromise(host.close));
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput, commands: [commands.list, commands.retrieve] }));
    releases.push(() => Effect.runPromise(read.close));
    const imageCount = size === "small" ? 2 : 8;
    const variantCount = size === "small" ? 1 : 4;
    let diagnostics: MixedMutationEffectDiagnostics | undefined;
    const write = (root: typeof roots.create, input: Json, observed = false) => {
      const work = host.run(host.newRequestKey(), root, input);
      return Effect.runPromise(!observed || diagnostics === undefined ? work
        : diagnostics.provide(diagnostics.traceEffect("native Product operation", work)));
    };
    const graph = (id: string) => ({ id, title: id,
      images: Array.from({ length: imageCount }, (_, index) => ({ id: `img_${id}_${index}`, url: `https://example.invalid/${id}/${index}` })),
      options: [{ title: "Size", values: Array.from({ length: variantCount }, (_, index) => String(index)) }],
      variants: Array.from({ length: variantCount }, (_, index) => ({ id: `pvar_${id}_${index}`, title: `Variant ${index}`, options: { Size: String(index) } })),
    });
    const timings = { provisionAndPrepareMs: performance.now() - started, runtimeConstructionMs: null, initialSeedMs: 0,
      ...(currency.installationTiming === undefined ? {} : { installation: currency.installationTiming }),
      fixturePreparation: currency.preparationTiming };
    return {
      dispose,
      scenario(name: CorePerformanceScenarioName): CorePerformanceScenario {
        return { timings, ...(currency.resource.kind === "postgres" ? {
          pools: { controlPool: currency.resource.control.pool, targetPool: currency.resource.target.pool },
        } : {}),
          workload: { flow: name, cardinality: { images: name === "product-create" || name === "product-update" ? 0 : imageCount,
            variants: name === "product-create" || name === "product-update" ? 0 : variantCount, products: 1 } },
          dispose,
          setEffectDiagnostics: next => { diagnostics = next; },
          prepareSample: id => prepareSample(name, id),
        };
      },
      // Same native assembly supports the fast correctness lane without pool reports.
      prepareSample,
    };

    async function prepareSample(name: CorePerformanceScenarioName, suffix: string) {
      if (!selectedCorePerformanceScenarios("product").some(value => value.name === name)) throw new Error("Unknown Product measurement flow");
      const id = `prod_${suffix}`;
      const scalar = name === "product-create" || name === "product-update";
      const ownedGraph = graph(id);
      const original = scalar ? { id, title: suffix } : ownedGraph;
      if (name !== "product-create" && name !== "product-create-graph") await write(roots.create, original);
      if (name === "product-restore") await write(roots.softDelete, [id]);
      const before = (await currency.persistence.drizzle.select({ value: count() }).from(fxSystemCommits))[0]?.value;
      const input = name === "product-create" || name === "product-create-graph" ? original
        : name === "product-update" ? { id, data: { title: `${suffix}-updated` } }
          : name === "product-replace-images" ? { id, data: { images: [
            { id: `img_${id}_0`, url: `https://example.invalid/${id}/0` },
            { id: `img_${id}_new`, url: `https://example.invalid/${id}/new` },
          ] } } : [id];
      const root = name === "product-create" || name === "product-create-graph" ? roots.create
        : name === "product-update" || name === "product-replace-images" ? roots.update
          : name === "product-delete" ? roots.delete : name === "product-soft-delete" ? roots.softDelete : roots.restore;
      return { run: () => write(root, input, true),
        async verify(result: unknown) {
          expect((await currency.persistence.drizzle.select({ value: count() }).from(fxSystemCommits))[0]?.value).toBe((before ?? 0) + 1);
          const active = await Effect.runPromise(read.read(commands.list, { filters: { id },
            config: { relations: ["images", "options.values", "variants.options"] } }));
          if (name === "product-delete" || name === "product-soft-delete") {
            expect(active).toEqual([]);
            const deleted = await Effect.runPromise(read.read(commands.list, { filters: { id }, config: { withDeleted: true } }));
            expect(deleted).toEqual(name === "product-delete" ? [] : [expect.objectContaining({ id, deleted_at: expect.any(String) })]);
          } else {
            if (name !== "product-restore") expect(result).toMatchObject({ id });
            expect(active).toMatchObject([{ id, title: name === "product-update" ? `${suffix}-updated` : original.title }]);
            if (!scalar) {
              expect(active).toMatchObject([{ variants: expect.arrayContaining(ownedGraph.variants.map(({ id, title }) => expect.objectContaining({ id, title }))) }]);
              if (!Array.isArray(active) || !isJsonObject(active[0])) throw new Error("Missing native graph");
              expect(active[0].images).toHaveLength(name === "product-replace-images" ? 2 : imageCount);
              expect(active[0].variants).toHaveLength(variantCount);
              expect(active[0].options).toMatchObject([{ title: "Size", values: expect.arrayContaining(
                Array.from({ length: variantCount }, (_, index) => expect.objectContaining({ value: String(index) }))) }]);
              if (name === "product-replace-images") expect(active[0].images).toMatchObject([
                { id: `img_${id}_0`, rank: 0 }, { id: `img_${id}_new`, rank: 1 },
              ]);
            }
          }
        },
        async cleanup() {
          if (name === "product-soft-delete") await write(roots.restore, [id]);
          if (name !== "product-delete") await write(roots.delete, [id]);
        },
      };
    }
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Product preparation and cleanup failed"); }
    throw cause;
  }
}
