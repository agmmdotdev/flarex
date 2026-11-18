import { describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import type { GraphDirectPath } from "../src/local-graph/direct-paths";
import type { GraphParticipant, GraphReadDefinition, GraphRelationPath } from "../src/local-graph/model";
import { captureGraphPresentation } from "../src/local-graph/presentation";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import type { ReadTable } from "../src/query/catalog";
import { defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";
import { prepareWorkflowComposition, type InstalledWorkflowModule } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { promiseFailureObserver } from "./support/promise-failure-observer";

const cart = defineAtomicCommerceParticipant("presentation-cart"), product = defineAtomicCommerceParticipant("presentation-product");
const cartCommand = defineGraphReadCommand("presentationCart", () => Effect.succeed([[], 0]));
const itemCommand = defineGraphReadCommand("presentationItem", () => Effect.succeed([[], 0]));
const variantCommand = defineGraphReadCommand("presentationVariant", () => Effect.succeed([[], 0]));
const cartTable: ReadTable = { name: "cart", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} };
const itemTable: ReadTable = { name: "line_item", columns: ["id", "cart_id", "variant_id"], primaryKeys: ["id"], foreignKeys: ["cart_id", "variant_id"], companions: {} };
const variantTable: ReadTable = { name: "variant", columns: ["id", "title"], primaryKeys: ["id"], foreignKeys: [], companions: {} };
const totals = () => ({ columns: ["total", "raw_total"], companions: { total: "raw_total" } });
const local = (): GraphRelationPath => ({ path: "items", table: itemTable, many: true, sourceFields: ["id"], presentation: totals() });
const direct: GraphDirectPath = { root: "Cart", path: "items.variant", sourceModel: "LineItem", sourceKey: "variant_id",
  targetModel: "Variant", targetKey: "id", many: false, nativeFields: true, maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 };
function read(model: string, table: ReadTable, command: GraphReadDefinition["command"]): GraphReadDefinition {
  return { model, table, command, paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount };
}
function participants(path: GraphRelationPath = local(), edge: GraphDirectPath = direct): GraphParticipant[] {
  return [{ participant: cart, module: { aliases: [{ name: "cart", model: "Cart" }, { name: "line_item", model: "LineItem" }],
    reads: [{ ...read("Cart", cartTable, cartCommand), paths: [path], presentation: totals(), selectedFieldsOnly: true, nativeFields: true },
      read("LineItem", itemTable, itemCommand)], directPaths: [edge] } },
  { participant: product, module: { aliases: [{ name: "variant", model: "Variant" }], reads: [{ ...read("Variant", variantTable, variantCommand),
    selectedFieldsOnly: true, presentation: { columns: ["display", "raw_display"], companions: { display: "raw_display" } } }] } }];
}
type Call = { readonly participant: Parameters<AtomicCommerceContext["call"]>[0]; readonly command: Parameters<AtomicCommerceContext["call"]>[1]; readonly args: Json };
function context(responses: readonly Json[], calls: Call[] = []): AtomicCommerceContext {
  let index = 0;
  return { eventGroupId: "presentation", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")), refuse: Effect.fail,
    call: (participant, command, args) => {
      calls.push({ participant, command, args });
      const response = responses[index++];
      return response === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(response);
    } };
}
const query = (fields: readonly string[], extra = {}) => ({ entity: "cart", fields, pagination: { take: 4 }, ...extra });
const rows: Json = [[{ id: "c", total: 9, raw_total: { value: "9", precision: 20 }, secret: "private",
  items: [{ id: "i", cart_id: "c", variant_id: "v", total: 9, raw_total: { value: "9", precision: 20 }, secret: "private" }] }], 1];
const variants: Json = [[{ id: "v", title: "Variant", display: 7, raw_display: { value: "7", precision: 20 }, secret: "private" }], 1];
const prepared = (selected = participants()) => Result.getOrThrow(prepareLocalGraph(selected));

describe("authenticated graph presentation fields", () => {
  it.each(["computed", "stored"] as const)("retains %s numeric companions in a direct-only fetch without overfetching key-only reads", async kind => {
    const stored = { ...cartTable, columns: kind === "stored" ? ["id", "unselected", "total", "raw_total"] : ["id", "unselected"],
      companions: kind === "stored" ? { total: "raw_total" } : {} };
    const edge: GraphDirectPath = { ...direct, path: "target", sourceModel: "Cart", sourceKey: "id" };
    const root = { ...read("Cart", stored, cartCommand), selectedFieldsOnly: true as const,
      ...(kind === "computed" ? { presentation: totals() } : {}) };
    const graph = prepared([{ participant: cart, module: { aliases: [{ name: "cart", model: "Cart" }], reads: [root], directPaths: [edge] } },
      { participant: product, module: { aliases: [{ name: "variant", model: "Variant" }], reads: [read("Variant", variantTable, variantCommand)] } }]);
    const response: Json = [[{ id: "c", total: 9, raw_total: { value: "9", precision: 20 }, unselected: "private" }], 1];
    const target: Json = [[{ id: "c", title: "unused" }], 1];
    const calls: Call[] = [];
    expect((await runEffect(graph.bind(context([response, target], calls)).graph(query(["total", "target.id"])))).data)
      .toEqual([{ total: 9, target: { id: "c" } }]);
    expect(calls[0]?.args).toEqual({ filters: {}, config: { select: ["total", "raw_total", "id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 } });
    const keyCalls: Call[] = [];
    expect((await runEffect(graph.bind(context([response, target], keyCalls)).graph(query(["target.id"])))).data)
      .toEqual([{ target: { id: "c" } }]);
    expect(keyCalls[0]?.args).toMatchObject({ config: { select: ["id"], relations: [] } });
  });

  it("selects computed local views while authenticating the real stored FK and counted source", async () => {
    const calls: Call[] = [];
    const graph = prepared();
    const result = await runEffect(graph.bind(context([rows, variants], calls)).graph(query(["total", "items.total", "items.variant.display"])));
    expect(result.data).toEqual([{ total: 9, items: [{ variant_id: "v", total: 9, variant: { id: "v", display: 7 } }] }]);
    expect(calls.map(call => call.command)).toEqual([cartCommand, variantCommand]);
    expect(calls.map(call => call.participant)).toEqual([cart, product]);
    expect(calls[0]?.args).toMatchObject({ config: { select: ["id", "total", "raw_total"], relations: ["items"] } });
    expect(calls[1]?.args).toMatchObject({ filters: { id: ["v"] }, config: { select: ["id", "display", "raw_display"] } });
    expect(participants()[0]?.module.reads[1]?.table.columns).not.toContain("total");
    expect(participants()[0]?.module.reads[1]).not.toHaveProperty("presentation");
  });

  it("expands only declared stored and computed wildcard properties and refuses unlisted selections before calls", async () => {
    const graph = prepared(), calls: Call[] = [];
    const result = await runEffect(graph.bind(context([rows], calls)).graph(query(["*", "items.*"])));
    expect(result.data).toEqual([{ id: "c", total: 9, raw_total: { value: "9", precision: 20 }, items: [{
      id: "i", cart_id: "c", variant_id: "v", total: 9, raw_total: { value: "9", precision: 20 },
    }] }]);
    for (const field of ["secret", "items.secret", "items.variant.secret"]) {
      const refused: Call[] = [];
      expect(await runEffectFailure(graph.bind(context([], refused)).graph(query([field])))).toMatchObject({ reason: "unsupportedProfile" });
      expect(refused).toEqual([]);
    }
    expect(await runEffectFailure(graph.bind(context([[{ id: "c" }], 1])).graph(query(["total"]))))
      .toMatchObject({ reason: "storedCorruption" });
  });

  it("never admits computed columns as primary, source, target, foreign or order evidence", async () => {
    const source = local();
    const cases = [
      participants({ ...source, sourceFields: ["total"] }),
      participants({ ...source, targetFields: ["total"] }),
      participants({ ...source, table: { ...itemTable, primaryKeys: ["total"] } }),
      participants({ ...source, table: { ...itemTable, foreignKeys: ["total"] } }, { ...direct, sourceKey: "total" }),
      participants(source, { ...direct, sourceKey: "total" }),
      participants(source, { ...direct, targetKey: "display" }),
      participants().map(entry => ({ ...entry, module: { ...entry.module, reads: entry.module.reads.map(definition => definition.model === "Cart"
        ? { ...definition, table: { ...definition.table, primaryKeys: ["total"] } } : definition) } })),
      participants().map(entry => ({ ...entry, module: { ...entry.module, reads: entry.module.reads.map(definition => definition.model === "Cart"
        ? { ...definition, orderable: ["id", "total"] } : definition) } })),
    ];
    for (const selected of cases) expect(Result.isFailure(prepareLocalGraph(selected))).toBe(true);
    const calls: Call[] = [];
    expect(await runEffectFailure(prepared().bind(context([], calls)).graph(query(["total"], { pagination: { take: 4, order: { total: "ASC" } } }))))
      .toMatchObject({ reason: "unsupportedProfile" });
    expect(calls).toEqual([]);
  });

  it("preserves stored-column completeness, participant, table and primary-key prefix authentication", () => {
    const source = local(), valid = participants();
    const [owner, target] = valid;
    if (owner === undefined || target === undefined) throw new Error("Missing presentation fixtures");
    const cases = [
      participants({ ...source, table: { ...itemTable, columns: [...itemTable.columns, "stored_extra"] } }),
      participants({ ...source, table: { ...itemTable, name: "foreign_item" } }),
      participants({ ...source, table: { ...itemTable, primaryKeys: ["cart_id"] } }),
      [...valid, { participant: defineAtomicCommerceParticipant("ambiguous"), module: { aliases: [{ name: "other_variant", model: "Variant" }],
        reads: [read("Variant", variantTable, variantCommand)] } }],
      [{ ...owner, module: { ...owner.module, reads: owner.module.reads.filter(definition => definition.model !== "LineItem") } }, target,
        { participant: defineAtomicCommerceParticipant("foreign-item"), module: { aliases: [{ name: "foreign_item", model: "LineItem" }],
          reads: [read("LineItem", itemTable, itemCommand)] } }],
    ];
    for (const selected of cases) expect(Result.isFailure(prepareLocalGraph(selected))).toBe(true);
  });

  it("rejects duplicate/colliding names, malformed companions and unknown keys in both capture paths", () => {
    const invalid: unknown[] = [
      { columns: ["total", "total"], companions: {} }, { columns: ["id"], companions: {} },
      { columns: ["nested.total"], companions: {} }, { columns: ["total"], companions: { total: "missing" } },
      { columns: ["total"], companions: { missing: "total" } }, { columns: ["total"], companions: { total: "total" } },
      { columns: ["total", "raw_total", "other"], companions: { total: "raw_total", other: "raw_total" } },
      { columns: ["total", "raw_total", "other"], companions: { total: "raw_total", raw_total: "other" } },
      { columns: ["total"], companions: {}, foreign: true },
      { columns: ["total"], companions: {}, foreign: undefined },
    ];
    for (const presentation of invalid) {
      expect(Result.isFailure(captureGraphPresentation(presentation, cartTable))).toBe(true);
      const source = participants()[0];
      if (source === undefined) throw new Error("Missing graph fixture");
      const malformed = { ...source.module, reads: source.module.reads.map(definition => ({ ...definition, presentation })) };
      // @ts-expect-error Foreign metadata deliberately exercises unknown runtime capture.
      expect(Result.isFailure(prepareLocalGraph([{ ...source, module: malformed }]))).toBe(true);
      expect(Result.isFailure(defineWorkflowModule({ name: "malformed", source: { name: "test", profile: "test" }, methods: {},
        // @ts-expect-error Foreign metadata deliberately exercises workflow capture.
        graph: malformed }))).toBe(true);
    }
  });

  it("snapshots and freezes root/path presentation independently of mutable declarations", async () => {
    const rootPresentation = totals(), itemPresentation = totals();
    const source = participants()[0];
    if (source === undefined) throw new Error("Missing Cart fixture");
    const module = { ...source.module, directPaths: [], reads: source.module.reads.map(definition => definition.model === "Cart"
      ? { ...definition, presentation: rootPresentation, paths: [{ ...local(), presentation: itemPresentation }] } : definition) };
    const graph = Result.getOrThrow(prepareLocalGraph([{ ...source, module }]));
    const workflow = Result.getOrThrow(defineWorkflowModule({ name: "capture", source: { name: "test", profile: "test" }, methods: {}, graph: module }));
    rootPresentation.columns.push("secret"); rootPresentation.companions.total = "secret";
    itemPresentation.columns.length = 0; itemPresentation.companions.total = "secret";
    const captured = workflowModuleDefinition(workflow)?.graph.reads[0];
    expect(captured?.presentation).toEqual(totals());
    expect(captured?.paths[0]?.presentation).toEqual(totals());
    for (const presentation of [captured?.presentation, captured?.paths[0]?.presentation]) {
      expect(Object.isFrozen(presentation)).toBe(true);
      expect(Object.isFrozen(presentation?.columns)).toBe(true);
      expect(Object.isFrozen(presentation?.companions)).toBe(true);
    }
    expect((await runEffect(graph.bind(context([rows])).graph(query(["total", "items.total"])))).data)
      .toEqual([{ total: 9, items: [{ total: 9 }] }]);
    expect(await runEffectFailure(graph.bind(context([])).graph(query(["secret"])))).toMatchObject({ reason: "unsupportedProfile" });
  });

  it("binds changed presentation declarations to actual workflow resource identity and omits absent extensions", async () => {
    const flow = Result.getOrThrow(createWorkflow("presentation-identity", () => new WorkflowResponse(null)).prepare());
    const identity = async (presentation?: { readonly columns: readonly string[]; readonly companions: Readonly<Record<string, string>> }) => {
      const module = Result.getOrThrow(defineWorkflowModule({ name: "identity", source: { name: "test", profile: "test" }, methods: {},
        graph: { aliases: [{ name: "cart", model: "Cart" }], reads: [{ ...read("Cart", cartTable, cartCommand),
          ...(presentation === undefined ? {} : { presentation }) }] } }));
      const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module, graph: true, methods: [] } }, false));
      const modules: Record<string, InstalledWorkflowModule> = {};
      // Pure composition never authenticates storage or starts an execution.
      Object.defineProperty(modules, "cart", { enumerable: true, value: { module, logicalStorage: {} } });
      const result = await runEffect(prepareWorkflowComposition({ identityAndAccessPolicy: {}, modules, revision: "a".repeat(64),
        workflow: { name: "presentation", prepared: flow, resources, input: Schema.Json, output: Schema.Json } }));
      return { identity: result.composition.identityAndAccessPolicy, read: workflowModuleDefinition(module)?.graph.reads[0] };
    };
    const ordinary = await identity(), selected = await identity(totals());
    expect(ordinary.read).not.toHaveProperty("presentation");
    expect(JSON.stringify(ordinary.identity)).not.toContain("presentation\":");
    expect((await identity()).identity).toEqual(ordinary.identity);
    expect(selected.identity).not.toEqual(ordinary.identity);
    expect((await identity({ columns: ["total", "raw_total", "display"], companions: { total: "raw_total" } })).identity).not.toEqual(selected.identity);
    expect((await identity({ columns: ["total", "raw_total"], companions: {} })).identity).not.toEqual(selected.identity);
  });
});
