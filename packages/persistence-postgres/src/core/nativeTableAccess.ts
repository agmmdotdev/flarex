import type { CoreTableDefinition } from "./api";

/** Native registry authentication proves the stored role before serving. A
 * private name alone does not establish either ownership or write authority. */
export function isCorePrivateTable(table: Pick<CoreTableDefinition, "nativePolicy">): boolean {
  return table.nativePolicy?.privateReference !== undefined;
}

/** Source's system/user accounting distinction includes native-owned logical
 * projection records, whose legal lowered names are not application capabilities. */
export function isCoreSystemTable(table: Pick<CoreTableDefinition, "name" | "nativePolicy">): boolean {
  return table.name.startsWith("_") || isCorePrivateTable(table);
}
