import { Effect, Cause, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Currency } from "@medusajs/currency/models";
import { CurrencyModuleService } from "@medusajs/currency/services";
import { defineCommerceModule, type CommerceModuleScope } from "./module-definition";
import type { ICurrencyModuleService, CurrencyTypes, FindConfig, FilterableCurrencyProps } from "@medusajs/framework/types";
import { defineCommerceCommand, type CommerceCommandContext, type CommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyRepository } from "./currency-repository";
import { captureCurrencyInput } from "./currency-values";
import { currencyDto, currencyDtos, currencyCountResult } from "./currency-result";
import { decodeCurrencyRead } from "./currency-input";
import { commerceServiceCommands } from "./service-commands";
import { currencyGraphDefinition } from "./currency-graph-query";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";
import { commerceDecoder } from "./commerce-decoder";
import { currencyValueProfile } from "./currency-value-profile";

const currencyModule = defineCommerceModule({
  name: "flarex-currency-local", models: [Currency],
  profile: { name: "currency", capabilities: [], bind: (ctx, owner) => {
    const repository = currencyRepository(ctx, owner);
    return { baseRepository: repository, repository: () => repository };
  } },
  extensions: {},
  service: ({ binding, dependencies, context }) => ({
    repository: binding.baseRepository, internal: dependencies.currencyService,
    service: new CurrencyModuleService(dependencies, { scope: "internal" }), context,
  }),
});
type CurrencyScope = CommerceModuleScope<Result.Result.Success<typeof currencyModule>>;
export const withCurrencyService = Effect.fn("CurrencyAdapter.withService")(function* (ctx: CommerceCommandContext, work: (value: CurrencyScope) => Promise<unknown>) {
  const module = yield* Effect.fromResult(currencyModule).pipe(Effect.mapError(error => commerceError("unsupportedProfile", error)));
  return yield* module.use(ctx, work);
});

const readInput = Effect.fn("CurrencyAdapter.readInput")(function* (ctx: CommerceCommandContext, value: Json) {
  const decoded = yield* Effect.fromResult(decodeCurrencyRead(value)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
  // The captured plain JSON is copied because Medusa mutates query options. Its
  // broad framework types are checked at the selected DAL query boundary before SQL.
  const args = structuredClone(decoded);
  const config = args.config as FindConfig<CurrencyTypes.CurrencyDTO> | undefined;
  const filters = args.filters as FilterableCurrencyProps | undefined;
  return { code: args.code, config, filters };
});

const commands = commerceServiceCommands(withCurrencyService);
export const currencyCommands = Object.freeze({
  list: commands.read("currencylist", readInput, ({ service, context }, args) => service.listCurrencies(args.filters, args.config, context)),
  count: commands.read("currencycount", readInput, ({ service, context }, args) => service.listAndCountCurrencies(args.filters, args.config, context)),
  // SAFETY: undefined deliberately reaches Medusa's original missing-key check.
  retrieve: commands.read("currencyretrieve", readInput, ({ service, context }, args) => service.retrieveCurrency(args.code as string, args.config, context)),
});
export const currencyGraph = currencyGraphDefinition(currencyCommands);
const decodeWorkflowArguments = commerceDecoder(Schema.Tuple([Schema.String]), "invalidInput");
const decodeWorkflowCurrency = commerceDecoder(Schema.StructWithRest(Schema.Struct({ code: Schema.String, name: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)]), "storedCorruption");
/** Workflow reads reuse the same command and validate their actual projection;
 * they do not inherit the compatibility facade's full-DTO assertion. */
export const currencyWorkflowModule = Result.gen(function* () {
  const module = yield* currencyModule.pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
  const values = yield* currencyValueProfile;
  const retrieveCurrency = yield* defineWorkflowMethod({ command: currencyCommands.retrieve, arguments: decodeWorkflowArguments,
    encode: ([code]) => ({ code }), output: value => values.decodeProjection(value).pipe(Result.flatMap(decodeWorkflowCurrency)),
  });
  return yield* defineWorkflowModule({ name: "currency", source: module.description, methods: { retrieveCurrency }, graph: yield* currencyGraph });
});
export type CurrencyWorkflowModule = Result.Result.Success<typeof currencyWorkflowModule>;
/** Private composite-command participant; uses the existing internal service/DAL owner. */
export const currencyAnnouncementWrite = defineCommerceCommand("currencyAnnouncementWrite", "write", Effect.fn("CurrencyAdapter.announcementWrite")(function* (ctx, value) {
  if (!isNonArrayRecord(value) || typeof value.code !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
  const code = value.code;
  return yield* withCurrencyService(ctx, async ({ internal, service, context }) => {
    await internal.upsert([value], context);
    return service.retrieveCurrency(code, {}, context);
  });
}));
export type CurrencyReads = Pick<ICurrencyModuleService, "listCurrencies" | "listAndCountCurrencies" | "retrieveCurrency">;

/** Public Currency read shape; its storage authority is entirely host-owned. */
export function makeCurrencyService(host: CommerceHost): CurrencyReads {
  const run = Effect.fn("CurrencyService.read")(function* (command: typeof currencyCommands.list, input: unknown, context: unknown) {
    if (context !== undefined && (!isNonArrayRecord(context) || Object.keys(context).length !== 0)) return yield* Effect.fail(commerceError("invalidAuthority"));
    return yield* host.read(command, yield* Effect.fromResult(captureCurrencyInput(input)));
  });
  const promise = <Value>(effect: Effect.Effect<Value, CommerceTransactionError>) => Effect.runPromise(effect.pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "adapterFailure" && error.cause !== undefined ? error.cause : error))),
  ));
  return {
    listCurrencies: (filters, config, context) => promise(run(currencyCommands.list, { filters, config }, context).pipe(Effect.flatMap(value => Effect.fromResult(currencyDtos(value))))),
    listAndCountCurrencies: (filters, config, context) => promise(run(currencyCommands.count, { filters, config }, context).pipe(Effect.flatMap(value => Effect.fromResult(currencyCountResult(value))))),
    retrieveCurrency: (code, config, context) => promise(run(currencyCommands.retrieve, { code, config }, context).pipe(Effect.flatMap(value => Effect.fromResult(currencyDto(value))))),
  };
}
