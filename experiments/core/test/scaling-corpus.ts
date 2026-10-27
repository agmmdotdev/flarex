import { v } from "../../../packages/flarex/src/values.ts";
import { mutationGeneric, type MutationBuilder } from "../../../packages/flarex/src/server.ts";
import { applicationFunctions, type TaskModel } from "./application-corpus.ts";

type ScalingModel = { tasks: { document: TaskModel["tasks"]["document"] & { note: string };
  fieldPaths: TaskModel["tasks"]["fieldPaths"] | "note"; indexes: TaskModel["tasks"]["indexes"] } };
// SAFETY: same model-erased SDK registration specialization as the shared
// corpus; the compiled scaling definition owns the required plain note field.
const mutation = mutationGeneric as MutationBuilder<ScalingModel, "public"> & typeof mutationGeneric;

/** Actual authored SDK functions. The benchmark does not implement storage or
 * call experimental root/persistence internals from the business handlers. */
export const scalingFunctions = {
  ...applicationFunctions,
  batch: mutation({ args: { count: v.number(), stem: v.string() }, returns: v.number(), handler: async (ctx, args) => {
    for (let index = 0; index < args.count; index++) await ctx.db.insert("tasks", { name: `${args.stem}-${index}`, priority: index, note: "original" });
    return args.count;
  } }),
  seed: mutation({ args: { name: v.string(), priority: v.number() }, returns: v.id("tasks"),
    handler: async (ctx, args) => ctx.db.insert("tasks", { ...args, note: "original" }) }),
  overlay: mutation({ args: { count: v.number(), stem: v.string() }, handler: async (ctx, args) => {
    const ids = [];
    for (let index = 0; index < args.count; index++) ids.push(await ctx.db.insert("tasks", { name: `${args.stem}-${index}`, priority: index, note: "original" }));
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index]; if (id === undefined) throw new Error("Missing authored batch identity");
      if (index % 4 === 0) await ctx.db.patch(id, { priority: args.count + index });
      else if (index % 4 === 1) await ctx.db.patch(id, { name: `${args.stem}-edited-${index}` });
      else if (index % 4 === 2) await ctx.db.delete(id);
    }
    const rows = await ctx.db.query("tasks").withIndex("by_priority", range => range.gte("priority", 0).lt("priority", args.count)).collect();
    return { ids, rows };
  } }),
  edit: mutation({ args: { ids: v.array(v.id("tasks")), indexed: v.boolean(), stem: v.string() }, returns: v.null(), handler: async (ctx, args) => {
    for (let index = 0; index < args.ids.length; index++) {
      const id = args.ids[index]; if (id === undefined) throw new Error("Missing authored edit identity");
      await ctx.db.patch(id, args.indexed ? { priority: 1000 + index } : { note: `${args.stem}-edited-${index}` });
    }
    return null;
  } }),
};
