import { model, mutation, query } from "../_generated/server";
import { v } from "flarex/values";

export const list = query({
  partition: model.users,
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("lessonProgress")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .collect();
  },
});

export const allProgress = query({
  partition: model.users,
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const progress = await ctx.db.query("lessonProgress").collect();
    return progress.filter(row => row.userId === args.userId);
  },
});

export const complete = mutation({
  partition: model.users,
  args: {
    userId: v.id("users"),
    lessonId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("lessonProgress", {
      userId: args.userId,
      lessonId: args.lessonId,
      completed: true,
    });
  },
});
