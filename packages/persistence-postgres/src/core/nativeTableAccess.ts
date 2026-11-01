import type { CoreTableDefinition } from "./api";

/** Native registry authentication proves the stored role before serving. A
 * private name alone does not establish either ownership or write authority. */
export function isCorePrivateTable(table: Pick<CoreTableDefinition, "nativePolicy">): boolean {
  return table.nativePolicy?.privateReference !== undefined || table.nativePolicy?.privateEvent !== undefined;
}

/** Source's system/user accounting distinction includes native-owned logical
 * projection records, whose legal lowered names are not application capabilities. */
export function isCoreSystemTable(table: Pick<CoreTableDefinition, "name" | "nativePolicy">): boolean {
  return table.name.startsWith("_") || isCorePrivateTable(table);
}

/** Durable event rows retain ordinary native observations and constraints even
 * though their owner charges them as private system records. */
export function isCoreNativeObservedTable(table: Pick<CoreTableDefinition, "name" | "nativePolicy">): boolean {
  return !isCoreSystemTable(table) || table.nativePolicy?.privateEvent !== undefined;
}
