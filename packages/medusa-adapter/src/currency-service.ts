import { makeCurrencyPromiseOwner, type CurrencyPromiseOwner } from "./currency-promise-owner";
import { Effect, Cause, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Currency } from "@medusajs/currency/models";
import { CurrencyModuleService } from "@medusajs/currency/services";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import type { ICurrencyModuleService, CurrencyTypes, FindConfig, FilterableCurrencyProps } from "@medusajs/framework/types";
import { defineCommerceCommand, type CommerceCommandContext, type CommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateJsonData, commerceError, CommerceTransactionError, commerceLimits, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyRepository } from "./currency-repository";
import { captureCurrencyInput } from "./currency-values";

const compose = (ctx: CommerceCommandContext, owner: CurrencyPromiseOwner) => {
  const repository = currencyRepository(ctx, owner);
  const internal = new (MedusaInternalService(Currency))<object, typeof Currency>({ currencyRepository: repository });
  const service = new CurrencyModuleService({ baseRepository: repository, currencyService: internal }, { scope: "internal" });
  return { repository, internal, service, context: { manager: ctx.manager, transactionManager: ctx.manager } };
};

/** The sole Promise bridge into the unchanged framework, scoped to this command. */
export const withCurrencyService = Effect.fn("CurrencyAdapter.withService")(function* (ctx: CommerceCommandContext,
  work: (value: ReturnType<typeof compose>) => Promise<unknown>) {
  const owner = makeCurrencyPromiseOwner();
  return yield* Effect.gen(function* () {
    const value = yield* Effect.tryPromise({
      try: signal => owner.callback(() => work(compose(ctx, owner)), signal),
      catch: cause => cause instanceof CommerceTransactionError ? cause : commerceError("adapterFailure", cause),
    });
    if (owner.hasPending()) return yield* ctx.refuse(commerceError("overlappingOperation"));
    return (yield* Effect.fromResult(capturePrivateJsonData(value, commerceLimits.commandBytes, commerceError))).value;
  }).pipe(
    Effect.tapCause(cause => Effect.exit(ctx.refuse(commerceError("adapterFailure", cause))).pipe(Effect.asVoid)),
    Effect.ensuring(owner.close),
  );
});

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

const isCurrencyProjection = (value: Json): value is JsonObject & Partial<CurrencyTypes.CurrencyDTO> =>
  isNonArrayRecord(value) && ["code", "symbol", "symbol_native", "name"].every(key => value[key] === undefined || typeof value[key] === "string");
const dto = (value: Json): Result.Result<CurrencyTypes.CurrencyDTO, CommerceTransactionError> => {
  if (!isCurrencyProjection(value)) return Result.fail(commerceError("storedCorruption"));
  // SAFETY: the framework promises a full DTO even for a selected projection.
  // All declared DTO fields present in this captured service result are checked.
  return Result.succeed(value as CurrencyTypes.CurrencyDTO);
};
const dtos = (value: Json) => Result.gen(function* () {
  if (!Array.isArray(value)) return yield* Result.fail(commerceError("storedCorruption"));
  const rows: CurrencyTypes.CurrencyDTO[] = [];
  for (const row of value) rows.push(yield* dto(row));
  return rows;
});

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
    listCurrencies: (filters, config, context) => promise(run(currencyCommands.list, { filters, config }, context).pipe(Effect.flatMap(value => Effect.fromResult(dtos(value))))),
    listAndCountCurrencies: (filters, config, context) => promise(run(currencyCommands.count, { filters, config }, context).pipe(Effect.flatMap(value => Effect.gen(function* () {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== "number" || value[0] === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      return [yield* Effect.fromResult(dtos(value[0])), value[1]] satisfies [CurrencyTypes.CurrencyDTO[], number];
    })))),
    retrieveCurrency: (code, config, context) => promise(run(currencyCommands.retrieve, { code, config }, context).pipe(Effect.flatMap(value => Effect.fromResult(dto(value))))),
  };
}
