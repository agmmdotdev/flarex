const UTF8 = new TextEncoder();

export interface CreateAndReadFunctionSourcesV1 {
  readonly mutationSourceBytes: Uint8Array;
  readonly querySourceBytes: Uint8Array;
}

export function makeCreateAndReadFunctionSourcesV1(
  tableName: string,
): CreateAndReadFunctionSourcesV1 {
  return {
    mutationSourceBytes: UTF8.encode(
      `export function create(ctx,a){return ctx.db.insert("${tableName}",a)}`,
    ),
    querySourceBytes: UTF8.encode(
      "export function get(ctx,{id}){return ctx.db.get(id)}",
    ),
  };
}
