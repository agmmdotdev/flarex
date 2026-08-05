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
      'import{databaseInsert}from"flarex:platform";' +
        `export function create(_,a){return databaseInsert("${tableName}",a)}`,
    ),
    querySourceBytes: UTF8.encode(
      'import{databaseGet}from"flarex:platform";' +
        "export function get(_,{id}){return databaseGet(id)}",
    ),
  };
}
