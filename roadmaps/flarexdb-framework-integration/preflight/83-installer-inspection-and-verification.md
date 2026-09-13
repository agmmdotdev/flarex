# Installer Inspection and Verification

Status: implemented within approved preflight 76. The trusted installer now has
all four named operations. Linear full verification and protected direct-step
execution remain open; this construction slice does not change normal execution's
history checks or authorize a fast path.

## Definition and diagnostic ownership

`definition.ts` loads the exact admitted artifact, authenticates its relational
schema, captures placement/plan and applies the existing profile limits. Fresh
installation and diagnostics share this owner. Additive lookup captures the exact
base reference before asynchronous work, then authenticates the existing bounded
base. It reads existing namespace/collision metadata and never creates it merely
to look up a base. Preparation still owns creating candidate metadata.

The installer binds target, artifact-read repository and policy once. `inspect`
and `verify` accept artifact/profile selection and the existing optional additive
base reference, without attempt IDs or lease-owner inputs. They retain the total
call deadline and verification-scope cleanup. Artifact admission, installation,
binding and any administrative repair remain separate operations.

## Inspection is an observation

`inspect.ts` authenticates captured plan/target binding through the structural
owner's existing check, then reads namespace, collision and the current head.
The collision-head repository reuses its bounded root loader and canonical head
decoder, validates normalized lease and progress field shapes/ranges, and returns
an `observed` snapshot or `absent`. It does not lock the installation for future
use, walk current-plan receipt/event history, inspect the catalog or issue a
restored authority object.

Reported counts are observed progress projections. Inspection does not establish
that historical receipts/events corroborate those projections or that physical
structure matches them. Even a complete observed count is not readiness. The
report deliberately has no ready/verified alternative, claim or publication
capability. It can become stale immediately after the read.

## Verification is explicit

`verify` constructs the selected plan internally and delegates to the existing
full verifier: locked head, complete receipt prefix, projected-progress
corroboration, receipt inventory and catalog. It returns `absent` or a diagnostic
`verified` report, never readiness or an automatic repair. Additive verification
retains its existing graph limits and exact base contract.

Neutral witnesses distinguish the operations: absent/partial/settled inspection
performs no event-history restoration; invalid target authority and mismatched
placement fail before reading target state; out-of-range projections fail; a
privileged historical-corruption witness can still be observed but is refused by
explicit verification. Repair is followed by successful full verification. Both
operations leave the head unchanged. Additive diagnostics cover partial and
settled state through the same facade.

The full verifier still uses the current reconstruction repositories. Reading
each node/edge once, protected normal-step transitions, integrated recovery and
finalization cleanup, consumer completion and measured scaling remain the gates
in records 76 and 82. No larger cache, new readiness flag, private repair shortcut,
schema change or package export is introduced here.
