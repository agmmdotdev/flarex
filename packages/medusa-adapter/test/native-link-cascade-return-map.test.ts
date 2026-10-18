import { describe, expect, it, vi } from "vitest";
import { Link } from "@medusajs/modules-sdk/link";
import type { Context, ILinkModule, LoadedModule, ModuleJoinerRelationship } from "@medusajs/types";

type Operation = "delete" | "restore";
type LifecycleMap = Record<string, string[]>;
interface Call {
  readonly serviceName: string;
  readonly method: "softDelete" | "restore";
  readonly arguments: readonly unknown[];
}
const operations: readonly Operation[] = ["delete", "restore"];
const context: Context = { transactionId: "controlled-native-router-unit" };
const methodFor = (operation: Operation) => operation === "delete" ? "softDelete" : "restore";

/** Controlled lifecycle response ports around the actual promoted router.
 * These cases prove routing/results only, with no storage, module business,
 * event, bootstrap, settlement or workflow scheduler claim. */
function port(serviceName: string, primaryKeys: readonly string[],
  parents: readonly Pick<ModuleJoinerRelationship, "serviceName" | "primaryKey">[],
  respond: (ordinal: number) => LifecycleMap, calls: Call[],
) {
  let ordinal = 0;
  const invoke = async (method: Call["method"], args: readonly unknown[]) => {
    calls.push({ serviceName, method, arguments: structuredClone(args) });
    return structuredClone(respond(ordinal++));
  };
  return {
    __definition: { key: serviceName, defaultPackage: false, label: "Controlled router response port", isQueryable: true,
      defaultModuleDeclaration: { scope: "internal" } },
    __joinerConfig: { serviceName, primaryKeys: [...primaryKeys], extends: parents.map(parent => ({ serviceName: parent.serviceName,
      relationship: { serviceName, primaryKey: parent.primaryKey, foreignKey: parent.primaryKey, alias: serviceName + "_port" } })) },
    softDelete: vi.fn<ILinkModule["softDelete"]>((...args) => invoke("softDelete", args)),
    restore: vi.fn<ILinkModule["restore"]>((...args) => invoke("restore", args)),
  } satisfies LoadedModule & Pick<ILinkModule, "softDelete" | "restore">;
}

const fixed = (...maps: readonly LifecycleMap[]) => (ordinal: number) => {
  const map = maps[ordinal];
  if (map === undefined) throw new Error("Unexpected extra lifecycle response-port call");
  return map;
};
const parent = [{ serviceName: "parents", primaryKey: "parent_id" }];
const twoParents = [...parent, { serviceName: "other_parents", primaryKey: "parent_id" }];
const fromMiddle = [{ serviceName: "middle", primaryKey: "next_id" }];
const repeatedInput = () => ({ parents: { parent_id: ["p2", "p1", "p2"] }, other_parents: { parent_id: ["p1", "p3", "p2"] } });
const expectedCall = (operation: Operation, serviceName: string, selector: LifecycleMap, fields: string[]): Call =>
  ({ serviceName, method: methodFor(operation), arguments: [selector, { returnLinkableKeys: fields }, context] });
const middleResponses = () => fixed({ next_id: ["n2", "n1", "n2"] }, { next_id: ["n1", "n3", "n2"] });

