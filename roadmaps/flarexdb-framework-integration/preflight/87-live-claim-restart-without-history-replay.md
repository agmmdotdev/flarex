# Live Claim Restart Without History Replay

Status: implemented within approved preflight 76. Records 85 and 86 replace
normal step reconstruction and share receipt evidence within retained full reads.

Before this slice, an ordinary repeated installation call reconstructed the receipt/event graph
during preparation, the readiness probe and claim acquisition, even when it was
resuming the same unexpired claim. The prepared definition and current protected
head are sufficient to decide that continuation. Repeating the full graph before
every externally bounded batch defeats the intended restart behavior.

The coordinator preparation owner authenticates the stored definition and
admission against the request, using the exact locked operational head. The
prepared result carries the definition's needed references, not an unused full
head graph. The ordinary readiness probe can return absence from the current
operational event; it must never return readiness from an observed projection.
A published readiness result continues through its existing full owner.

When the requested attempt ID and lease owner still own an unexpired claim, claim
acquisition restores the immutable attempt/predecessor lineage and uses the
same live progress, event, tail and database-clock checks as the normal command.
It then issues a new source-private claim over that definition. No in-memory
progress or previous process token can grant continuation. Expired/new claims,
takeover and uncertain responses retain their existing full evidence operations.
The existing ordinary/recovery transaction request determines that distinction;
there is no configurable fast mode, fallback on corruption or second settlement
owner. Preparation, readiness probing and claim transactions retain their
existing boundaries and excluded recovery sessions.

Retain canonical admission/plan checks, commerce profile matching, additive base
checks and limits, freshness locks, actual producer lineage, live lease/fence
validation, full takeover/catalog observations and publication proof. Replace
ordinary same-owner live-claim history reads across all three opening phases.
Remove the unused prepared head payload and its misleading aggregate name.
Settled readiness replay and runtime binding cold opening remain separate gates;
this slice does not issue a lightweight replacement for restored readiness.

Restart witnesses reopen partial 7- and 15-step installations with a newly issued
claim and no historical receipt/event restoration, separately from step work.
Preserve missing/changed definition, wrong profile, altered progress/tail/event,
expired lease, competing claimant, takeover and uncertain preparation/claim
witnesses. Run both database lanes, current installation consumers, affected
typechecks/lint and both reviewers, reconcile durable status and commit the
complete slice. Record 74's frozen timing matrix remains an overall gate.
