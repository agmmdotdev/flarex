import { Result } from "effect";
import type { RelationalPhysicalLayout, RelationalPhysicalTable } from "../relationalSchema/physical/model";
import { isCapturedRelationalPhysicalLayout } from "../relationalSchema/physical/canonical";

/** A physical constraint, not a partial index or an inferred business identifier. */
export function selectRelationalRowKey(
  layout: RelationalPhysicalLayout, tableId: string, keyId?: string,
): Result.Result<RelationalPhysicalTable["keys"][number], "invalidKey"> {
  if (!isCapturedRelationalPhysicalLayout(layout)) return Result.fail("invalidKey");
  const table = layout.frame.tables.find(item => item.identity.tableId === tableId);
  const key = table?.keys.find(item => keyId === undefined ? item.kind === "primary" : item.identity.keyId === keyId);
  if (table === undefined || key === undefined || key.columns[0] !== "scope_uuid" ||
    key.columns.length < 2 || key.columns.length > 17 ||
    key.columns.slice(1).some(name => {
      const column = table.columns.find(item => item.name === name);
      return column === undefined || column.type !== "text" || column.nullable;
    })) return Result.fail("invalidKey");
  return Result.succeed(key);
}
