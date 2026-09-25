import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { Cause, Effect, Option } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { ISalesChannelModuleService } from "@medusajs/framework/types";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../../src/commerce-input";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalSalesChannelHost } from "./logical-sales-channel-fixture";

type Methods = "createSalesChannels" | "updateSalesChannels" | "deleteSalesChannels" | "retrieveSalesChannel" | "listSalesChannels" | "listAndCountSalesChannels";

/** The promoted native suite exercises its six selected methods against the
 * admitted logical source. Each write receives its own atomic root. */
export function moduleIntegrationTestRunner(options: {
  moduleName: "sales_channel";
  testSuite: (context: { service: Pick<ISalesChannelModuleService, Methods> }) => void;
}): void {
  const cleanup: Array<() => Promise<void>> = [];
  const participant = defineAtomicCommerceParticipant("salesChannel");
  let current = Option.none<{
    host: Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>;
    reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
    sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
  }>();
  const get = () => Option.getOrThrow(current);
  const create = defineAtomicCommerceCommand("nativeSalesChannelCreate", (ctx, input) => ctx.call(participant, get().sales.runtime.create, input));
  const update = defineAtomicCommerceCommand("nativeSalesChannelUpdate", (ctx, input) => ctx.call(participant, get().sales.runtime.update, input));
  const remove = defineAtomicCommerceCommand("nativeSalesChannelDelete", (ctx, input) => ctx.call(participant, get().sales.runtime.delete, input));
  const eventName = (action: "created" | "updated" | "deleted") => buildModuleResourceEventName({
    prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action,
  });
  beforeAll(async () => {
    if (options.moduleName !== "sales_channel") throw new Error("Only Sales Channel is admitted");
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Sales Channel test driver");
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeSalesChannel: true });
    const sales = await prepareLogicalSalesChannelHost(fixture);
    await Effect.runPromise(sales.host.initialize([]));
    await Effect.runPromise(sales.host.close);
    const revision = "1".repeat(64);
    const policy = sales.runtime.logicalEventPolicy();
    const contracts = {
      created: defineCommerceEventContract({ name: eventName("created"), revision, internal: true, decode: policy.capture }),
      updated: defineCommerceEventContract({ name: eventName("updated"), revision, internal: true, decode: policy.capture }),
      deleted: defineCommerceEventContract({ name: eventName("deleted"), revision, internal: true, decode: policy.capture }),
    };
    const eventContracts = Object.values(contracts);
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "logical-sales-channel-native-suite" },
      participants: [{ participant, logicalStorage: sales.hostInput.logicalStorage,
        commands: sales.runtime.commands, validateLogicalCall: policy.validateLogicalCall,
        events: { contracts: eventContracts, select: (message: Json) => {
          const selected = (["created", "updated", "deleted"] as const).find(action =>
            isJsonObject(message) && message.name === eventName(action));
          return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contracts[selected]);
        } } }], commands: [create, update, remove],
      events: { producerRevision: revision, contracts: eventContracts,
        subscribers: [{ id: "sales-channel-native-suite", revision: "2".repeat(64) }],
        validate: emitted => emitted.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    cleanup.push(() => Effect.runPromise(host.close));
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    cleanup.push(() => Effect.runPromise(reader.close));
    current = Option.some({ host, reader, sales });
  }, 150_000);
  afterAll(async () => {
    current = Option.none();
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length) throw new AggregateError(failures, "Sales Channel logical fixture cleanup failed");
  }, 150_000);

  const call = (operation: "create" | "update" | "delete" | "retrieve" | "list" | "count",
    input: unknown, context: unknown) => Effect.runPromise(Effect.gen(function* () {
      if (context !== undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      const { host, reader, sales } = get();
      const args = yield* Effect.fromResult(captureCommerceInput(input));
      switch (operation) {
        case "create": return yield* host.run(host.newRequestKey(), create, args);
        case "update": return yield* host.run(host.newRequestKey(), update, args);
        case "delete": return yield* host.run(host.newRequestKey(), remove, args);
        case "retrieve": return yield* reader.read(sales.runtime.retrieve, args);
        case "list": return yield* reader.read(sales.runtime.list, args);
        case "count": return yield* reader.read(sales.runtime.count, args);
      }
    }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
      error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error)))));
  const methods = {
    createSalesChannels: (data: unknown, context?: unknown) => call("create", data, context),
    updateSalesChannels: (id: unknown, data: unknown, context?: unknown) => call("update", { id, data }, context),
    deleteSalesChannels: (ids: unknown, context?: unknown) => call("delete", ids, context).then(() => undefined),
    retrieveSalesChannel: (id: unknown, config?: unknown, context?: unknown) => call("retrieve", { id, config }, context),
    listSalesChannels: (filters?: unknown, config?: unknown, context?: unknown) => call("list", { filters, config }, context),
    listAndCountSalesChannels: (filters?: unknown, config?: unknown, context?: unknown) => call("count", { filters, config }, context),
  };
  // SAFETY: source-test-only boundary for native overloaded DTO signatures.
  const service = new Proxy<object>(methods, { get(target, key, receiver) {
    if (!Object.hasOwn(target, key)) throw new Error("Unadmitted Sales Channel method: " + String(key));
    return Reflect.get(target, key, receiver);
  } }) as Pick<ISalesChannelModuleService, Methods>;
  describe("Sales Channel native compatibility", () => {
    beforeEach(async () => {
      const rows = await service.listSalesChannels({}, { select: ["id"], take: 256 });
      if (rows.length) await service.deleteSalesChannels(rows.map(row => row.id));
    });
    options.testSuite({ service });
  });
}
