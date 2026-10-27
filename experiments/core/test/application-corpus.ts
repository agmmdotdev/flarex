import { queryGeneric, mutationGeneric, type QueryBuilder, type MutationBuilder } from "../../../packages/flarex/src/server.ts";
import { v, type Id } from "../../../packages/flarex/src/values.ts";
export type TaskModel = { tasks: { document: { _id: Id<"tasks">; _creationTime: number; name: string; priority: number };
  fieldPaths: "name" | "priority"; indexes: { by_priority: ["priority"] } } };
// SAFETY: SDK registration is model-erased; the trusted fixture's compiled
// definition checks actual table/index names and scalar data at runtime.
const query = queryGeneric as QueryBuilder<TaskModel, "public"> & typeof queryGeneric;
// SAFETY: same model specialization of the actual SDK mutation registration;
// no runtime context, value or caller-supplied object is asserted here.
const mutation = mutationGeneric as MutationBuilder<TaskModel, "public"> & typeof mutationGeneric;
export { query as applicationQuery, mutation as applicationMutation };

/** Actual authored Application functions, usable by either execution host.
 * No SQL, framework runtime or experimental root API appears in this corpus. */
export const applicationFunctions = {
  batch: mutation({ args: { count: v.number(), stem: v.string() }, returns: v.number(), handler: async (ctx, args) => {
    for (let index = 0; index < args.count; index++) await ctx.db.insert("tasks", { name: `${args.stem}-${index}`, priority: index });
    return args.count;
  } }),
  seed: mutation({ args: { name: v.string(), priority: v.number() }, returns: v.id("tasks"),
    handler: async (ctx, args) => ctx.db.insert("tasks", args) }),
  read: query({ args: { id: v.id("tasks"), missing: v.id("tasks"), lower: v.number(), upper: v.number() },
    handler: async (ctx, args) => ({ present: await ctx.db.get(args.id), missing: await ctx.db.get(args.missing),
      rows: await ctx.db.query("tasks").withIndex("by_priority", range => range.gte("priority", args.lower).lt("priority", args.upper)).collect() }) }),
  point: query({ args: { id: v.id("tasks") }, handler: async (ctx, args) => ctx.db.get(args.id) }),
  range: query({ args: { lower: v.number(), upper: v.number() }, handler: async (ctx, args) =>
    ctx.db.query("tasks").withIndex("by_priority", range => range.gte("priority", args.lower).lt("priority", args.upper)).collect() }),
  patch: mutation({ args: { id: v.id("tasks"), priority: v.number() }, returns: v.null(),
    handler: async (ctx, args) => { await ctx.db.patch(args.id, { priority: args.priority }); return null; } }),
  remove: mutation({ args: { id: v.id("tasks") }, returns: v.null(),
    handler: async (ctx, args) => { await ctx.db.delete(args.id); return null; } }),
  change: mutation({ args: { id: v.id("tasks"), name: v.string() }, handler: async (ctx, args) => {
    const original = await ctx.db.get(args.id);
    const created = await ctx.db.insert("tasks", { name: args.name, priority: 2 });
    await ctx.db.patch(args.id, { priority: 9 });
    const inserted = await ctx.db.get(created);
    const updated = await ctx.db.get(args.id);
    const rows = await ctx.db.query("tasks").withIndex("by_priority", range => range.gte("priority", 0).lt("priority", 5)).collect();
    return { original, created, inserted, updated, rows };
  } }),
};
