import { Result } from "effect";
import { currencyStaticResources } from "@medusajs/currency/static-manifest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyReadCatalog } from "./read-profile";
import type { currencyCommands } from "./service";
import type { GraphModuleDefinition } from "../../local-graph/model";

import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";

export function currencyGraphDefinition(commands: Pick<typeof currencyCommands, "count">): Result.Result<GraphModuleDefinition, ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const catalog = yield* currencyReadCatalog;
    const table = yield* catalog.table("currency");
    const joiner = currencyStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* scalarGraphDefinition(yield* moduleAliases(joiner), "Currency", commands.count, table);
  });
}
