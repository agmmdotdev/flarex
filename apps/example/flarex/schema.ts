import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
  }).partitionBy("_id"),

  lessonProgress: defineTable({
    userId: v.id("users"),
    lessonId: v.string(),
    completed: v.boolean(),
  })
    .colocateWith("users", "userId")
    .index("by_user", ["userId"]),
});
