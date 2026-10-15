import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeLocalProductCommands } from "../src/modules/product/service";
import { isGraphReadCommand } from "../src/local-graph/commands";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";

// The current private command contract, including registration order.
// Names and modes participate in host admission and replay identity.
const expected = [
  ["internalProductList","productInternalProductlist","read",false],
  ["internalProductRetrieve","productInternalProductretrieve","read",false],
  ["internalProductCreate","productInternalProductcreate","write",false],
  ["internalProductUpdate","productInternalProductupdate","write",false],
  ["internalProductSoftDelete","productInternalProductsoftDelete","write",false],
  ["internalProductRestore","productInternalProductrestore","write",false],
  ["internalCategoryList","productInternalCategorylist","read",false],
  ["internalCategoryRetrieve","productInternalCategoryretrieve","read",false],
  ["internalCategoryCount","productInternalCategorycount","read",false],
  ["internalCategoryCreate","productInternalCategorycreate","write",false],
  ["internalCategoryUpdate","productInternalCategoryupdate","write",false],
  ["internalCategoryDelete","productInternalCategorydelete","write",false],
  ["create","productCreate","write",false],
  ["list","productlist","read",true],
  ["retrieve","productretrieve","read",true],
  ["count","productcount","read",true],
  ["listCategories","productCategorylist","read",true],
  ["retrieveCategory","productCategoryretrieve","read",true],
  ["countCategories","productCategorycount","read",true],
  ["listTypes","productTypelist","read",true],
  ["retrieveType","productTyperetrieve","read",true],
  ["countTypes","productTypecount","read",true],
  ["listVariants","productVariantlist","read",true],
  ["retrieveVariant","productVariantretrieve","read",true],
  ["countVariants","productVariantcount","read",true],
  ["removeImageFromVariant","productDeleteassignment","write",false],
  ["softDeleteVariants","productSoftDeleteVariant","write",false],
  ["listOptions","productOptionlist","read",true],
  ["retrieveOption","productOptionretrieve","read",true],
  ["countOptions","productOptioncount","read",true],
  ["deleteOptions","productDeleteoption","write",false],
  ["listCollections","productCollectionlist","read",true],
  ["retrieveCollection","productCollectionretrieve","read",true],
  ["countCollections","productCollectioncount","read",true],
  ["listTags","productTaglist","read",true],
  ["retrieveTag","productTagretrieve","read",true],
  ["countTags","productTagcount","read",true],
  ["delete","productDeleteproduct","write",false],
  ["deleteTags","productDeletetag","write",false],
  ["deleteTypes","productDeletetype","write",false],
  ["deleteCategories","productDeletecategory","write",false],
  ["deleteCollections","productDeletecollection","write",false],
  ["softDelete","productSoftDelete","write",false],
  ["restore","productRestore","write",false],
  ["softDeleteTags","productSoftDeleteTag","write",false],
  ["createTags","productCreatetag","write",false],
  ["createTypes","productCreatetype","write",false],
  ["createCollections","productCreatecollection","write",false],
  ["createImages","productCreateimage","write",false],
  ["updateTags","productupdatetag","write",false],
  ["updateTagsBySelector","productUpdateTagsBySelector","write",false],
  ["updateTypes","productupdatetype","write",false],
  ["upsertTags","productupserttag","write",false],
  ["upsertTypes","productupserttype","write",false],
  ["update","productUpdate","write",false],
  ["upsert","productUpsert","write",false],
  ["upsertRelationships","productUpsertRelationships","write",false],
  ["createOptions","productCreateoption","write",false],
  ["createVariants","productCreatevariant","write",false],
  ["createCategories","productCreatecategory","write",false],
  ["addImageToVariant","productCreateassignment","write",false],
  ["updateOptions","productupdateoption","write",false],
  ["updateVariants","productupdatevariant","write",false],
  ["updateVariantsBySelector","productUpdateVariantsBySelector","write",false],
  ["updateVariantsForWorkflow","productUpdateVariantsForWorkflow","write",false],
  ["updateProductsForWorkflow","productUpdateProductsForWorkflow","write",false],
  ["softDeleteProductsForWorkflow","productSoftDeleteProductsForWorkflow","write",false],
  ["softDeleteVariantsForWorkflow","productSoftDeleteVariantsForWorkflow","write",false],
  ["countVariantsForDeletion","productVariantDeletionCount","read",true],
  ["countImages","productImagecount","read",true],
  ["updateValues","productupdatevalue","write",false],
  ["updateCollections","productupdatecollection","write",false],
  ["updateCategories","productupdatecategory","write",false],
  ["upsertOptions","productupsertoption","write",false],
  ["upsertVariants","productupsertvariant","write",false],
  ["upsertCollections","productupsertcollection","write",false],
  ["upsertCategories","productupsertcategory","write",false],
] as const;

type Product = Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let product: Product;
beforeAll(async () => { product = await Effect.runPromise(makeLocalProductCommands()); });

