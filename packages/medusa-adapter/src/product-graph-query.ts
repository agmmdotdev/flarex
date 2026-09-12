import { Result } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { decodeCategoryProjection } from "./product-category-projection";
import { productRelations, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import type { GraphReadCommand } from "./local-graph/commands";
import type { GraphModuleDefinition, GraphReadDefinition } from "./local-graph/model";
import { decodeGraphCount } from "./local-graph/query";
import { moduleAliases, relationPaths } from "./local-graph/module";

const decodeCategoryCount = (input: Json) => decodeCategoryProjection(input).pipe(
  Result.flatMap(value => captureCommerceInput(value)), Result.flatMap(decodeGraphCount),
);

type ProductGraphCommands = Readonly<Record<"count" | "countCategories" | "countCollections" | "countTypes" | "countTags" | "countOptions" | "countVariants" | "countImages", GraphReadCommand>>;

/** Module-owned capabilities extend checked metadata; Category hydration and
 * Product's image-assignment path remain the actual services' responsibility. */
export function productGraphDefinition(metadata: ProductRuntimeMetadata, commands: ProductGraphCommands): Result.Result<GraphModuleDefinition, ReturnType<typeof commerceError>> {
  return Result.gen(function* () {
    const reads: GraphReadDefinition[] = [];
    const selected = [
      { entity: metadata.product, command: commands.count, paths: [...productRelations] },
      { entity: metadata.category, command: commands.countCategories, paths: ["products"] },
      { entity: metadata.collection, command: commands.countCollections },
      { entity: metadata.type, command: commands.countTypes },
      { entity: metadata.tag, command: commands.countTags },
      { entity: metadata.option, command: commands.countOptions },
      { entity: metadata.variant, command: commands.countVariants },
      { entity: metadata.image, command: commands.countImages },
    ];
    for (const item of selected) {
      const { entity, command } = item;
      const table = yield* metadata.readCatalog.table(entity.table.name);
      const paths = yield* relationPaths(metadata.readCatalog, table.name, item.paths ?? metadata.relatedReads.get(table.name)?.paths ?? []);
      if (entity === metadata.category) paths.push(
        { path: "parent_category", table, many: false, optional: true }, { path: "category_children", table, many: true },
      );
      // The Product service assembles this from variants, images and assignments.
      if (entity === metadata.product) paths.push({ path: "variants.images", table: yield* metadata.readCatalog.table(metadata.image.table.name), many: true });
      const orderable = entity === metadata.product ? ["id", "handle"] : entity === metadata.category ? ["id", "rank"] : ["id"];
      const uniqueOrder = orderable.filter(field => field === "id" || entity.table.indexes.some(index => index.unique && index.columns.length === 1 && index.columns[0] === field));
      reads.push({ model: entity.model, command, table, paths, orderable, uniqueOrder,
        multipleOrder: entity === metadata.category, decode: entity === metadata.category ? decodeCategoryCount : decodeGraphCount });
    }
    // The retained method is pure static metadata and does not use its receiver.
    return { aliases: yield* moduleAliases(ProductModuleService.prototype.__joinerConfig()), reads };
  });
}
