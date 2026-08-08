export function get(ctx, { id }) {
  return ctx.db.get(id);
}
