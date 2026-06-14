import { mutation, query } from "../_generated/server";
import { v } from "flarex/values";

export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("lessonProgress")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .collect();
  },
});

export const complete = mutation({
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
