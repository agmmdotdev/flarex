const DB_HOST = process.env.DB_HOST ?? "localhost"
const DB_PORT = process.env.DB_PORT ?? ""
const DB_USERNAME = process.env.DB_USERNAME ?? "postgres"
const DB_PASSWORD = process.env.DB_PASSWORD ?? ""

export const pgGodCredentials = {
  user: DB_USERNAME,
  password: DB_PASSWORD,
  host: DB_HOST,
  ...(DB_PORT ? { port: Number(DB_PORT) } : {}),
}
