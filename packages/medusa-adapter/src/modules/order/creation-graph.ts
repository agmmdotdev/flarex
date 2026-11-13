import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import type { CreationNode, CreationProfile, GraphCatalog } from "../../write/graph-model";
import type { compileOrderCreationContracts } from "./finance-contracts";
import type { SchemaTable } from "../../schema/model";

const decodeJsonObject = commerceDecoder(Schema.JsonObject, "unsupportedProfile");

/** Checked native DML ownership supplies insertion dependencies. The Order
 * service still owns wrapping Shipping Methods and separate Line Item calls. */
export function prepareOrderCreationGraphs(contracts: Result.Result.Success<ReturnType<typeof compileOrderCreationContracts>>,
  tables: readonly SchemaTable[], profile: "creation" | "checkout") {
  return Result.gen(function* () {
    type Entity = typeof contracts.entities[number];
    const graphEntity = (entity: Entity) => ({ table: entity.table, model: entity.model, keyColumn: "id",
      prefix: entity.table.columns.find(column => column.name === "id")?.options?.prefix });
    const leaf = (entity: Entity): CreationNode => ({ entity: graphEntity(entity), omitRelations: [], steps: [] });
    const child = (owner: Entity, name: string, target: Entity, foreignKey: string, node: CreationNode) => Result.gen(function* () {
      if (!owner.table.relationships.some(relation => relation.name === name && relation.type === "hasMany" && relation.targetTable === target.table.name) ||
        !target.table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === foreignKey &&
          key.referencedTable === owner.table.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      return { kind: "children" as const, name, foreignKey, node };
    });
    const order = yield* contracts.entity("order"), summary = yield* contracts.entity("order_summary");
    let orderNode: CreationNode = { entity: graphEntity(order), omitRelations: ["summary"], steps: [
      yield* child(order, "summary", summary, "order_id", leaf(summary)),
    ] };
    const orderEntities = [order, summary], profiles = new Map<string, CreationProfile>();
    const make = (root: CreationNode, entities: readonly Entity[]): CreationProfile => {
      const nodes = new Map<string, CreationNode>();
      const visit = (node: CreationNode) => { nodes.set(node.entity.table.name, node); for (const step of node.steps) if (step.kind !== "references") visit(step.node); };
      visit(root);
      const decoders = new Map(entities.flatMap(contract => {
        const node = nodes.get(contract.table.name);
        if (node === undefined) return [];
        const names = [...contract.table.columns.filter(column => !["id", "display_id", "created_at", "updated_at", "deleted_at"].includes(column.name)).map(column => column.name), ...node.omitRelations];
        return [[contract.table.name, commerceRowDecoder(names, "unsupportedProfile")] as const];
      }));
      const catalog: GraphCatalog = { entities: entities.map(graphEntity), tables, writablePivots: [], queryRelations: new Map(),
        decodeRow: (current, input) => Result.gen(function* () {
          const decode = decoders.get(current.table.name);
          if (decode === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          const supplied = yield* decode(input).pipe(Result.flatMap(decodeJsonObject));
          return { supplied, key: undefined };
        }), decodeReference: () => Result.fail(commerceError("unsupportedProfile")),
        decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
      return { catalog, root, rowLimitDetail: (maximum, attempted, counts) => ({ maximum, attempted, tables: counts }) };
    };
    if (profile === "checkout") {
      const line = yield* contracts.entity("order_line_item"), lineTax = yield* contracts.entity("order_line_item_tax_line"),
        lineAdjustment = yield* contracts.entity("order_line_item_adjustment"), shipping = yield* contracts.entity("order_shipping"),
        method = yield* contracts.entity("order_shipping_method"), methodTax = yield* contracts.entity("order_shipping_method_tax_line"),
        methodAdjustment = yield* contracts.entity("order_shipping_method_adjustment");
      const lineNode: CreationNode = { entity: graphEntity(line), omitRelations: ["tax_lines", "adjustments"], steps: [
        yield* child(line, "tax_lines", lineTax, "item_id", leaf(lineTax)),
        yield* child(line, "adjustments", lineAdjustment, "item_id", leaf(lineAdjustment)),
      ] };
      profiles.set(line.table.name, make(lineNode, [line, lineTax, lineAdjustment]));
      const methodNode: CreationNode = { entity: graphEntity(method), omitRelations: ["tax_lines", "adjustments"], steps: [
        yield* child(method, "tax_lines", methodTax, "shipping_method_id", leaf(methodTax)),
        yield* child(method, "adjustments", methodAdjustment, "shipping_method_id", leaf(methodAdjustment)),
      ] };
      const relation = shipping.table.relationships.find(relation => relation.name === "shipping_method");
      if (relation?.type !== "hasOneWithFK" || relation.targetTable !== method.table.name ||
        !shipping.table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "shipping_method_id" &&
          key.referencedTable === method.table.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const shippingNode: CreationNode = { entity: graphEntity(shipping), omitRelations: ["shipping_method"], steps: [
        { kind: "ownedToOne", name: "shipping_method", foreignKey: "shipping_method_id", node: methodNode },
      ] };
      orderNode = { ...orderNode, omitRelations: [...orderNode.omitRelations, "shipping_methods"], steps: [...orderNode.steps,
        yield* child(order, "shipping_methods", shipping, "order_id", shippingNode),
      ] };
      // All FK targets precede their owners; child families keep native event
      // grouping, as in the existing Cart graph creation binding.
      orderEntities.push(method, methodTax, methodAdjustment, shipping);
    }
    profiles.set(order.table.name, make(orderNode, orderEntities));
    return profiles;
  });
}
