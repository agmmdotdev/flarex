import { dropDatabase } from "pg-god"
import {
  createClient,
  createDb,
  dbExists,
  parseConnectionString,
} from "../../index"

const DB_HOST = process.env.DB_HOST ?? "localhost"
const DB_PORT = process.env.DB_PORT ?? ""
const DB_USERNAME = process.env.DB_USERNAME ?? ""
const DB_PASSWORD = process.env.DB_PASSWORD ?? ""
const DB_AUTHORITY = DB_PORT ? `${DB_HOST}:${DB_PORT}` : DB_HOST

export const pgGodCredentials = {
  user: DB_USERNAME,
  password: DB_PASSWORD,
  host: DB_HOST,
  ...(DB_PORT ? { port: Number(DB_PORT) } : {}),
}

describe("Pg | createClient", () => {
  test("create client connection from connection options", async () => {
    const client = createClient(pgGodCredentials)
    await client.connect()
    await client.end()
  })

  test("create client connection from connectionString without db name", async () => {
    const client = createClient(
      `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_AUTHORITY}`
    )
    await client.connect()
    await client.end()
  })

  test("create client connection from connectionString with db name", async () => {
    const client = createClient(
      `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_AUTHORITY}/foo`
    )
    await expect(() => client.connect()).rejects.toMatchInlineSnapshot(
      `[error: database "foo" does not exist]`
    )
  })
})

describe("Pg | parseConnectionString", () => {
  test("parse connection string without db name", async () => {
    const options = parseConnectionString(
      `postgres://${DB_USERNAME}:@${DB_AUTHORITY}`
    )
    expect(options).toEqual({
      user: DB_USERNAME,
      password: "",
      host: DB_HOST,
      port: DB_PORT,
      database: null,
    })
  })

  test("parse connection string with db name", async () => {
    const options = parseConnectionString(
      `postgres://${DB_USERNAME}:@${DB_AUTHORITY}/foo`
    )
    expect(options).toEqual({
      user: DB_USERNAME,
      password: "",
      host: DB_HOST,
      port: DB_PORT,
      database: "foo",
    })
  })
})

describe("Pg | dbExists", () => {
  beforeEach(async () => {
    await dropDatabase({ databaseName: "foo" }, pgGodCredentials)
  })

  afterAll(async () => {
    await dropDatabase({ databaseName: "foo" }, pgGodCredentials)
  })

  test("return false when db does not exist", async () => {
    const options = parseConnectionString(
      `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_AUTHORITY}/foo`
    )
    const client = createClient({
      host: options.host!,
      port: options.port ? Number(options.port) : undefined,
      user: options.user,
      password: options.password,
    })

    await client.connect()
    const exists = await dbExists(client, options.database!)
    await client.end()

    expect(exists).toBe(false)
  })

  test("return true when db exist", async () => {
    const options = parseConnectionString(
      `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_AUTHORITY}/foo`
    )

    const client = createClient({
      host: options.host!,
      port: options.port ? Number(options.port) : undefined,
      user: options.user,
      password: options.password,
    })

    await client.connect()
    await createDb(client, options.database!)
    const exists = await dbExists(client, options.database!)
    await client.end()

    expect(exists).toBe(true)
  })
})
