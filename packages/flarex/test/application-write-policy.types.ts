import type { ApplicationMutationCtxForWritePolicies } from "../src/applicationWritePolicy";
import { defineSchema, defineTable, type DataModelFromSchemaDefinition } from "../src/server";
import { v, type Id } from "../src/values";

const schema = defineSchema({ audit: defineTable({ title: v.string() }), posts: defineTable({ title: v.string() }) });
const policies = [{ logicalTableName: "audit", owner: "application" }, { logicalTableName: "posts", owner: "payload" }] as const;
type Context = ApplicationMutationCtxForWritePolicies<DataModelFromSchemaDefinition<typeof schema>, typeof policies>;

// Compiled only: every ordinary writer denies managed IDs; both tables remain readable.
export async function checkPolicyAuthoring(ctx: Context, post: Id<"posts">, audit: Id<"audit">) {
  await ctx.db.get(post);
  await ctx.db.query("posts").collect();
  await ctx.db.insert("audit", { title: "allowed" });
  await ctx.db.patch(audit, { title: "allowed" });
  await ctx.db.replace(audit, { title: "allowed" });
  await ctx.db.delete(audit);
  // @ts-expect-error Managed tables have no ordinary insert authority.
  await ctx.db.insert("posts", { title: "denied" });
  // @ts-expect-error Managed IDs have no ordinary patch authority.
  await ctx.db.patch(post, { title: "denied" });
  // @ts-expect-error Managed IDs have no ordinary replace authority.
  await ctx.db.replace(post, { title: "denied" });
  // @ts-expect-error Managed IDs have no ordinary delete authority.
  await ctx.db.delete(post);
}
