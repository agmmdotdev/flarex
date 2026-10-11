import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";

/** Bind the scripted mock's query without executing or replacing its reads. */
export function mockRelationalRead(
  store: Pick<CommerceCommandContext["store"], "find" | "findPage" | "count">,
  query: unknown,
): ReturnType<CommerceCommandContext["store"]["prepareRead"]> {
  return {
    find: context => store.find(context, query),
    findPage: context => store.findPage(context, query),
    count: context => store.count(context, query),
  };
}
