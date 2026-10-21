// @ts-check
import ts from "@typescript/typescript6";

export const pricingRepositoryNormalizationSource = [
  "packages/medusa-utils/src/dal/mikro-orm/mikro-orm-repository.ts",
  "third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/mikro-orm-repository.ts",
];
const failure = "Changed approved native PriceList Price normalization";

/** The immutable island remains original. Only the approved snapshot and
 * redundant temporary-create scalar alias seams may differ in the promoted DAL.
 * @param {string} source @param {string} target @param {string} helper */
export function verifyNativePriceListPriceNormalization(source, target, helper) {
  const replacements = [
    ["const normalizedData = dataForRelation.map((item: any) => {", "const normalizedData = Array.from(dataForRelation).map((item: any) => {"],
    ["      const created = manager.create(\n        entityName,\n        { ...data, id: undefined },",
      "      const dataToCreate = { ...data, id: undefined }\n      Object.entries(manager.getMetadata<Record<string, unknown>>(entityName).properties)\n        .filter(\n          ([_, propDef]) =>\n            propDef.persist === false &&\n            propDef.kind === ReferenceKind.MANY_TO_ONE &&\n            propDef.joinColumns?.length &&\n            propDef.joinColumns.every(\n              (column) => dataToCreate[column] !== undefined\n            )\n        )\n        .forEach(([key]) => {\n          delete dataToCreate[key]\n        })\n\n      const created = manager.create(\n        entityName,\n        dataToCreate,"],
  ];
  let expected = source.replaceAll("\r\n", "\n");
  for (const [before, after] of replacements) {
    if (before === undefined || after === undefined || expected.split(before).length !== 2) throw new Error(failure);
    expected = expected.replace(before, after);
  }
  const parsed = ts.createSourceFile("native-repository.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @param {ts.Node} node @param {(node:ts.Node)=>boolean} predicate */
  const find = (node, predicate) => {
    /** @type {ts.Node[]} */ const found = [];
    /** @param {ts.Node} child */ const visit = child => { if (predicate(child)) found.push(child); ts.forEachChild(child, visit); };
    visit(node); if (found.length !== 1 || found[0] === undefined) throw new Error(failure); return found[0];
  };
  const factory = find(parsed, node => ts.isFunctionDeclaration(node) && node.name?.text === "mikroOrmBaseRepositoryFactory");
  if (!ts.isFunctionDeclaration(factory) || factory.body === undefined) throw new Error(failure);
  const owners = factory.body.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "MikroOrmAbstractBaseRepository_");
  const owner = owners[0];
  if (owners.length !== 1 || owner === undefined || !ts.isClassDeclaration(owner)) throw new Error(failure);
  /** @param {string} name */
  const method = name => {
    const methods = owner.members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name);
    if (methods.length !== 1 || methods[0] === undefined) throw new Error(failure);
    return methods[0];
  };
  const upsert = method("upsertWithReplace"), batch = method("upsertMany_");
  /** @param {ts.Node} owner @param {string} name */
  const variable = (owner, name) => {
    const found = find(owner, node => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
    if (!ts.isVariableDeclaration(found) || found.initializer === undefined || !ts.isVariableStatement(found.parent.parent)) throw new Error(failure);
    return { declaration: found, statement: found.parent.parent, text: found.parent.parent.getText(parsed) };
  };
  /** @param {ts.Node} owner @param {string} receiver */
  const each = (owner, receiver) => {
    const found = find(owner, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(parsed) === receiver && node.expression.name.text === "forEach");
    if (!ts.isCallExpression(found)) throw new Error(failure); return found.getText(parsed);
  };
  /** @param {string} before @param {string} after */
  const replace = (before, after) => { if (expected.split(before).length !== 2) throw new Error(failure + ": extraction anchor " + before.slice(0, 100)); expected = expected.replace(before, after); };
  const top = variable(upsert, "toUpsert"), relation = variable(upsert, "entitiesForRelation");
  const mapping = top.declaration.initializer;
  if (!mapping || !ts.isCallExpression(mapping) || !mapping.arguments[0] || !ts.isArrowFunction(mapping.arguments[0]) || !ts.isBlock(mapping.arguments[0].body)) throw new Error(failure);
  const body = mapping.arguments[0].body.statements;
  if (body.length !== 7) throw new Error(failure);
  const push = body[4]?.getText(parsed), originalMap = body[5]?.getText(parsed), returnEntity = body[6]?.getText(parsed);
  if (!push || !originalMap || !returnEntity) throw new Error(failure);
  replace(variable(upsert, "reconstructedResponse").text, ""); replace(variable(upsert, "originalDataMap").text, "");
  replace(top.text, `const { toUpsert, originalDataMap, reconstructedResponse: reconstructedRows } = prepareUpsertWithReplaceEntries(normalizedData, (entry) => {
${body.slice(0, 4).map(statement => statement.getText(parsed)).join("\n")}
return { entity: mainEntity, relations: reconstructedEntry }
})
const reconstructedResponse: any[] = reconstructedRows`);
  replace(relation.text, "const entitiesForRelation = planUpsertRelationEntries(upsertedTopLevelEntities, originalDataMap, reconstructedResponse, relationName as string)");
  const apply = each(upsert, "entitiesResults"); replace(apply, "applyUpsertRelationResults(reconstructedResponse, relationName, entitiesResults)");
  const uniqueMap = variable(batch, "uniqueEntriesMap"), uniqueRows = variable(batch, "orderedUniqueEntries"), uniqueEach = each(batch, "entries");
  replace(uniqueMap.text, ""); replace(uniqueRows.text, "const orderedUniqueEntries = uniqueUpsertEntries(entries)"); replace(uniqueEach, "");
  const partitionNames = ["orderedEntities", "toInsert", "toUpdate", "insertOrderMap", "updateOrderMap"];
  const partitionDeclarations = partitionNames.map(name => variable(batch, name).text);
  for (const statement of partitionDeclarations) replace(statement, "");
  const partitionEach = each(batch, "orderedUniqueEntries");
  replace(partitionEach, "const { orderedEntities, toInsert, toUpdate, insertOrderMap, updateOrderMap } = planUpsertManyEntries(orderedUniqueEntries, existingEntitiesMap, skipUpdate)");
  replace('import { transactionWrapper } from "../utils"', 'import { transactionWrapper } from "../utils"\nimport { applyUpsertRelationResults, planUpsertManyEntries, planUpsertRelationEntries, prepareUpsertWithReplaceEntries, uniqueUpsertEntries } from "../upsert-planning"');
  const relationExpression = relation.declaration.initializer?.getText(parsed).replace("upsertedTopLevelEntities", "orderedEntities")
    .replaceAll("(entityEntry as any).id", "entityEntry.id").replace("relationName as string", "relationName");
  if (!relationExpression) throw new Error(failure);
  const expectedHelper = `export function prepareUpsertWithReplaceEntries<Source extends Record<string, unknown>, Entity extends Record<string, unknown> & { id: string }>(
  sources: readonly Source[], prepare: (source: Source) => { entity: Entity; relations: Record<string, unknown> }) {
  const reconstructedResponse: Record<string, unknown>[] = []
  const originalDataMap = new Map<string, Source>()
  const toUpsert = sources.map((entry) => {
    const { entity: mainEntity, relations: reconstructedEntry } = prepare(entry)
    ${push}
    ${originalMap}
    ${returnEntity}
  })
  return { toUpsert, reconstructedResponse, originalDataMap }
}
export function uniqueUpsertEntries<Entry extends { id: string }>(entries: readonly Entry[]) {
  ${uniqueMap.text.replace("Map<string, any>", "Map<string, Entry>")}
  ${uniqueRows.text.replace("any[]", "Entry[]")}
  ${uniqueEach}
  return orderedUniqueEntries
}
export function planUpsertManyEntries<Entry extends { id: string }>(orderedUniqueEntries: readonly Entry[], existingEntitiesMap: ReadonlyMap<string, unknown>, skipUpdate = false) {
  ${partitionDeclarations.map(text => text.replace("T[]", "Entry[]").replace("any[]", "Entry[]")).join("\n")}
  ${partitionEach}
  return { orderedEntities, toInsert, toUpdate, insertOrderMap, updateOrderMap }
}
export function planUpsertRelationEntries<Source extends Record<string, unknown>>(orderedEntities: readonly { id: string }[], originalDataMap: ReadonlyMap<string, Source>, reconstructedResponse: readonly Record<string, unknown>[], relationName: string) {
  return ${relationExpression}
}
export function applyUpsertRelationResults(reconstructedResponse: Record<string, unknown>[], relationName: string, entitiesResults: readonly { entities: unknown; index: number }[]) {
  ${apply.replace("reconstructedResponse[index][relationName]", "reconstructedResponse[index]![relationName]")}
}`;
  /** @type {readonly (readonly [string, string, string])[]} */
  const comparisons = [["repository", target, expected], ["helper", helper, expectedHelper]];
  for (const [owner, actual, expectedSource] of comparisons) {
    const actualLines = program(actual).split("\n"), expectedLines = program(expectedSource).split("\n");
    const mismatch = expectedLines.findIndex((line, index) => line !== actualLines[index]);
    if (mismatch !== -1 || actualLines.length !== expectedLines.length)
      throw new Error(failure + ": " + owner + " line " + (mismatch + 1) + "; expected " + expectedLines[mismatch]?.slice(0, 160) + "; actual " + actualLines[mismatch]?.slice(0, 160));
  }
}

