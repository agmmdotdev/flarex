import { describe, expect, it, vi } from "vitest";
import { Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { ProductCategoryService } from "@medusajs/product/services";

const unavailable = (): never => { throw new Error("Unselected Category ABI operation"); };
const decodePairs = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  entity: Schema.Struct({ id: Schema.String }), update: Schema.Struct({ rank: Schema.Number }),
})));
const unused: DAL.RepositoryService = {
  getFreshManager: unavailable, getActiveManager: unavailable, transaction: async () => unavailable(),
  serialize: async <Output extends object | object[]>(value: Output) => value,
  find: async () => unavailable(), findAndCount: async () => unavailable(), create: async () => unavailable(),
  update: async () => unavailable(), delete: async () => unavailable(), softDelete: async () => unavailable(),
  restore: async () => unavailable(), upsert: async () => unavailable(), upsertWithReplace: async () => unavailable(),
};
const category = (id: string, rank: number, parent: string | null = null, deletedAt: string | null = null) => ({ id, rank, name: id, handle: id,
  mpath: parent === null ? id : parent + "." + id, parent_category_id: parent, metadata: null, deleted_at: deletedAt });
type Row = ReturnType<typeof category>;
const deleted = (row: Row) => ({ ...row, deleted_at: "2026-10-17T01:00:00.000Z" });

/** Fixed read and final tuple responses characterize the real service's DAL
 * calls. The port does not evaluate selectors, apply updates or simulate core
 * lifecycle, transactions, events, constraints or persistence. */
function nativePort(reads: readonly (readonly Row[])[], tuple: [Row[], Record<string, unknown[]>]) {
  const stages: string[] = [];
  let cursor = 0;
  const find = vi.fn(async (_input: unknown, _transform: unknown, _context: unknown) => {
    stages.push("read");
    const rows = reads[cursor++];
    if (rows === undefined) throw new Error("Unexpected Category ABI read");
    return structuredClone([...rows]);
  });
  const update = vi.fn(async (input: unknown) => { stages.push("update"); decodePairs(input); return []; });
  const softDelete = vi.fn(async (_input: unknown, _context: unknown) => { stages.push("soft-delete"); return tuple; });
  const remove = vi.fn(async (ids: string[]) => { stages.push("delete"); return ids; });
  const repository: DAL.TreeRepositoryService & Pick<DAL.RepositoryService, "update" | "softDelete"> = {
    ...unused, find, findAndCount: async () => unavailable(), update, softDelete, delete: remove,
  };
  const service = new ProductCategoryService({ productCategoryRepository: repository,
    productModuleService: { interceptEntityMutationEvents: unavailable } });
  const context: Context = { manager: {}, transactionManager: {} };
  return { service, context, stages, find, update, softDelete, remove,
    pairs: () => update.mock.calls.map(([input]) => decodePairs(input).map(pair => ({ id: pair.entity.id, rank: pair.update.rank }))),
  };
}

