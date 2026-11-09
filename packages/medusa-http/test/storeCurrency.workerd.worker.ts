/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers"
import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { z } from "@medusajs/framework/zod"
import { Effect, Exit, Scope } from "effect"
import { makeStoreCurrencyEffectHttpHandler } from "../src/effectHost.mjs"

const currencies = [
  { code: "eur", name: "Euro", symbol: "€", symbol_native: "€", decimal_digits: 2, rounding: 0 },
  { code: "usd", name: "US Dollar", symbol: "$", symbol_native: "$", decimal_digits: 2, rounding: 0 },
]
const queryInput = z.object({ __value: z.object({ currency: z.object({
  fields: z.array(z.string()),
  __args: z.object({
    filters: z.object({ code: z.union([z.string(), z.array(z.string())]).optional() }).passthrough(),
    skip: z.number().optional(), take: z.number().optional(),
  }),
}) }) })
interface Env { readonly ROUTE_FIXTURES: DurableObjectNamespace<StoreCurrencyRouteFixture> }

/** Actual DO transport with fixture-only reads; no production registration or persistence claim. */
export class StoreCurrencyRouteFixture extends DurableObject<Env> {
  readonly #scope = Scope.makeUnsafe()
  readonly #scopes = new WeakMap<Request, { id: number; customerAuthorization: boolean }>()
  #sequence = 0
  #host: Promise<Effect.Success<ReturnType<typeof makeStoreCurrencyEffectHttpHandler>>> | undefined

  #getHost() {
    return this.#host ??= Effect.runPromise(Scope.provide(this.#scope)(makeStoreCurrencyEffectHttpHandler({
      storeCors: "https://store.example",
      createRequestScope: request => {
        if (request.headers.has("x-flarex-executor-token")) throw new Error("Private transport token reached Medusa")
        this.#scopes.set(request, { id: ++this.#sequence,
          customerAuthorization: request.headers.get("authorization") === "Bearer customer-fixture" })
        return createContainer().register({
          configModule: asValue({ projectConfig: { http: {} } }),
          logger: asValue({ error: () => undefined, info: () => undefined }),
          query: asValue({ graph: async (input: { filters: { token: string } }) => ({
            data: input.filters.token === "pk_workerd" ? [{ id: "key_workerd", token: "pk_workerd",
              revoked_at: null, sales_channels_link: [{ sales_channel_id: "sc_workerd" }] }] : [],
          }) }),
          remoteQuery: asValue(async (input: unknown) => {
            const query = queryInput.parse(input).__value.currency
            const code = query.__args.filters.code
            const selected = currencies.filter(currency => code === undefined
              || (typeof code === "string" ? currency.code === code : code.includes(currency.code)))
            const rows = selected.map(currency => Object.fromEntries(query.fields.filter(field => field in currency)
              .map(field => [field, Reflect.get(currency, field)])))
            if (query.__args.take === undefined) return rows
            const skip = query.__args.skip ?? 0
            return { rows: rows.slice(skip, skip + query.__args.take),
              metadata: { count: rows.length, skip, take: query.__args.take } }
          }),
        })
      },
    })))
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("x-flarex-executor-token") !== "private-route-fixture")
      return Response.json({ error: "unauthorized" }, { status: 401 })
    const path = new URL(request.url).pathname
    if (path === "/__proof/close") {
      await Effect.runPromise(Scope.close(this.#scope, Exit.void))
      return Response.json({ closed: true })
    }
    if (path === "/__proof/resources") return Response.json({ scopes: this.#sequence, initialized: this.#host !== undefined })
    const headers = new Headers(request.headers)
    headers.delete("x-flarex-executor-token")
    const customerRequest = new Request(request, { headers })
    const application = await this.#getHost()
    const response = await application.handler(customerRequest)
    const responseHeaders = new Headers(response.headers)
    const scope = this.#scopes.get(customerRequest)
    if (scope !== undefined) {
      responseHeaders.set("x-proof-request-scope", String(scope.id))
      responseHeaders.set("x-proof-customer-authorization", String(scope.customerAuthorization))
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ROUTE_FIXTURES.getByName("fixture:store-currency").fetch(request)
  },
} satisfies ExportedHandler<Env>
