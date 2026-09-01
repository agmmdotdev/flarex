import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { describe, expect, it } from "vitest"
import { toDrizzleWhere } from "./repository"

describe("toDrizzleWhere", () => {
  it("translates the portable filter contract to SQLite SQL", () => {
    const currency = sqliteTable("currency", {
      code: text("code").primaryKey(),
      name: text("name").notNull(),
    })
    const condition = toDrizzleWhere(currency, {
      $or: [{ code: ["usd", "eur"] }, { name: { $ne: "Unknown" } }],
    })
    const query = new SQLiteSyncDialect().sqlToQuery(condition.getSQL())

    expect(query.sql).toContain("in")
    expect(query.sql).toContain("<>")
    expect(query.params).toEqual(["usd", "eur", "Unknown"])
  })
})
