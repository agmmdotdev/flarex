# Effect HTTP Client

## Installed API And Stability

Flarex currently installs `effect@4.0.0-beta.90`. Its client modules are
exported from `effect/unstable/http`:

```ts
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
```

The `unstable` path is significant. Re-check imports, error shapes, and
operator signatures whenever Effect changes. Do not paste v3 `@effect/platform`
examples or a different v4 beta into this workspace.

## Which HTTP Boundary Is This?

| Boundary | Default direction |
| --- | --- |
| Ordinary outbound Internet or URL HTTP from an Effect service | Inject `HttpClient.HttpClient` |
| Browser, Node, or edge transport backed by compatible global fetch | Provide `FetchHttpClient.layer` |
| Custom ordinary fetch implementation for a host or test | Provide `FetchHttpClient.Fetch` to that Layer |
| Cloudflare service binding or Durable Object stub `fetch` | Keep a narrow typed platform capability adapter |
| Inbound Worker, Durable Object, or server request | Use the existing HTTP server/API boundary, not `HttpClient` |
| Generated Worker source or framework-required Promise callback | Keep its host contract; adapt only at the real boundary |

A Cloudflare binding's `fetch` carries platform routing and capability
semantics. Replacing it with `FetchHttpClient.layer` would use global fetch and
can change the target. A custom `HttpClient.make` adapter is possible only when
the owning slice deliberately preserves binding identity, URL conventions,
request/response behavior, cancellation, and tests.

## Target Ordinary Client Shape

Compile stable schemas once, configure shared request policy once during
service construction, and keep each operation named:

```ts
import { Context, Data, Effect, flow, Layer, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"

const CreateWidgetInput = Schema.Struct({ name: Schema.String })
const Widget = Schema.Struct({ id: Schema.String, name: Schema.String })
const encodeCreateWidget = HttpClientRequest.schemaBodyJson(CreateWidgetInput)
const decodeWidget = HttpClientResponse.schemaBodyJson(Widget)

class WidgetHttpError extends Data.TaggedError("WidgetHttpError")<{
  readonly operation: "create"
  readonly cause: unknown
}> {}

class WidgetClient extends Context.Service<WidgetClient, {
  readonly create: (
    input: typeof CreateWidgetInput.Type,
  ) => Effect.Effect<typeof Widget.Type, WidgetHttpError>
}>()("Flarex/WidgetClient") {
  static readonly layer = Layer.effect(
    WidgetClient,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(
          HttpClientRequest.prependUrl("https://widgets.example"),
          HttpClientRequest.acceptJson,
        )),
        HttpClient.filterStatusOk,
      )

      const create = Effect.fn("WidgetClient.create")(function* (input) {
        const request = yield* HttpClientRequest.post("/widgets").pipe(
          encodeCreateWidget(input),
          Effect.mapError(cause => new WidgetHttpError({
            operation: "create",
            cause,
          })),
        )
        return yield* client.execute(request).pipe(
          Effect.flatMap(decodeWidget),
          Effect.timeout("5 seconds"),
          Effect.mapError(cause => new WidgetHttpError({
            operation: "create",
            cause,
          })),
        )
      })

      return WidgetClient.of({ create })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
```

The important shape is transport injection, explicit status policy, typed body
encoding and decoding, timeout, each foreign failure mapped once at its source,
and a Layer that closes the transport requirement. A real Flarex client must
also preserve its existing authentication, maximum-body-size, redirect, and
redaction policy.

## Request Bodies

- `HttpClientRequest.schemaBodyJson(schema)` validates and encodes a typed body.
- `HttpClientRequest.bodyJson(value)` is effectful and reports JSON encoding
  failure, but does not validate a domain schema.
- `bodyJsonUnsafe` may throw during JSON encoding. Use it only when the value is
  already proven serializable and a synchronous request result is genuinely
  needed.
- Set shared headers, base URL, and authentication through a configured client
  or request transformation. Do not log bearer tokens or full payloads.

## Status And Response Policy

Use `HttpClient.filterStatusOk` when every non-2xx response is one integration
failure class. The installed client turns a rejected status into
`HttpClientError` with a `StatusCodeError` reason.

Use `HttpClientResponse.matchStatus` when statuses have different domain
meaning:

```ts
import { Effect, Option } from "effect"

const findWidget = Effect.fn("WidgetClient.find")(function* (id: string) {
  const response = yield* client.get(`/widgets/${encodeURIComponent(id)}`)
  return yield* HttpClientResponse.matchStatus(response, {
    200: response => decodeWidget(response).pipe(Effect.map(Option.some)),
    404: () => Effect.succeed(Option.none()),
    "5xx": response => Effect.fail(new WidgetUnavailableError({
      status: response.status,
    })),
    orElse: response => Effect.fail(new WidgetUnexpectedStatusError({
      status: response.status,
    })),
  })
})
```

Use `HttpClientResponse.schemaBodyJson` for a JSON body. Use `schemaJson` when
status, headers, and body must be decoded as one contract. Schema validation
does not automatically bound the number of response bytes; preserve Flarex's
existing bounded-body rules before parsing attacker-controlled or operational
API responses.

## Retry Policy

The installed client provides `HttpClient.retry` and `retryTransient`.

```ts
import { Schedule } from "effect"

const retryingReadClient = client.pipe(
  HttpClient.retryTransient({
    retryOn: "errors-and-responses",
    schedule: Schedule.exponential(100),
    times: 3,
  }),
)
```

Use this only for operations whose failure classification and idempotency allow
repetition. Do not apply a generic retrying client to mutation POSTs. A POST
needs an idempotency key and a contract explaining ambiguous transport failure
before it can share a retry policy.

## Host And Test Layers

`FetchHttpClient.layer` defaults to `globalThis.fetch`. A host or test can
provide a compatible implementation without threading `fetch` through every
method:

```ts
const httpLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
)
```

For deterministic operation tests, provide a client directly:

```ts
const testClient = HttpClient.make(request =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify({ id: "w1", name: "test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  ),
)

const testLayer = Layer.succeed(HttpClient.HttpClient, testClient)
```

Test request method, URL, headers, encoded body, status branches, Schema
failure, timeout, interruption, retry count, and redaction. Keep a real HTTP or
host smoke lane when platform fetch behavior matters.

## Flarex Adoption Candidates And Exceptions

Strong candidate:

- `packages/executor-http/src/liveQueryDelivery.ts` manually injects fetch,
  constructs ordinary URL requests, maps transport errors, reads response
  bodies, and applies status policy. A future vertical port can replace that
  local raw-fetch subsystem with an injected Effect client while preserving its
  existing Promise-facing compatibility functions.

Do not mechanically port:

- backend calls to `Fetcher`, service bindings, or Durable Object stubs;
- inbound Worker and Durable Object `fetch` methods;
- generated execution-artifact Worker source; or
- plain operational scripts before their runtime and configuration ownership
  is intentionally moved into Effect.

Any future HTTP slice must first classify transport identity, authentication,
redirect policy, timeout, maximum response size, retryability, status/body
contract, observability redaction, and its real host/test Layer.
