import { defineColocatedTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  users: definePartitionTable({
    name: v.string(),
  }),

  lessonProgress: defineColocatedTable("users", "userId", {
    userId: v.id("users"),
    lessonId: v.string(),
    completed: v.boolean(),
  })
    .index("by_user", ["userId"]),
});
