import { withCommerceService } from "./commerce-service-bridge";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { Effect, Cause } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Currency } from "@medusajs/currency/models";
import { CurrencyModuleService } from "@medusajs/currency/services";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import type { ICurrencyModuleService, CurrencyTypes, FindConfig, FilterableCurrencyProps } from "@medusajs/framework/types";
import { defineCommerceCommand, type CommerceCommandContext, type CommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyRepository } from "./currency-repository";
import { captureCurrencyInput } from "./currency-values";
import { currencyDto, currencyDtos, currencyCountResult } from "./currency-result";

const compose = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
  const repository = currencyRepository(ctx, owner);
  const internal = new (MedusaInternalService(Currency))<object, typeof Currency>({ currencyRepository: repository });
  const service = new CurrencyModuleService({ baseRepository: repository, currencyService: internal }, { scope: "internal" });
  return { repository, internal, service, context: { manager: ctx.manager, transactionManager: ctx.manager } };
};

export const withCurrencyService = Effect.fn("CurrencyAdapter.withService")((ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
  withCommerceService(ctx, owner => compose(ctx, owner), work));

const read = (kind: "list" | "count" | "retrieve") => defineCommerceCommand(`currency${kind}`, "read", Effect.fn(`CurrencyAdapter.${kind}`)(function* (ctx, value) {
  if (!isNonArrayRecord(value) || Object.keys(value).some(key => !["code", "filters", "config"].includes(key)) ||
    (value.code !== undefined && typeof value.code !== "string")) return yield* ctx.refuse(commerceError("invalidInput"));
  // The captured plain JSON is copied because Medusa mutates query options. Its
  // broad framework types are checked at the selected DAL query boundary before SQL.
  const args = structuredClone(value);
  const config = args.config as FindConfig<CurrencyTypes.CurrencyDTO> | undefined;
  const filters = args.filters as FilterableCurrencyProps | undefined;
  return yield* withCurrencyService(ctx, ({ service, context }) => {
    // SAFETY: undefined intentionally reaches the original service's missing-key
    // check, preserving its established error rather than inventing a replacement.
    if (kind === "retrieve") return service.retrieveCurrency(args.code as string, config, context);
    if (kind === "count") return service.listAndCountCurrencies(filters, config, context);
    return service.listCurrencies(filters, config, context);
  });
}));

export const currencyCommands = Object.freeze({ list: read("list"), count: read("count"), retrieve: read("retrieve") });
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
