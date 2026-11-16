# Mechanism: issued workflow captures

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Native write round trips](../slices/native-write-round-trips.md), per-write CPU.
- Owner: `captureWorkflowValue` / `presentWorkflowValue` in
  `packages/medusa-adapter/src/workflow/value.ts`; the SDK port member
  `WorkflowExecutionPort.present` in `packages/medusa-workflows-sdk/src/runtime.ts`.
  Node issuance stays with `capturePrivateJsonData` (`values/privateJsonData.ts`).
- No guarantee, durable data, byte charge, refusal or public contract changes.
  Affected consumer: the finite native Medusa workflow profile only.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `npm-packages/convex/src/server/impl/registration_impl.ts`: every function
  boundary parses its arguments from text (`jsonToConvex(JSON.parse(argsStr))`) and
  returns text (`JSON.stringify(convexToJson(result))`); `runQuery`/`runMutation`
  re-encode arguments (`convexToJson(queryArgs)`) and decode the result.
- A value never crosses a function boundary as a shared object. Each crossing is
  one encode and one decode, and the isolate holds no object the host also holds.
- Convex has no reuse of an already validated value: each function is one
  boundary and its sandbox makes re-validation the only crossing.

## Flarex mechanism and difference

- A Medusa workflow is many steps inside one root, all in one JavaScript realm
  with the trusted runtime. Every step and transform boundary captured its value
  (full descriptor walk into the private JSON form) and immediately thawed it into
  a mutable copy, so a value passed from one step to the next was walked four
  times and never left trusted hands in between.
- Capture now issues a deep-frozen tree. Subtrees with no undefined slot are the
  capture owner's issued nodes; containers leading to an undefined slot are rebuilt
  frozen with the member order the thawed copy had.
- An issued root is remembered by object identity together with the envelope the
  context validated. Capturing that exact root again submits the retained envelope:
  the lifetime check and the byte charge are the same, the walk is not repeated.
  A value assembled from issued subtrees walks only its new containers.
- A mutable copy is made only when a value is handed to a step, transform,
  condition, hook or callback-child caller, once per presentation.

## Why a difference is necessary

Convex's single encode/decode per boundary is the cheapest safe crossing when
the callee is a sandbox. Here the trusted runtime sits between two callbacks of
the same root, so translating the mechanism literally validates our own
immutable output again before validating nothing new. Rejected: trusting thawed
or returned values, structural "looks captured" checks, caches shared across
requests, skipping validation of callback results.

## Preserved and changed guarantees

- Callback code never receives a frozen or shared internal object; each
  presentation is a fresh copy, and a subtree held twice becomes two copies.
- Everything a callback returns, including an untouched presented copy and a
  frozen look-alike, is captured completely. Only identity of objects this owner
  froze is recognized.
- Mutating a presented input cannot reach stored outputs, other steps or the
  result. Undefined presence, key order, limits, charges, error reasons and their
  order are unchanged.
- Issuance conveys value facts only: no source, request, storage or admission
  authority. The registry is weak and holds nothing beyond the value's lifetime.
- Changed: `port.capture` of this profile returns an immutable value; the trusted
  runtime must not mutate it and must present before invoking foreign code.

## Required witnesses and remaining limits

- `packages/medusa-adapter/test/workflow-issued-capture.test.ts`: identity and
  equal charge on recapture, subtree identity in an assembled value, full
  recapture of presented copies and frozen look-alikes, refusal of an invalid
  returned value, isolation of a mutating step and transform.
- `workflow-host.test.ts` and the workflow suites keep the native assertions.
- No database claim.
- Containers leading to an undefined slot are still re-walked; removing that needs
  the sidecar path bounds to be re-derived inside the capture owner.
