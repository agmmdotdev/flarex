# Direct Read Capabilities

Status: **implemented; local consumer cutover complete** under the owner's execution
organization request. This is the first connected slice of the
[execution architecture roadmap](README.md).

## Outcome And Evidence

Construct direct Commerce and CMS readers as actual read capabilities. Keep
native Product/Payload behavior and the existing managed transaction unchanged.
Migrate the real adapter, fixture and benchmark callers together.

The audited draft's `commerceTransaction/readHost.ts` returns a full CommerceHost
with fabricated request keys and rejecting `run`/`initialize` methods. The CMS
reader similarly exposes `run` and request keys. Ordinary host constructors
dispatch between read-only and write-capable behavior using `readProfile`.
CMS read construction imports command lookup and failure projection from the
write-capable host, which imports read construction back. Its input is derived
by subtracting write fields from SourceCmsHostInput.

These are real contract and ownership problems: callers cannot tell which
capabilities exist from the returned type, and read execution depends on write
orchestration. Removing them makes direct calls understandable before reorganizing
larger mutation/workflow paths.

## Selected Contract And Owners

- Add independent `CommerceReadHost` and `CmsReadHost`: `read`, `close`, and the
  existing CMS read budget. No write, initialization or request-key method.
- Use explicit `makeCommerceReadHost` / `makeCmsReadHost` constructors and read
  inputs requiring the actual managed installation. Remove the managed branch
  from ordinary host construction. The read constructor needs no mode switch.
- Keep read construction in `commerceTransaction/read/` and `cmsTransaction/read/`.
  Share valid neutral trusted configuration through named owner types; do not
  derive a read contract from a write contract through chains of Omit.
- Move the single CMS command registry to `commands.ts` and exact request failure
  projection to `failure.ts`. Migrate all consumers; preserve token identity,
  failure ordering, Cause handling and native errors.
- Payload runtime exposes explicit `bindRead` alongside the existing `bind`.
  Both use the same scoped native instance and native operations. Scope owns
  host closure, and liveness refusal remains exact.
- Migrate native Product reader fixtures, managed Payload proof, retained runner
  and cold benchmark construction. Historical benchmark reports stay unchanged;
  they do not claim to measure this new source revision.

## Alternatives Challenged

Renaming folders alone leaves fake capabilities and cycles intact. Keeping one
large host interface with optional or rejecting methods makes consumers discover
capabilities at runtime. A generic execute(mode, framework, operation) engine
would hide meaningful lifetimes and add unnecessary abstraction. Separate native
read implementations would duplicate framework behavior. Explicit constructors
with restricted results address the actual problem without changing settlement.

## Breaks, Cutover And Cleanup

| Contract/path | Disposition | Consumer or reason |
| --- | --- | --- |
| Managed input accepted by ordinary makeCommerceHost/makeCmsHost | Replace | Native read callers use explicit read constructors |
| Managed readProfile selector | Delete | Constructor and installation capability make it redundant |
| Rejecting write/initialize methods and generated request keys on readers | Delete | Read callers receive no write authority |
| CMS command registry inside host.ts | Move, one owner | Direct host, read host, borrowed attempt and cross-domain callers share the same authenticated tokens |
| CMS failure projection inside host.ts | Move, preserve behavior | Read/write/borrowed callers share one projection |
| Full-proof direct read/write host | Retain | Existing physical and logical callers; remove only after their installation/profile cutover is validated |
| Managed transaction, read admission, installation, storage decoder | Retain | Shared authoritative mechanics; no duplicated execution path |
| Prior uncommitted read redesign | Retain separately | Open validation/installation obligations remain owned by its preflight |

Private TypeScript construction contracts and source paths break. All known
callers migrate in the slice. No schema, durable identity, journal format or
stored data changes. No compatibility re-export of displaced private ownership
solely to avoid moving callers. No new Application cross-framework query support,
workflow admission, hooks, deployment or performance promise.

## Validation And Completion

The capability split has focused type, native behavior, lifetime and PostgreSQL
snapshot coverage. Broader draft completion remains blocked by the existing
installation cutover and read-metadata publication of candidates containing
Payload views, as recorded in the
[owning read preflight](../core-performance/standalone-read-redesign-preflight.md#read-metadata-publication-for-view-sources).
Existing draft lint findings and the Currency promotion source guard also need
resolution before a coherent commit. Preserve these checks and their witnesses;
do not relax them to complete the organization slice.

Ordinary PostgreSQL CMS validation exposed a fixture setup defect: the relation
readiness fixture declared `public` as its default physical locator while its
file-scoped migrations were installed in a disposable namespace. Activation
then failed before host execution because the qualified read-binding publication
function did not exist in `public`. The fixture now derives its default schema
from its actual connection and preserves every explicit locator override. This
corrects the test's placement declaration; production lookup and authority checks
remain unchanged. Keep the PostgreSQL activation and snapshot witnesses intact.

After that setup correction, the binding-transition witness reached the existing
CMS error projection. The binding owner reports a PostgreSQL serialization
conflict as `DataBindingError.resourceFailure`; the saved draft already maps it
to `CmsTransactionError.resourceFailure`. The old assertion expected the separate
scope-authority `invalidAuthority` projection for both transitions. The witness
now names the binding error owner while still requiring SQLSTATE `40001`, no
native callback, fresh-request success and released connections. Revocation keeps
its original expectation. No runtime failure classification changed in this slice.

Verify the new read API's absence of write capabilities and continued refusal of
a write token passed through `read`. Retain actual native Product and Payload
DTO/error/access tests, writer progress/snapshot tests, cleanup/interruption and
stale-authority tests. Exercise affected CMS direct and borrowed consumers.

Run affected persistence, adapter and benchmark typechecks, focused PGlite and
ordinary-role PostgreSQL suites, core/diff lint and both project reviewers.
Inspect exports/imports to prove the CMS cycle and old managed branch are gone.
Do not accept skipped database tests as passes. Keep source guard and historical
measurement provenance honest. Stop owned validation resources afterward.

Review against the saved pre-refactor draft snapshot, with connected code
inspection. The inherited incomplete draft is not a completed baseline: do not
stage or commit it merely to obtain a convenient refactor base. A scoped commit
requires independently coherent verified contents; otherwise leave the reviewed
delta uncommitted and report the inherited cutover blocker explicitly.
