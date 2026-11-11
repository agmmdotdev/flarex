// @ts-check
import ts from "@typescript/typescript6";

const upstream = "third_party/medusa/upstream/";
const apiTarget = "packages/medusa-http/src/api/";
const apiSource = "packages/medusa/src/api/";
export const storeProductTypePaths = [
  "product/store/entitites.ts", "product/store/queries.ts", "product/store/responses.ts", "product/common.ts", "pricing/common.ts",
  ...["collection", "product-category", "product-tag", "product-type"].flatMap(family =>
    ["common.ts", "store/entities.ts", "store/queries.ts", "store/responses.ts"].map(file => family + "/" + file)),
];
export const storeProductSourcePairs = [
  ...["collections", "product-tags", "product-types", "product-categories"].flatMap(family =>
    ["route.ts", "[id]/route.ts", "middlewares.ts", "query-config.ts", "validators.ts", ...(family === "product-categories" ? ["helpers.ts"] : [])]
      .map(file => ({ target: `${apiTarget}store/${family}/${file}`, source: `${upstream}${apiSource}store/${family}/${file}`, classification: "selectedExportFacade" }))),
  ...["route.ts", "[id]/route.ts", "middlewares.ts", "helpers.ts", "query-config.ts", "validators.ts"].map(file => ({
    target: apiTarget + "store/products/" + file, source: upstream + apiSource + "store/products/" + file, classification: "selectedExportFacade",
  })),
  ...["store/types.ts", "utils/middlewares/products/filter-by-valid-sales-channels.ts", "utils/middlewares/products/normalize-data-for-context.ts",
    "utils/middlewares/products/set-pricing-context.ts", "utils/middlewares/products/set-tax-context.ts", "utils/middlewares/products/constants.ts",
    "utils/middlewares/products/variant-inventory-quantity.ts", "utils/common-validators.ts"].map(file => ({
    target: apiTarget + file, source: upstream + apiSource + (file === "utils/common-validators.ts" ? "utils/common-validators/common.ts" : file), classification: "selectedExportFacade",
  })),
  ...["apply-default-filters", "apply-params-as-filters", "clear-filters-by-key"].map(name => ({
    target: "packages/medusa-framework/src/http/middlewares/" + name + ".ts",
    source: upstream + "packages/core/framework/src/http/middlewares/" + name + ".ts", classification: "selectedExportFacade",
  })),
  ...storeProductTypePaths.map(file => ({ target: "packages/medusa-types/src/http/" + file,
    source: upstream + "packages/core/types/src/http/" + file, classification: "selectedExportFacade" })),
  { target: "packages/medusa-utils/src/modules-sdk/query-context.ts", source: upstream + "packages/core/utils/src/modules-sdk/query-context.ts", classification: "selectedExportFacade" },
];

/** @param {readonly {target: string, source?: string, classification: string}[]} files */
export function verifyStoreProductSelection(files) {
  for (const pair of storeProductSourcePairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0].source !== pair.source || selected[0].classification !== pair.classification)
      throw new Error("Store Product selection must retain its exact pinned source: " + pair.target);
  }
}

/** @param {string} source */
function runtime(source) {
  const emitted = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, emitted);
  /** @type {string[]} */
  const tokens = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
  return JSON.stringify(tokens.filter((token, index) => token !== "," || !["}", ")"].includes(tokens[index + 1])));
}

/** @param {string} source @param {readonly string[]} names */
function declarations(source, names) {
  const parsed = ts.createSourceFile("source.ts", source, ts.ScriptTarget.ESNext, true);
  return names.map(name => {
    const matches = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name ||
      ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1 && statement.declarationList.declarations[0].name.getText(parsed) === name);
    if (matches.length !== 1) throw new Error("Missing pinned Store Product declaration: " + name);
    return matches[0].getText(parsed);
  }).join("\n");
}

/** Native DTO declarations stay complete. Only direct type-import paths replace
 * broad barrels, so unselected Admin HTTP families are not promoted implicitly.
 * @param {string} native @param {string} target */
function relocateStoreTypes(native, target) {
  let expected = native.replaceAll("import {", "import type {");
  if (target.endsWith("product/store/entitites.ts")) {
    for (const family of ["collection", "product-category", "product-tag", "product-type"])
      expected = expected.replace('"../../' + family + '"', '"../../' + family + '/store/entities"');
  }
  if (target.endsWith("product/store/responses.ts")) expected = expected.replace('"../store"', '"./entitites"');
  if (target.endsWith("collection/store/responses.ts")) expected = expected.replace('from "."', 'from "./entities"');
  if (target.endsWith("collection/store/entities.ts") || target.endsWith("product-category/store/entities.ts"))
    expected = expected.replace('"../../product"', '"../../product/store/entitites"').replace('"../../product/store"', '"../../product/store/entitites"');
  return expected;
}

