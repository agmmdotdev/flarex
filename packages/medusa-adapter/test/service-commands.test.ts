import { describe, expect, expectTypeOf, it } from "vitest";
import { mockRelationalRead } from "./mock-relational-read";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { commerceError, commerceLimits, defaultCommerceResources, useCapturedPrivateJsonData, inspectCapturedPrivateJsonData, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { getCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { commerceServiceCommands } from "../src/service-commands";
import { withCommerceService } from "../src/commerce-service-bridge";
import { commerceDecoder } from "../src/commerce-decoder";
import { isGraphReadCommand } from "../src/local-graph/commands";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productRepository } from "../src/product-repository";
import { capturePricingMetadata } from "../src/pricing-schema";
import { preparePricingRepository } from "../src/pricing-repository";
import { projectRows } from "../src/query/projection";

const fixture = Effect.gen(function* () {
  const lifetime = yield* Effect.acquireRelease(
    makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "command-bindings", "write"),
    lifetime => lifetime.close,
  );
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  const ctx = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources,
    store: { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: () => Effect.fail(commerceError("unsupportedProfile")), aggregate: () => Effect.fail(commerceError("unsupportedProfile")), find: unused, count: unused, write: unused, delete: unused, lifecycle: unused }, table: unused,
  }, "command-bindings", lifetime.context, unused, unused);
  return { ctx, lifetime };
});
const decode = commerceDecoder(Schema.Struct({ code: Schema.String, values: Schema.Array(Schema.String) }), "invalidInput");
const prepare = Effect.fn("ServiceCommandsTest.prepare")(function* (ctx: CommerceCommandContext, input: Json) {
  const decoded = yield* Effect.fromResult(decode(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
  return { code: decoded.code, values: [...decoded.values] };
});
type Input = Effect.Success<ReturnType<typeof prepare>>;

function bindings(label: string) {
  const receivers: object[] = [];
  class Service {
    readonly label = label;
    async listAndCount(input: Input) {
      receivers.push(this);
      input.values.push(this.label);
      return [[{ code: input.code, values: input.values }], 9];
    }
    async upsert(input: Input) { return { code: input.code, value: this.label }; }
  }
  class SpecializedService extends Service {
    override async upsert(input: Input) {
      receivers.push(this);
      const result = await super.upsert(input);
      return { ...result, specialized: true };
    }
  }
  let constructions = 0;
  const use = (ctx: CommerceCommandContext, work: (service: SpecializedService) => Promise<unknown>) =>
    withCommerceService(ctx, () => { constructions++; return new SpecializedService(); }, work);
  const commands = commerceServiceCommands(use);
  return {
    commands, receivers, constructions: () => constructions,
    read: commands.read(label + "count", prepare, (service, input) => {
      expectTypeOf(input).toEqualTypeOf<Input>();
      return service.listAndCount(input);
    }),
    write: commands.write(label + "upsert", prepare, (service, input) => service.upsert(input)),
  };
}

describe("scoped Medusa service command construction", () => {
  it("retains genuine projections through actual Product and Pricing serializers and the native service return", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const product = yield* captureProductSchema("serializer-handoff").pipe(Effect.flatMap(schema => productRuntimeMetadata(schema.metadata.frame)));
      const pricing = yield* capturePricingMetadata();
      const pricingRepository = yield* Effect.fromResult(preparePricingRepository(pricing.frame));
      const { ctx } = yield* fixture;
      const native = Result.getOrThrow(useCapturedPrivateJsonData({ id: "native-row", metadata: { signed: -0, value: "retained" },
        amount: 1, raw_amount: { value: "1", precision: 20 }, extra: "selected-away" }, 65_536, commerceError)).value;
      if (!isJsonObject(native)) throw new Error("Missing complete native row");
      const selected = Result.getOrThrow(projectRows([native], { fields: new Set(["id", "metadata", "amount", "raw_amount"]), children: [], nullRelations: [] }));
      expect(selected[0]?.metadata).toBe(native.metadata);
      const input = Result.getOrThrow(useCapturedPrivateJsonData(selected, 65_536, commerceError)).value;
      for (const compose of [
        (owner: Parameters<typeof productRepository>[1]) => productRepository(ctx, owner, product).repository,
        (owner: Parameters<typeof productRepository>[1]) => pricingRepository.bind(ctx, owner).repository,
      ]) {
        const serialized = yield* withCommerceService(ctx, compose, repository => repository.serialize(input));
        expect(serialized).toBe(input);
        expect(serialized).toEqual([{ id: "native-row", metadata: { signed: -0, value: "retained" }, amount: 1, raw_amount: { value: "1", precision: 20 } }]);
        expect(inspectCapturedPrivateJsonData(serialized)?.negativeZero).toBe(true);
        if (!Array.isArray(serialized) || serialized[0] === undefined || !isJsonObject(serialized[0]) ||
          serialized[0].metadata === undefined || !isJsonObject(serialized[0].metadata))
          throw new Error("Missing serialized native metadata");
        expect(Object.is(serialized[0].metadata.signed, -0)).toBe(true);
        expect(Reflect.set(serialized[0].metadata, "signed", 1)).toBe(false);
        // Foreign scalar results still capture completely and omit undefined
        // exactly as the native serialization contract requires.
        const foreign = { id: "foreign", metadata: { value: "original" }, omitted: undefined };
        const captured = yield* withCommerceService(ctx, compose, repository => repository.serialize(foreign));
        foreign.metadata.value = "escaped";
        expect(captured).toEqual({ id: "foreign", metadata: { value: "original" } });
      }
    })));
  });

  it("is lazy, preserves identities and marks only read tokens for graph use", () => {
    const bound = bindings("volume");
    expect(bound.constructions()).toBe(0);
    expect(Object.keys(bound.commands)).toEqual(["read", "write"]);
    expect(getCommerceCommand(bound.read)).toMatchObject({ name: "volumecount", mode: "read" });
    expect(getCommerceCommand(bound.write)).toMatchObject({ name: "volumeupsert", mode: "write" });
    expect(isGraphReadCommand(bound.read)).toBe(true);
    expect(isGraphReadCommand(bound.write)).toBe(false);
  });

  it("preserves listAndCount tuples, detached inputs, native overrides and per-use receivers", async () => {
    const first = bindings("volume"), second = bindings("edition");
    const input = { code: "natural-key", values: ["original"] };
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { ctx } = yield* fixture;
      const read = getCommerceCommand(first.read), write = getCommerceCommand(first.write), other = getCommerceCommand(second.write);
      if (!read || !write || !other) throw new Error("Missing command definition");
      expect(yield* read.run(ctx, input)).toEqual([[{ code: "natural-key", values: ["original", "volume"] }], 9]);
      expect(yield* write.run(ctx, input)).toEqual({ code: "natural-key", value: "volume", specialized: true });
      expect(yield* other.run(ctx, input)).toEqual({ code: "natural-key", value: "edition", specialized: true });
    })));
    expect(input).toEqual({ code: "natural-key", values: ["original"] });
    expect(first.constructions()).toBe(2);
    expect(second.constructions()).toBe(1);
    expect(new Set([...first.receivers, ...second.receivers]).size).toBe(3);
  });

  it("refuses invalid preparation before service construction and keeps the root rollback-only", async () => {
    const bound = bindings("volume");
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { ctx, lifetime } = yield* fixture;
      const definition = getCommerceCommand(bound.write);
      if (!definition) throw new Error("Missing command definition");
      expect(yield* Effect.flip(definition.run(ctx, { values: [] }))).toMatchObject({ reason: "invalidInput" });
      expect(yield* Effect.flip(lifetime.seal)).toMatchObject({ reason: "rollbackOnly" });
    })));
    expect(bound.constructions()).toBe(0);
  });

  it.each(["getter", "firstGetter", "oversized"] as const)("captures the whole native result before projection (%s)", async malformed => {
    let getterCalls = 0, projections = 0;
    const use = (ctx: CommerceCommandContext, work: (service: object) => Promise<unknown>) => withCommerceService(ctx, () => ({}), work);
    const commands = commerceServiceCommands(use);
    const value: unknown[] = ["selected"];
    if (malformed !== "oversized") Object.defineProperty(value, malformed === "getter" ? "1" : "0", { enumerable: true, get() { getterCalls++; return "hidden"; } });
    else value.push("x".repeat(defaultCommerceResources.commandBytes));
    const command = commands.write("capturedProjection", prepare, async () => value,
      result => { projections++; return Array.isArray(result) ? result[0] : result; });
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { ctx, lifetime } = yield* fixture;
      const definition = getCommerceCommand(command);
      if (!definition) throw new Error("Missing command definition");
      const failure = yield* Effect.flip(definition.run(ctx, { code: "valid", values: [] }));
      expect(failure.reason).toBe(malformed === "oversized" ? "limitExceeded" : "invalidInput");
      expect(yield* Effect.flip(lifetime.seal)).toMatchObject({ reason: "rollbackOnly" });
    })));
    expect(projections).toBe(0);
    expect(getterCalls).toBe(0);
  });

  it.each(["defect", "interrupt"] as const)("does not classify a preparation %s as ordinary input failure", async outcome => {
    const bound = bindings("volume");
    const defect = new Error("preparation defect");
    const command = bound.commands.write("preparationFailure", () => outcome === "defect" ? Effect.die(defect) : Effect.interrupt,
      async () => { throw new Error("Must not invoke"); });
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { ctx } = yield* fixture;
      const definition = getCommerceCommand(command);
      if (!definition) throw new Error("Missing command definition");
      const exit = yield* Effect.exit(definition.run(ctx, null));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.some(Cause.isFailReason)).toBe(false);
        expect(outcome === "defect"
          ? exit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)
          : Cause.hasInterrupts(exit.cause)).toBe(true);
      }
    })));
    expect(bound.constructions()).toBe(0);
  });
});
