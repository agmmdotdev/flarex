# Workflows, Jobs, Queues, and Events

## Medusa Workflow Model

Medusa workflows are Saga-like graphs, not simple database transactions or job
queues.

They support:

- Named workflows and steps.
- Parallel steps.
- Nested workflows.
- Step retries and timeouts.
- Asynchronous steps.
- Step outputs and compensation inputs.
- Compensation on failure or cancellation.
- Workflow hooks.
- Transaction/run identifiers.
- Step idempotency keys.
- Grouped event release.
- Pluggable checkpoint and scheduler storage.

## Cart Creation Example

Medusa's create-cart workflow:

1. Resolves sales channel, region, and customer in parallel.
2. Validates the sales channel.
3. Exposes a pricing-context hook.
4. Gets variants and calculated line items.
5. Confirms inventory.
6. Creates the cart.
7. Updates taxes.
8. Applies promotions.
9. Refreshes payment collection.
10. Emits `cart.created`.
11. Exposes validation and cart-created hooks.

The cart creation step returns created cart IDs as compensation input. If a
later step fails and the workflow compensates, that step deletes the created
carts.

## Decision: Preserve Semantics, Not Engine Code

The framework should offer a Medusa-inspired workflow authoring model but
implement it on Cloudflare-native primitives.

Proposed API direction:

```ts
export const createCartWorkflow = defineWorkflow({
  name: "cart.create",

  input: CreateCartInput,
  output: Cart,

  run: async (workflow, input) => {
    const context = await workflow.step(findCartContext, input)

    const cart = await workflow.step(createCartStep, {
      input,
      context,
    })

    await workflow.parallel([
      workflow.step(refreshPaymentCollectionStep, { cart }),
      workflow.step(emitCartCreatedStep, { cart }),
    ])

    await workflow.hook("cartCreated", { cart })

    return cart
  },
})
```

Step definition:

```ts
export const createCartStep = defineStep({
  name: "cart.create-record",

  run: async (ctx, input) => {
    const cart = await cartService.create(ctx, input)

    return stepResult({
      output: cart,
      compensate: { cartId: cart.id },
    })
  },

  compensate: async (ctx, input) => {
    await cartService.delete(ctx, input.cartId)
  },
})
```

This syntax is illustrative. Exact authoring syntax remains an implementation
question.

## Idempotency Model

At-least-once execution must be assumed for queues, retries, and external
callbacks.

Recommended identities:

```text
workflow definition: workflowName
workflow execution: workflowName + executionId
step execution: workflowName + executionId + stepName + direction
external command: caller-provided idempotency key
event delivery: eventId + consumerName
```

Rules:

- API callers may provide an idempotency key for commands.
- The framework maps deterministic command keys to workflow execution IDs.
- Step execution records store attempts, status, output, compensation input,
  and errors.
- A completed step returns its stored result instead of repeating side effects.
- External provider calls must receive provider-specific idempotency keys when
  supported.
- Queue consumers must record delivery completion by event and consumer.

Idempotency prevents duplicate execution. It does not automatically make a
business operation reversible.

## Compensation

Compensation is an explicit business action, not a database rollback.

Examples:

- Create cart -> delete cart.
- Reserve inventory -> release reservation.
- Create payment session -> cancel payment session.
- Create fulfillment -> cancel fulfillment if provider supports it.

Compensation can fail and must have its own retries, state, and observability.
Some actions are irreversible; workflows must model those boundaries explicitly.

## Event Grouping and Outbox

Medusa groups workflow events and only releases them when the workflow succeeds.
The new framework should preserve this semantic.

Recommended design:

1. A step writes domain state and outbox events in the same short DB
   transaction where possible.
2. Events carry a workflow event-group ID.
3. Events remain unreleased while the workflow is running.
4. Successful completion releases the group to Cloudflare Queues.
5. Failure or compensation clears/cancels unreleased events.

Consumers remain idempotent because queue delivery is at-least-once.

## Cloudflare Mapping

| Framework concept | Cloudflare primitive |
|---|---|
| Durable workflow execution | Cloudflare Workflows |
| Retryable background delivery | Cloudflare Queues |
| Scheduled job | Cron Trigger or scheduled Workflow |
| Waiting for external callback | Workflow event |
| Single-owner coordination | Durable Object |
| Per-resource wakeup | Durable Object alarm where appropriate |
| Workflow/business state | Commerce DB plus workflow execution storage |

Cloudflare Workflows provides durable step execution, retries, sleeping, and
events. The framework must add Saga compensation, commerce hooks, grouped event
release, and compatibility semantics.

## Jobs

Medusa scheduled jobs are wrapped as scheduled workflows. The new framework
should use the same conceptual model:

```ts
export const abandonedCartJob = defineJob({
  name: "cart.abandoned.scan",
  schedule: every("1 hour"),

  run: async (ctx) => {
    await abandonedCartWorkflow.start(ctx, {
      before: ctx.scheduledAt,
    })
  },
})
```

The compiler decides whether this becomes a Cron Trigger, scheduled Workflow,
or another supported Cloudflare primitive.

## Event Consumers

```ts
export const orderCreatedConsumer = defineConsumer({
  name: "send-order-confirmation",
  event: "order.created",

  run: async (ctx, event) => {
    await notificationService.sendOrderConfirmation(ctx, event.data)
  },
})
```

The consumer definition should include retry/dead-letter policy and an
idempotency identity.

## Open Questions

- Should every short workflow use Cloudflare Workflows, or should the runtime
  support an inline execution mode with the same definition?
- How should workflow definition versioning behave for executions that outlive
  a deployment?
- Which workflow execution data belongs in Cloudflare Workflows versus a
  framework-owned inspection store?
