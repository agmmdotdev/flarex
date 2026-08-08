export function create(ctx, args) {
  return ctx.db.insert("pantryStock", args);
}
