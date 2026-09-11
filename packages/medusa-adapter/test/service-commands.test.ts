import { describe, expect, expectTypeOf, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { commerceError, commerceLimits, defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { getCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/context";
import { commerceServiceCommands } from "../src/service-commands";
import { withCommerceService } from "../src/commerce-service-bridge";
import { commerceDecoder } from "../src/commerce-decoder";
import { isGraphReadCommand } from "../src/local-graph/commands";

const fixture = Effect.gen(function* () {
  const lifetime = yield* Effect.acquireRelease(
    makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "command-bindings", "write"),
    lifetime => lifetime.close,
  );
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  const ctx = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources,
    store: { find: unused, count: unused, write: unused, delete: unused, lifecycle: unused }, table: unused,
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
