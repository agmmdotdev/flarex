# Settled Readiness Evidence Handoff

Status: implemented within approved preflight 76. Settled replay now hands off
its existing readiness. Record 91 owns completed bounded acceptance and cleanup.

The outcome is one full locked migration-head proof on a settled coordinator
open, followed by fresh availability head and history reads using that proof's
exact readiness. Persistence's existing availability owners retain canonical,
normalized-reference, status and history-chain validation. This removes the two
extra installation/terminal reconstructions in the measured settled replay.

Retain the full head and event proof, exact prepared plan, actual availability
rows and chain, and ordinary absence/error distinctions. A supplied readiness
must be issued evidence for the selected installation and must match the actual
history reference. Do not substitute it for another referenced readiness or
reuse the mutable availability decision across transactions. Independent readers
continue to corroborate their own prerequisites. Runtime cold construction keeps
its schema-only target and complete evidence contract; it needs no installer
privilege authority. Recovery remains in its existing excluded session.

Extend the source-private availability restoration handoff using the existing
reader and canonical issuers. Reject a cache, alternate head, mode, new public
export or fabricated stored authority. The coordinator should visibly supply the
readiness already obtained from its full head proof.

Require one receipt/attempt/terminal issuance per settled replay in increasing
neutral inventories. Alter actual head/history references and bytes, and remove
selected rows: each must refuse readiness and a clean retry must succeed. Retain
revocation, one-hop additive, stale-plan, independent repository, uncertain
COMMIT and consumer regressions on both drivers. Finish with affected checks,
both read-only reviews, scoped cleanup and a coherent commit. Timing acceptance
and paused ShippingProfile activation remain separate gates.