/** @param {string} text */
function program(text) {
  const source = ts.createSourceFile("native-price-list-prices.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(source);
}

/** Authority comparisons retain the complete typed and emitted trees. Printer
 * output alone retains object-literal line layout, which is not authority.
 * @param {string} text */
function authorityProgram(text) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
    throw new Error("Changed PriceList Price creation resource selection");
  /** @param {ts.Node} node @returns {unknown} */
  const shape = node => {
    /** @type {unknown[]} */ const children = [];
    ts.forEachChild(node, child => { children.push(shape(child)); });
    return [node.kind, ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : undefined,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : undefined,
      ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : undefined,
      ts.isTemplateLiteralToken(node) ? node.rawText : undefined,
      ts.isMetaProperty(node) ? node.keywordToken : undefined,
      ts.isImportAttributes(node) ? node.token : undefined,
      ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isExportDeclaration(node) || ts.isExportSpecifier(node)
        ? node.isTypeOnly : undefined, children];
  };
  return JSON.stringify([
    shape(ts.createSourceFile("selection.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
    shape(ts.createSourceFile("selection.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)),
  ]);
}

/** Both parallel validators, original normalization calls, actual retained IDs
 * and physical inverse remain native; only portable imports and compensation
 * coverage metadata are admitted.
 * @param {string} nativeRoot @param {string} root
 * @param {string} nativeStep @param {string} step */
export function verifyPriceListPriceCreationCallbacks(nativeRoot, root, nativeStep, step) {
  /** @param {string} text */
  const relocate = text => text.replaceAll("\r\n", "\n")
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  const anchor = "  createPriceListPricesStepId,";
  if (nativeStep.split(anchor).length !== 2) throw new Error("Changed native PriceList Price callback behavior");
  // The native validator returns undefined for empty data. Reflect that actual
  // DSL dependency in the local input type, and narrow only its native inner
  // dereference. Both adaptations erase; missing-map nonempty work still throws.
  const expectedStep = relocate(nativeStep)
    .replace('export const createPriceListPricesStepId = "create-price-list-prices"', `export const createPriceListPricesStepId = "create-price-list-prices"
type CreatePriceListPricesStepInput = Omit<CreatePriceListPricesWorkflowStepDTO, "variant_price_map"> & { variant_price_map: Record<string, string> | undefined }`)
    .replace(anchor, '  { name: createPriceListPricesStepId, compensation: "transactionCovered" },')
    .replace("stepInput: CreatePriceListPricesWorkflowStepDTO", "stepInput: CreatePriceListPricesStepInput")
    .replace("variantPriceSetMap[price.variant_id!]", "variantPriceSetMap![price.variant_id!]");
  const expectedRoot = relocate(nativeRoot);
  if (program(expectedRoot) !== program(root) || program(expectedStep) !== program(step))
    throw new Error("Changed native PriceList Price callback behavior");
}

/** Preserve the complete original removal programs, including erased types.
 * Only existing portable imports and atomic compensation coverage may differ.
 * Ordering and persistence admission belong to the separate adapter profile.
 * @param {string} nativeRoot @param {string} root
 * @param {string} nativeStep @param {string} step */
export function verifyPriceListPriceRemovalCallbacks(nativeRoot, root, nativeStep, step) {
  const failure = "Changed native PriceList Price removal callback behavior";
  /** @param {string} text */
  const relocate = text => text.replaceAll("\r\n", "\n")
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  const anchor = "  removePriceListPricesStepId,";
  const original = nativeStep.replaceAll("\r\n", "\n");
  if (original.split(anchor).length !== 2) throw new Error(failure);
  const expectedStep = relocate(original).replace(anchor,
    '  { name: removePriceListPricesStepId, compensation: "transactionCovered" },');
  if (authorityProgram(relocate(nativeRoot)) !== authorityProgram(root) ||
    authorityProgram(expectedStep) !== authorityProgram(step)) throw new Error(failure);
}

/** Bind the private157 host to its Pricing-only facade and the unchanged
 * default commerce allowance. This selects authority, not native business code.
 * @param {string} facade @param {string} policy */
export function verifyPriceListPriceRemovalSelection(facade, policy) {
  const failure = "Changed PriceList Price removal resource selection";
  if (authorityProgram(facade) !== authorityProgram(expectedRemovalSelection)) throw new Error(failure);
  const file = ts.createSourceFile("policy.ts", policy, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declarations = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .filter(node => ts.isIdentifier(node.name) && node.name.text === "priceListPriceRemovalResources");
  const declaration = declarations[0], statement = declaration?.parent.parent;
  const imports = file.statements.filter(ts.isImportDeclaration).filter(node =>
    node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings) &&
    node.importClause.namedBindings.elements.some(element => element.name.text === "defaultCommerceResources"));
  if (declarations.length !== 1 || statement === undefined || !ts.isVariableStatement(statement) ||
    statement.declarationList.declarations.length !== 1 || imports.length !== 1 || imports[0] === undefined ||
    authorityProgram(imports[0].getText(file)) !== authorityProgram('import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";') ||
    authorityProgram(statement.getText(file)) !== authorityProgram('export const priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources });'))
    throw new Error(failure);
}

const expectedRemovalSelection = `import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { removePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/remove-price-list-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PriceListPriceRemovalWorkflowInput } from "../../modules/pricing/price-list-price-removal-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListPriceRemovalResources } from "../../workflow/policy";
export const prepareRemovePriceListPricesWorkflow = Effect.fn("PricingWorkflow.removePriceListPrices")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "pricing", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules({ pricing: options.pricing }, ["pricing"]));
  const definition = workflowModuleDefinition(installed.pricing.module);
  if (definition?.source.name !== "flarex-pricing-local" || definition.source.profile !== "pricing-price-list-price-removals")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.pricing.logicalResources !== undefined && !jsonEqual(installed.pricing.logicalResources, priceListPriceRemovalResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { pricing: { ...installed.pricing, logicalResources: priceListPriceRemovalResources,
    logicalPublication: "mixed" as const } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ pricing: {
    module: modules.pricing.module, methods: ["listPrices", "softDeletePrices", "restorePrices"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(removePriceListPricesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceRemovalResources.calls,
    workflow: { name: "removePriceListPricesWorkflow", resources, prepared, input: PriceListPriceRemovalWorkflowInput,
      output: PriceListPriceRemovalWorkflowInput.fields.ids, events: internalModuleWorkflowEvents },
  });
});`;

// The named facade is a trusted authority selection, not native business code.
// Bind its complete declaration below; the promotion manifest separately binds
// imports, package ownership and target bytes.
/** @param {string} facade @param {string} policy */
export function verifyPriceListPriceCreationSelection(facade, policy) {
  const parsed = ts.createSourceFile("price-list-price-selection.ts", facade, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const selected = parsed.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations)
    .filter(node => ts.isIdentifier(node.name) && node.name.text === "prepareCreatePriceListPricesWorkflow");
  const initializer = selected[0]?.initializer;
  const statement = selected[0]?.parent.parent, imports = parsed.statements.filter(ts.isImportDeclaration);
  if (selected.length !== 1 || initializer === undefined || statement === undefined || !ts.isVariableStatement(statement) ||
    (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
    parsed.statements.length !== imports.length + 1 || statement.declarationList.declarations.length !== 1 ||
    authorityProgram(imports.map(node => node.getText(parsed)).join("\n")) !== authorityProgram(expectedImports) ||
    authorityProgram(statement.getText(parsed)) !== authorityProgram(expectedSelection.replace("const selection =",
      "export const prepareCreatePriceListPricesWorkflow =")))
    throw new Error("Changed PriceList Price creation resource selection");
  const policyFile = ts.createSourceFile("policy.ts", policy, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const allowances = policyFile.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations)
    .filter(node => ts.isIdentifier(node.name) && node.name.text === "priceListPriceCreationResources");
  const allowance = allowances[0], owner = allowance?.parent.parent;
  const defaults = policyFile.statements.filter(ts.isImportDeclaration).filter(node =>
    node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings) &&
    node.importClause.namedBindings.elements.some(element => element.name.text === "defaultCommerceResources"));
  if (allowances.length !== 1 || allowance?.initializer === undefined || owner === undefined || !ts.isVariableStatement(owner) ||
    owner.declarationList.declarations.length !== 1 || (owner.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    !owner.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
    defaults.length !== 1 || defaults[0] === undefined ||
    authorityProgram(defaults[0].getText(policyFile)) !== authorityProgram('import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";') ||
    authorityProgram(owner.getText(policyFile)) !==
      authorityProgram("export const priceListPriceCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });"))
    throw new Error("Changed PriceList Price creation resource selection");
}

const expectedImports = `import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { createPriceListPricesWorkflow } from "@medusajs/core-flows/price-list/create-price-list-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { PriceListPriceCreationWorkflowInput, compilePriceListPriceCreationContracts } from "../../modules/pricing/price-list-price-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareVariantPricingLink } from "../../links/variant-pricing-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListPriceCreationResources } from "../../workflow/policy";`;
const expectedSelection = `const selection = Effect.fn("PricingWorkflow.createPriceListPrices")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
    readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareVariantPricingLink>>["workflow"]>;
  };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["pricing", "link"]));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const pricing = workflowModuleDefinition(installed.pricing.module), link = workflowModuleDefinition(installed.link.module);
  if (pricing?.source.name !== "flarex-pricing-local" || pricing.source.profile !== "pricing-price-list-price-creations" ||
    link?.source.profile !== "medusa.variant-pricing.link-workflow")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const binding of [installed.pricing, installed.link]) {
    if (binding.logicalResources !== undefined && !jsonEqual(binding.logicalResources, priceListPriceCreationResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const modules = {
    pricing: { ...installed.pricing, logicalResources: priceListPriceCreationResources, logicalPublication: "mixed" as const },
    link: { ...installed.link, logicalResources: priceListPriceCreationResources },
  };
  const contracts = yield* Effect.fromResult(compilePriceListPriceCreationContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["listPriceLists", "addPriceListPrices", "removePrices"], graph: false },
    link: { module: modules.link.module, methods: [], graph: true, expose: false },
  }, true));
  const prepared = yield* Effect.fromResult(createPriceListPricesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    revision: options.revision, subscribers: options.subscribers, requestCallLimit: priceListPriceCreationResources.calls, workflow: {
      name: "createPriceListPricesWorkflow", resources, prepared, input: PriceListPriceCreationWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents,
    } });
});`;


/** The original158 parent composes the three retained native child workflows. */
export const priceListPriceBatchSourcePair = {
  source: "third_party/medusa/upstream/packages/core/core-flows/src/price-list/workflows/batch-price-list-prices.ts",
  target: "packages/medusa-core-flows/src/price-list/workflows/batch-price-list-prices.ts",
};

/** Preserve the complete typed and emitted parent, including native parallel
 * child calls, empty-entry transforms and named result slots. Only portable
 * package aliases may differ; the existing child guards own their semantics.
 * @param {string} nativeRoot @param {string} root */
export function verifyPriceListPriceBatchCallbacks(nativeRoot, root) {
  const expected = nativeRoot.replaceAll("\r\n", "\n")
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  if (authorityProgram(expected) !== authorityProgram(root))
    throw new Error("Changed native PriceList Price batch callback behavior");
}


/** Bind the158 host to one combined Pricing participant and the existing
 * read-only stored Link Query, with the approved limit of 256 calls and other defaults.
 * @param {string} facade @param {string} policy */
export function verifyPriceListPriceBatchSelection(facade, policy) {
  const failure = "Changed PriceList Price batch resource selection";
  if (authorityProgram(facade) !== authorityProgram(expectedBatchSelection)) throw new Error(failure);
  const file = ts.createSourceFile("policy.ts", policy, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declarations = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .filter(node => ts.isIdentifier(node.name) && node.name.text === "priceListPriceBatchResources");
  const declaration = declarations[0], statement = declaration?.parent.parent;
  const imports = file.statements.filter(ts.isImportDeclaration).filter(node =>
    node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings) &&
    node.importClause.namedBindings.elements.some(element => element.name.text === "defaultCommerceResources"));
  if (declarations.length !== 1 || statement === undefined || !ts.isVariableStatement(statement) ||
    statement.declarationList.declarations.length !== 1 || imports.length !== 1 || imports[0] === undefined ||
    authorityProgram(imports[0].getText(file)) !== authorityProgram('import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";') ||
    authorityProgram(statement.getText(file)) !== authorityProgram('export const priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });'))
    throw new Error(failure);
}

const expectedBatchSelection = `import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { batchPriceListPricesWorkflow } from "@medusajs/core-flows/price-list/batch-price-list-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { PriceListPriceBatchWorkflowInput, compilePriceListPriceBatchContracts } from "../../modules/pricing/price-list-price-batch-input";
import type { makePriceListPriceBatchCommands } from "../../modules/pricing/price-list-price-batch-service";
import type { prepareVariantPricingLink } from "../../links/variant-pricing-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListPriceBatchResources } from "../../workflow/policy";

/** Original parallel children share one outer settlement owner. Their native
 * service/repository modes remain fixed by each selected command's issuer. */
export const prepareBatchPriceListPricesWorkflow = Effect.fn("PricingWorkflow.batchPriceListPrices")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makePriceListPriceBatchCommands>>["workflow"]>;
    readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareVariantPricingLink>>["workflow"]>;
  };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["pricing", "link"]));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const pricing = workflowModuleDefinition(installed.pricing.module), link = workflowModuleDefinition(installed.link.module);
  if (pricing?.source.name !== "flarex-pricing-local" || pricing.source.profile !== "pricing-price-list-price-batch" ||
    link?.source.profile !== "medusa.variant-pricing.link-workflow")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const binding of [installed.pricing, installed.link]) {
    if (binding.logicalResources !== undefined && !jsonEqual(binding.logicalResources, priceListPriceBatchResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const modules = {
    pricing: { ...installed.pricing, logicalResources: priceListPriceBatchResources, logicalPublication: "mixed" as const },
    link: { ...installed.link, logicalResources: priceListPriceBatchResources },
  };
  const contracts = yield* Effect.fromResult(compilePriceListPriceBatchContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["listPriceLists", "addPriceListPrices", "removePrices",
      "snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePriceListPrices", "listPrices", "softDeletePrices", "restorePrices"], graph: false },
    link: { module: modules.link.module, methods: [], graph: true, expose: false },
  }, true));
  const prepared = yield* Effect.fromResult(batchPriceListPricesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    revision: options.revision, subscribers: options.subscribers, requestCallLimit: priceListPriceBatchResources.calls,
    workflow: { name: "batchPriceListPricesWorkflow", resources, prepared, input: PriceListPriceBatchWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents },
  });
});
`;


/** The combined profile only selects existing authenticated methods and routes
 * each exact command object through its original issuer's logical validator.
 * It adds no transaction owner or replacement business implementation.
 * @param {string} source */
export function verifyPriceListPriceBatchService(source) {
  if (authorityProgram(source) !== authorityProgram(expectedBatchServiceSelection))
    throw new Error("Changed PriceList Price batch service selection");
}

const expectedBatchServiceSelection = `import { Effect } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommand, LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineWorkflowModule, workflowMethodDefinition, workflowModuleDefinition } from "../../workflow/module";
import { makeLocalPricingCommands } from "./service";

/** One installed Pricing participant retains each child's original commands,
 * repositories and receipt issuer. The parent adds no transaction boundary. */
export const makePriceListPriceBatchCommands = Effect.fn("PricingAdapter.priceListPriceBatchCommands")(function* () {
  const creation = yield* makeLocalPricingCommands("price-list-price-creations");
  const update = yield* makeLocalPricingCommands("price-list-price-updates");
  const removal = yield* makeLocalPricingCommands("price-list-price-removals");
  const creationPolicy = workflowModuleDefinition(creation.workflow)?.logical;
  const updatePolicy = workflowModuleDefinition(update.workflow)?.logical;
  const removalPolicy = workflowModuleDefinition(removal.workflow)?.logical;
  if (creationPolicy === undefined || updatePolicy === undefined || removalPolicy === undefined ||
    creationPolicy.validateLogical !== undefined || updatePolicy.validateLogical !== undefined || removalPolicy.validateLogical !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods;
  const { snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods;
  const { listPrices, softDeletePrices, restorePrices } = removal.workflow.methods;
  if (listPriceLists === undefined || addPriceListPrices === undefined || removePrices === undefined ||
    snapshotPriceListPricesForUpdate === undefined || updatePriceListPrices === undefined || restorePriceListPrices === undefined ||
    listPrices === undefined || softDeletePrices === undefined || restorePrices === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const methods = { listPriceLists, addPriceListPrices, removePrices, snapshotPriceListPricesForUpdate,
    updatePriceListPrices, restorePriceListPrices, listPrices, softDeletePrices, restorePrices };
  const groups = [
    { methods: [listPriceLists, addPriceListPrices, removePrices], policy: creationPolicy },
    { methods: [snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices], policy: updatePolicy },
    { methods: [listPrices, softDeletePrices, restorePrices], policy: removalPolicy },
  ];
  const commands: CommerceCommand[] = [];
  const owners = new Map<CommerceCommand, LogicalCommerceCallValidation>();
  for (const group of groups) for (const method of group.methods) {
    const definition = workflowMethodDefinition(method);
    if (definition === undefined || !group.policy.commands.includes(definition.command) ||
      owners.has(definition.command)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    commands.push(definition.command); owners.set(definition.command, group.policy.validateLogicalCall);
  }
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("PricingBatch.validateChildCall")(function* (call, activity, command) {
    const validate = owners.get(command);
    if (validate === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    // Forward the exact command object through its original module's issuer
    // check as well as the combined module's enclosing issuer check.
    yield* validate(call, activity, command);
  });
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: Modules.PRICING,
    source: { name: "flarex-pricing-local", profile: "pricing-price-list-price-batch" }, methods,
    graph: { aliases: [], reads: [] }, logical: { commands, capture: creationPolicy.capture, validateLogicalCall,
      allowStorageInsertionOrder: true, allowRecordedRowReplay: true, allowPreservingDeletionUpsert: "preserveTimestamps" },
  }));
  return { workflow, commands };
});
`;