describe("native Link nested cascade return maps (controlled router unit ports)", () => {
  const keyCases: readonly { readonly title: string; readonly returned: LifecycleMap; readonly expected: LifecycleMap }[] = [
    { title: "valid first declared key despite returned property order", returned: { later_id: ["ignored"], first_id: ["l1"] }, expected: { first_id: ["l1"] } },
    { title: "present empty first key without fallback", returned: { later_id: ["ignored"], first_id: [] }, expected: { first_id: [] } },
    { title: "later declared key when the first is absent", returned: { later_id: ["l1"] }, expected: { later_id: ["l1"] } },
  ];
  it.each(operations.flatMap(operation => keyCases.map(example => ({ operation, ...example }))))(
    "$operation retains $title", async ({ operation, returned, expected }) => {
      const calls: Call[] = [], middle = port("middle", ["next_id"], parent, fixed({ next_id: ["n1"] }), calls),
        leaf = port("leaf", ["first_id", "later_id"], fromMiddle, fixed(returned), calls);
      const input = { parents: { parent_id: ["p1"] } }, before = structuredClone(input);
      expect(await new Link([middle, leaf])[operation](input, context)).toEqual([null, {
        middle: { next_id: ["n1"] }, leaf: expected,
      }]);
      expect(calls).toEqual([
        expectedCall(operation, "middle", { parent_id: ["p1"] }, ["next_id"]),
        expectedCall(operation, "leaf", { next_id: ["n1"] }, ["first_id", "later_id"]),
      ]);
      expect(middle[methodFor(operation)].mock.calls[0]?.[2]).toBe(context);
      expect(input).toEqual(before);
    },
  );

  it.each(operations)("%s preserves repeated-parent selectors and nested accumulation order", async operation => {
    const calls: Call[] = [], middle = port("middle", ["next_id"], twoParents, middleResponses(), calls),
      leaf = port("leaf", ["first_id", "later_id"], fromMiddle,
        fixed({ first_id: ["l2", "l1", "l2"] }, { first_id: ["l1", "l3", "l2"] }), calls);
    const input = repeatedInput(), before = structuredClone(input);
    expect(await new Link([middle, leaf])[operation](input, context)).toEqual([null, {
      middle: { next_id: ["n1", "n3", "n2"] }, leaf: { first_id: ["l2", "l1", "l3"] },
    }]);
    expect(calls).toEqual([
      expectedCall(operation, "middle", { parent_id: ["p2", "p1", "p2"] }, ["next_id"]),
      expectedCall(operation, "middle", { parent_id: ["p3"] }, ["next_id"]),
      expectedCall(operation, "leaf", { next_id: ["n2", "n1", "n2"] }, ["first_id", "later_id"]),
      expectedCall(operation, "leaf", { next_id: ["n3"] }, ["first_id", "later_id"]),
    ]);
    expect(input).toEqual(before);
  });

  const missingKeyCases = [{ title: "no matching declared key", fields: ["first_id", "later_id"] },
    { title: "no declared keys", fields: [] }];
  it.each(operations.flatMap(operation => missingKeyCases.map(example => ({ operation, ...example }))))(
    "$operation continues recursion and processed-ID tracking with $title", async ({ operation, fields }) => {
      const calls: Call[] = [], middle = port("middle", ["next_id"], twoParents, middleResponses(), calls),
        leaf = port("leaf", fields, fromMiddle,
          fixed({ undeclared_id: ["u2", "u1", "u2"] }, { undeclared_id: ["u1", "u3", "u2"] }), calls),
        terminal = port("terminal", ["terminal_id"], [{ serviceName: "leaf", primaryKey: "undeclared_id" }],
          fixed({ terminal_id: ["t2", "t1", "t2"] }, { terminal_id: ["t1", "t3", "t2"] }), calls);
      const result = await new Link([middle, leaf, terminal])[operation](repeatedInput(), context);
      expect(result).toEqual([null, {
        middle: { next_id: ["n1", "n3", "n2"] }, terminal: { terminal_id: ["t2", "t1", "t3"] },
      }]);
      expect(Object.hasOwn(result[1], "leaf")).toBe(false);
      expect(calls).toEqual([
        expectedCall(operation, "middle", { parent_id: ["p2", "p1", "p2"] }, ["next_id"]),
        expectedCall(operation, "middle", { parent_id: ["p3"] }, ["next_id"]),
        expectedCall(operation, "leaf", { next_id: ["n2", "n1", "n2"] }, fields),
        expectedCall(operation, "leaf", { next_id: ["n3"] }, fields),
        expectedCall(operation, "terminal", { undeclared_id: ["u2", "u1", "u2"] }, ["terminal_id"]),
        expectedCall(operation, "terminal", { undeclared_id: ["u3"] }, ["terminal_id"]),
      ]);
    },
  );

  it.each(operations)("%s retains genuine errors-as-data, partial maps and call order", async operation => {
    const calls: Call[] = [], failure = new Error("controlled native lifecycle refusal"),
      middle = port("middle", ["next_id"], parent, fixed({ next_id: ["n1"] }), calls),
      leaf = port("leaf", ["first_id", "later_id"], fromMiddle, () => { throw failure; }, calls),
      terminal = port("terminal", ["terminal_id"], [{ serviceName: "leaf", primaryKey: "undeclared_id" }],
        () => { throw new Error("Unexpected terminal call after native error"); }, calls);
    const result = await new Link([middle, leaf, terminal])[operation]({ parents: { parent_id: ["p1"] } }, context);
    expect(result[0]).toMatchObject([{ serviceName: "leaf", method: methodFor(operation), args: { next_id: ["n1"] },
      error: { message: "controlled native lifecycle refusal", stack: failure.stack } }]);
    expect(result[0]).toHaveLength(1);
    expect(result[1]).toEqual({ middle: { next_id: ["n1"] } });
    expect(calls).toEqual([
      expectedCall(operation, "middle", { parent_id: ["p1"] }, ["next_id"]),
      expectedCall(operation, "leaf", { next_id: ["n1"] }, ["first_id", "later_id"]),
    ]);
    expect(terminal.softDelete).not.toHaveBeenCalled(); expect(terminal.restore).not.toHaveBeenCalled();
  });
});
