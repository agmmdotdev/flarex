import { Result } from "effect";
import { Currency } from "@medusajs/currency/models";
import { currencyStaticResources } from "@medusajs/currency/static-manifest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyReadCatalog } from "./read-profile";
import type { currencyCommands } from "./service";
import type { GraphModuleDefinition } from "../../local-graph/model";

import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { currencySchemaTable, readCurrencyMetadata } from "./schema";

export function currencyGraphDefinition(commands: Pick<typeof currencyCommands, "count">): Result.Result<GraphModuleDefinition, ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const catalog = yield* currencyReadCatalog;
    const table = yield* catalog.table("currency");
    const joiner = currencyStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const metadata = yield* readCurrencyMetadata(Currency).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    return yield* withNativeGraphMetadata(yield* scalarGraphDefinition(yield* moduleAliases(joiner), "Currency", commands.count, table),
      [joiner], [currencySchemaTable(metadata)]);
  });
}