describe("native Category portable soft-delete ABI", () => {
  const a = category("a", 0), b = category("b", 1), c = category("c", 2), d = category("d", 3);
  const siblings = [a, b, c, d];

  it("delegates empty selection and the complete native tuple without synthetic events or inverse calls", async () => {
    const tuple: [Row[], Record<string, unknown[]>] = [[], {}];
    const native = nativePort([], tuple);
    expect(await native.service.softDelete([], native.context)).toBe(tuple);
    expect(native.softDelete).toHaveBeenCalledExactlyOnceWith([], native.context);
    expect(native.find).not.toHaveBeenCalled(); expect(native.update).not.toHaveBeenCalled(); expect(native.remove).not.toHaveBeenCalled();
    expect(native.stages).toEqual(["soft-delete"]);
  });

  it("retains duplicate initial cohorts and decrements pending ranks again, including negative ranks", async () => {
    const removed = deleted(a), tuple: [Row[], Record<string, unknown[]>] = [[removed, removed], {}];
    const native = nativePort([[a], [], siblings, [a], [], siblings], tuple);
    const result = await native.service.softDelete(["a", "a"], native.context);
    expect(result).toBe(tuple); expect(result[0][0]).toBe(result[0][1]);
    expect(native.pairs()).toEqual([
      [{ id: "b", rank: 0 }, { id: "c", rank: 1 }, { id: "d", rank: 2 }],
      [{ id: "b", rank: -1 }, { id: "c", rank: 0 }, { id: "d", rank: 1 }],
    ]);
    expect(native.stages).toEqual([...Array.from({ length: 6 }, () => "read"), "update", "update", "soft-delete"]);
    expect(native.find.mock.calls.map(([input]) => input)).toEqual([0, 1].flatMap(() => [
      { where: { id: "a" }, options: { limit: 1 } },
      { where: { parent_category_id: "a" }, options: { orderBy: { rank: "ASC" } } },
      { where: { parent_category_id: null }, options: { orderBy: { rank: "ASC" } } },
    ]));
    expect(native.softDelete).toHaveBeenCalledExactlyOnceWith(["a", "a"], native.context);
  });

  it.each([
    { ids: ["a", "b"], roots: [a, b], updates: [
      [{ id: "b", rank: 0 }, { id: "c", rank: 1 }, { id: "d", rank: 2 }],
      [{ id: "c", rank: 0 }, { id: "d", rank: 1 }],
    ], deletedRoots: [deleted(a), deleted({ ...b, rank: 0 })] },
    { ids: ["b", "a"], roots: [b, a], updates: [
      [{ id: "c", rank: 1 }, { id: "d", rank: 2 }],
      [{ id: "b", rank: 0 }, { id: "c", rank: 0 }, { id: "d", rank: 1 }],
    ], deletedRoots: [deleted({ ...b, rank: 0 }), deleted(a)] },
  ])("retains both initial leaf cohorts in request order $ids", async ({ ids, roots, updates, deletedRoots }) => {
    const tuple: [Row[], Record<string, unknown[]>] = [deletedRoots, {}];
    const native = nativePort(roots.flatMap(row => [[row], [], siblings]), tuple);
    expect(await native.service.softDelete(ids, native.context)).toBe(tuple);
    expect(native.pairs()).toEqual(updates);
    expect(native.stages).toEqual([...Array.from({ length: 6 }, () => "read"), "update", "update", "soft-delete"]);
    expect(native.softDelete).toHaveBeenCalledExactlyOnceWith(ids, native.context);
  });

  it("uses the same complete preparation for physical deletion", async () => {
    const native = nativePort([[a], [], siblings, [a], [], siblings], [[], {}]);
    expect(await native.service.delete(["a", "a"], native.context)).toEqual(["a", "a"]);
    expect(native.pairs()).toEqual([
      [{ id: "b", rank: 0 }, { id: "c", rank: 1 }, { id: "d", rank: 2 }],
      [{ id: "b", rank: -1 }, { id: "c", rank: 0 }, { id: "d", rank: 1 }],
    ]);
    expect(native.stages).toEqual([...Array.from({ length: 6 }, () => "read"), "update", "update", "delete"]);
    expect(native.remove).toHaveBeenCalledExactlyOnceWith(["a", "a"], native.context);
    expect(native.softDelete).not.toHaveBeenCalled();
  });

  it.each(["missing", "already-deleted"])("retains native NOT_FOUND for the active read's %s absence", async id => {
    const native = nativePort([[]], [[], {}]);
    await expect(native.service.softDelete([id], native.context)).rejects.toMatchObject({
      type: "not_found", message: `ProductCategory with id: ${id} was not found`,
    });
    expect(native.update).not.toHaveBeenCalled(); expect(native.softDelete).not.toHaveBeenCalled(); expect(native.remove).not.toHaveBeenCalled();
  });

  it("refuses a later missing root before any selected cohort is mutated", async () => {
    const native = nativePort([[a], [], siblings, []], [[], {}]);
    await expect(native.service.softDelete(["a", "missing"], native.context)).rejects.toMatchObject({ type: "not_found" });
    expect(native.stages).toEqual(["read", "read", "read", "read"]);
    expect(native.update).not.toHaveBeenCalled(); expect(native.softDelete).not.toHaveBeenCalled();
  });

  it.each(["parent-first", "child-first"])("refuses active parent/child overlap in %s order before writes", async order => {
    const parent = category("parent", 4), child = category("child", 0, "parent");
    const first = order === "parent-first";
    const native = nativePort(first ? [[parent], [child]] : [[child], [], [child], [parent], [child]], [[], {}]);
    await expect(native.service.softDelete(first ? ["parent", "child"] : ["child", "parent"], native.context))
      .rejects.toMatchObject({ type: "not_allowed", message: "Deleting ProductCategory (parent) with category children is not allowed" });
    expect(native.update).not.toHaveBeenCalled(); expect(native.softDelete).not.toHaveBeenCalled();
  });

  it("preserves the actual repository lifecycle rejection after preparation", async () => {
    const native = nativePort([[d], [], siblings], [[], {}]), failure = new Error("native lifecycle failed");
    native.softDelete.mockRejectedValueOnce(failure);
    await expect(native.service.softDelete(["d"], native.context)).rejects.toBe(failure);
    expect(native.update).not.toHaveBeenCalled(); expect(native.softDelete).toHaveBeenCalledExactlyOnceWith(["d"], native.context);
  });
});
