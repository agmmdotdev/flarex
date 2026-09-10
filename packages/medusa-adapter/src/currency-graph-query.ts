import { Result } from "effect";
import { currencyStaticResources } from "@medusajs/currency/static-manifest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyReadCatalog } from "./currency-read-profile";
import type { currencyCommands } from "./currency-service";
import type { GraphModuleDefinition } from "./local-graph/model";
import { decodeGraphCount } from "./local-graph/query";
import { moduleAliases } from "./local-graph/module";

export function currencyGraphDefinition(commands: Pick<typeof currencyCommands, "count">): Result.Result<GraphModuleDefinition, ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const catalog = yield* currencyReadCatalog;
    const table = yield* catalog.table("currency");
    const joiner = currencyStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return { aliases: yield* moduleAliases(joiner), reads: [{ model: "Currency", methodSuffix: "Currencies", command: commands.count,
      table, paths: [], orderable: table.primaryKeys, uniqueOrder: table.primaryKeys, multipleOrder: false, decode: decodeGraphCount }] };
  });
}