describe("prepared Product command assembly", () => {
  it("preserves every registered command name, mode, order and graph marker", () => {
    expect(Object.keys(product)).toEqual(["metadata", "commands", "withService", "graph", "workflow",
      "variantUpdateWorkflow", "productUpdateWorkflow", "productDeletionWorkflow", "logicalPolicy"]);
    expect(Object.isFrozen(product.commands)).toBe(true);
    expect(Object.entries(product.commands).map(([key, command]) => {
      const identity = commerceCommandIdentity(command);
      return [key, identity?.name, identity?.mode, isGraphReadCommand(command)];
    })).toEqual(expected);
    expect(new Set(Object.values(product.commands)).size).toBe(expected.length);
  });

  it("binds graph reads and workflow methods to this assembly's exact tokens", () => {
    const commands = product.commands;
    expect(product.graph.reads.map(read => read.command)).toEqual([
      commands.count, commands.countCategories, commands.countCollections, commands.countTypes,
      commands.countTags, commands.countOptions, commands.countVariants, commands.countImages,
    ]);
    const definition = workflowModuleDefinition(product.workflow);
    expect(definition?.source).toEqual({ name: "flarex-product-local", profile: "public" });
    expect(definition?.graph.reads.map(read => read.command)).toEqual(product.graph.reads.map(read => read.command));
    const methods = product.workflow.methods;
    expect(workflowMethodDefinition(methods.createProductTags)?.command).toBe(commands.createTags);
    expect(workflowMethodDefinition(methods.softDeleteProductTags)?.command).toBe(commands.softDeleteTags);
    expect(workflowMethodDefinition(methods.updateProductTags)?.command).toBe(commands.updateTagsBySelector);
    expect(workflowMethodDefinition(methods.addImageToVariant)?.command).toBe(commands.addImageToVariant);
    expect(workflowModuleDefinition(product.variantUpdateWorkflow)?.source).toEqual({ name: "flarex-product-local", profile: "public.variant-update" });
    expect(workflowModuleDefinition(product.productUpdateWorkflow)?.source).toEqual({ name: "flarex-product-local", profile: "public.product-update" });
    expect(workflowModuleDefinition(product.productDeletionWorkflow)?.source).toEqual({ name: "flarex-product-local", profile: "public.product-deletion" });
    for (const module of [product.variantUpdateWorkflow, product.productUpdateWorkflow])
      expect(workflowModuleDefinition(module)?.graph.reads.map(read => read.command)).toEqual(product.graph.reads.map(read => read.command));
    expect(workflowModuleDefinition(product.productDeletionWorkflow)?.graph.reads.map(read => read.command))
      .toEqual([commands.count, commands.countVariantsForDeletion]);
    expect(workflowMethodDefinition(product.variantUpdateWorkflow.methods.listProductVariants)?.command).toBe(commands.listVariants);
    expect(workflowMethodDefinition(product.variantUpdateWorkflow.methods.upsertProductVariants)?.command).toBe(commands.upsertVariants);
    expect(workflowMethodDefinition(product.variantUpdateWorkflow.methods.updateProductVariants)?.command).toBe(commands.updateVariantsForWorkflow);
    expect(workflowMethodDefinition(product.productUpdateWorkflow.methods.listProducts)?.command).toBe(commands.list);
    expect(workflowMethodDefinition(product.productUpdateWorkflow.methods.upsertProducts)?.command).toBe(commands.upsert);
    expect(workflowMethodDefinition(product.productUpdateWorkflow.methods.updateProducts)?.command).toBe(commands.updateProductsForWorkflow);
    expect(workflowMethodDefinition(product.productDeletionWorkflow.methods.listProducts)?.command).toBe(commands.list);
    expect(workflowMethodDefinition(product.productDeletionWorkflow.methods.softDeleteProducts)?.command).toBe(commands.softDeleteProductsForWorkflow);
    expect(workflowMethodDefinition(product.productDeletionWorkflow.methods.softDeleteProductVariants)?.command).toBe(commands.softDeleteVariantsForWorkflow);
    expect(workflowMethodDefinition(product.productDeletionWorkflow.methods.softDeleteProducts)?.moduleEvents).toEqual([
      product.metadata.product, product.metadata.image, product.metadata.option, product.metadata.value, product.metadata.variant,
    ].map(entity => entity.deletedEvent).sort());
    expect(workflowMethodDefinition(product.productDeletionWorkflow.methods.softDeleteProductVariants)?.moduleEvents).toEqual([product.metadata.variant.deletedEvent]);
    for (const module of [product.workflow, product.variantUpdateWorkflow, product.productUpdateWorkflow, product.productDeletionWorkflow]) {
      for (const method of Object.values(module.methods))
        expect(Object.values(commands)).toContain(workflowMethodDefinition(method)?.command);
    }
  });

  it("keeps independent preparations and their command identities isolated", async () => {
    const second = await Effect.runPromise(makeLocalProductCommands());
    const firstTokens = new Set(Object.values(product.commands));
    for (const command of Object.values(second.commands)) expect(firstTokens.has(command)).toBe(false);
    for (const read of second.graph.reads) expect(firstTokens.has(read.command)).toBe(false);
    for (const module of [second.workflow, second.variantUpdateWorkflow, second.productUpdateWorkflow, second.productDeletionWorkflow]) {
      for (const method of Object.values(module.methods)) {
        const definition = workflowMethodDefinition(method);
        if (definition === undefined) throw new Error("Expected an authentic workflow method");
        expect(Object.values(second.commands)).toContain(definition.command);
        expect(firstTokens.has(definition.command)).toBe(false);
      }
      for (const read of workflowModuleDefinition(module)?.graph.reads ?? []) {
        expect(Object.values(second.commands)).toContain(read.command);
        expect(firstTokens.has(read.command)).toBe(false);
      }
    }
    expect(second.withService).not.toBe(product.withService);
  });
});
