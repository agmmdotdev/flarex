const ALIAS_REPLACEMENT = "[::alias::]"

type RawSqlInput =
  | string
  | { toString(): string }
  | ((alias: string) => string)

export type SqlEntityManager = {
  getKnex(): unknown
}

export function raw(sql: RawSqlInput): string {
  const rendered = typeof sql === "function" ? sql(ALIAS_REPLACEMENT) : `${sql}`

  return `[raw]: ${rendered}`
}