/** @param {string} native @param {string} promoted @param {string} target */
export function verifyStoreProductSource(native, promoted, target) {
  if (!storeProductSourcePairs.some(pair => pair.target === target)) throw new Error("Unselected Store Product source");
  const failure = "Changed native Store Product source: " + target;
  let expected = native.replaceAll("\r\n", "\n");
  if (target.startsWith("packages/medusa-types/src/http/") || target.endsWith("/store/types.ts") || target.endsWith("/modules-sdk/query-context.ts")) {
    expected = relocateStoreTypes(expected, target);
    if (target.endsWith("/modules-sdk/query-context.ts")) expected = expected.replaceAll("obj: any", "obj: Record<string, unknown>");
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    /** @param {string} text */
    const program = text => printer.printFile(ts.createSourceFile("types.ts", text, ts.ScriptTarget.ESNext, true));
    if (program(expected) !== program(promoted)) throw new Error(failure);
    return;
  }
  if (/\/store\/(?:collections|product-tags|product-types|product-categories)\/route\.ts$/.test(target)) {
    expected = expected.replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/common/container"');
  } else if (/\/store\/(?:collections|product-tags|product-types|product-categories)\/\[id\]\/route\.ts$/.test(target)) {
    expected = expected.replace('  ContainerRegistrationKeys,\n  MedusaError,\n} from "@medusajs/framework/utils"',
      '  ContainerRegistrationKeys,\n} from "@medusajs/utils/common/container"\nimport { MedusaError } from "@medusajs/utils/common/errors"');
  } else if (target.endsWith("/store/product-categories/middlewares.ts")) {
    expected = expected.replace('from "@medusajs/framework"', 'from "@medusajs/framework/http"');
  } else if (target.endsWith("/store/product-categories/helpers.ts")) {
    expected = declarations(native, ["applyCategoryFilters"]);
  } else if (target.endsWith("/store/products/route.ts")) {
    expected = expected.replace('import IndexEngineFeatureFlag from "../../../feature-flags/index-engine"\n', "").replaceAll("IndexEngineFeatureFlag.key", '"index_engine"')
      .replace('  ContainerRegistrationKeys,\n  FeatureFlag,\n  isPresent,\n  QueryContext,\n} from "@medusajs/framework/utils"',
        '  ContainerRegistrationKeys,\n} from "@medusajs/utils/common/container"\nimport { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"\nimport { isPresent } from "@medusajs/utils/common/is-present"\nimport { QueryContext } from "@medusajs/utils/modules-sdk/query-context"')
      .replace('from "../../utils/middlewares"', 'from "../../utils/middlewares/products/variant-inventory-quantity"');
  } else if (target.endsWith("/store/products/[id]/route.ts")) {
    expected = expected.replace('  ContainerRegistrationKeys,\n  MedusaError,\n  QueryContext,\n} from "@medusajs/framework/utils"',
      '  ContainerRegistrationKeys,\n} from "@medusajs/utils/common/container"\nimport { MedusaError } from "@medusajs/utils/common/errors"\nimport { QueryContext } from "@medusajs/utils/modules-sdk/query-context"')
      .replace('from "../../../utils/middlewares"', 'from "../../../utils/middlewares/products/variant-inventory-quantity"');
  } else if (target.endsWith("/store/products/middlewares.ts")) {
    expected = expected.replace('import IndexEngineFeatureFlag from "../../../feature-flags/index-engine"\n', "").replaceAll("IndexEngineFeatureFlag.key", '"index_engine"')
      .replace('  ContainerRegistrationKeys,\n  FeatureFlag,\n  isPresent,\n  ProductStatus,\n} from "@medusajs/framework/utils"',
        '  ContainerRegistrationKeys,\n} from "@medusajs/utils/common/container"\nimport { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"\nimport { isPresent } from "@medusajs/utils/common/is-present"\nimport { ProductStatus } from "@medusajs/utils/product/enums"')
      .replace('import {\n  filterByValidSalesChannels,\n  normalizeDataForContext,\n  setPricingContext,\n  setTaxContext,\n} from "../../utils/middlewares"',
        'import { filterByValidSalesChannels } from "../../utils/middlewares/products/filter-by-valid-sales-channels"\nimport { normalizeDataForContext } from "../../utils/middlewares/products/normalize-data-for-context"\nimport { setPricingContext } from "../../utils/middlewares/products/set-pricing-context"\nimport { setTaxContext } from "../../utils/middlewares/products/set-tax-context"');
  } else if (target.endsWith("/store/products/validators.ts")) {
    expected = 'import { GetProductsParams, StoreGetProductParamsDirectFields, transformProductParams } from "../../utils/common-validators/products"\n' +
      expected.replace("  GetProductsParams,\n", "").replace("  StoreGetProductParamsDirectFields,\n", "").replace("  transformProductParams,\n", "");
  } else if (target.endsWith("/store/products/helpers.ts")) {
    expected = ['import { applyTranslationsToTaxLines } from "@medusajs/utils/translations/apply-translations-to-tax-lines"',
      'import { calculateAmountsWithTax } from "@medusajs/utils/totals/tax/index"', 'import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"',
      'import { Modules } from "@medusajs/utils/modules-sdk/definition"',
      declarations(native, ["filterOutInternalProductCategories", "wrapProductsWithTaxPrices", "asTaxItem"]).replaceAll("TranslationFeatureFlag.key", '"translation"')].join("\n");
  } else if (target.endsWith("/products/variant-inventory-quantity.ts")) {
    expected = ['import { MedusaError } from "@medusajs/utils/common/errors"',
      'import { transformAndValidateSalesChannelIds } from "./filter-by-valid-sales-channels"', 'import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"',
      'import { getTotalVariantAvailability, getVariantAvailability } from "@medusajs/utils/product/get-variant-availability"',
      declarations(native, ["wrapVariantsWithTotalInventoryQuantity", "wrapVariants", "wrapVariantsWithInventoryQuantityForSalesChannel"])].join("\n");
  } else if (target.endsWith("/utils/common-validators.ts")) {
    expected = declarations(native, ["recursivelyNormalizeSchema"]);
    promoted = declarations(promoted, ["recursivelyNormalizeSchema"]);
  } else {
    expected = expected.replace('import { arrayDifference, MedusaError } from "@medusajs/framework/utils"',
      'import { arrayDifference } from "@medusajs/utils/common/array-difference"\nimport { MedusaError } from "@medusajs/utils/common/errors"')
      .replaceAll('import { MedusaError } from "@medusajs/framework/utils"', 'import { MedusaError } from "@medusajs/utils/common/errors"');
  }
  if (runtime(expected) !== runtime(promoted)) throw new Error(failure);
}
