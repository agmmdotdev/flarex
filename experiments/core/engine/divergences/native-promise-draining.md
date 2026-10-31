# Native Promise completion and cancellation

Status: **Necessary native/runtime adaptation; selected Payload boundary implemented and under review; general native hosting remains open.**

## Source and reason

Pinned Convex `crates/database/src/transaction.rs` consumes one owned transaction
at finalization; its pending state cannot remain borrowed by unfinished work.
The [operation-exclusion translation](./transaction-operation-exclusion.md)
preserves that rule in TypeScript. Convex has no Payload Local API integration
whose foreign JavaScript Promise can ignore an AbortSignal and continue using a
request after the Effect caller is interrupted. A cancellation request cannot
establish that this native work has stopped.

## Responsible owners and mechanism

`packages/payload-adapter/src/operations.ts` owns the actual Local API Promise.
It forwards cancellation and drains that same Promise before the request can
finish. Its foreign-error boundary maps known native/CMS rejections to their
typed failures and unknown rejections to defects, retaining existing interruption
and defect reasons. It does not create another request, transaction or runner.

`packages/persistence-postgres/src/execution/preparation/boundedRequestLifetime.ts`
owns deadline competition and request shutdown. A race's internal cancellation
must not discard the completed native operation's additional failure. Preserve
the caller/winner Cause and distinct completed typed/defect reasons by their
existing origin identity; retain sticky request failure and avoid duplicating
the race's internal interruption. Sealing, host close and trusted finalization
follow actual completion. PostgreSQL transactions never span native callbacks.

This preserves the intended drain and failure contract while correcting an
observed loss of late rejection. It grants neither arbitrary hooks nor a claim
that uncooperative foreign code can be forcibly stopped within a deadline.
Native bodies are not replayed, and ambiguous persistence still uses the shared
outcome/recovery owner.

## Required evidence and limits

The actual native drain cases in
`packages/payload-adapter/test/native-drain.test.ts` cover cancellation while a
hook ignores the signal, close waiting for release, and late known rejection or
unknown defect alongside the original interruption. Existing bounded-lifetime
and operation-tracing regressions retain their behavioral assertions. The
[selected native slice](../slices/10-payload-native-core-cutover.md) owns database,
consumer and review gates. Local native proof does not establish Cloudflare
native deployment, general hook support or production capacity.
