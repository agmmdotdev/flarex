# Trigger Checkpoints And Native Waits

Status: **accepted preservation requirements; runtime mapping pending**.
Source pin and selected profile are recorded in [REFERENCES](../REFERENCES.md)
and the [first slice](../slices/01-source-and-installation-contract.md).

Trigger checkpoints describe process images; the admitted Flarex/Medusa consumer
persists opaque serialized workflow bytes, revision/digest and original wait
start/deadline. Preserve atomic checkpoint plus suspension, one durable winner
for confirm/timeout/cancel, old receipt replay after lease retirement and fresh
charged execution/control authority on resume. No transaction or lease spans a
pause and no arbitrary process suspension is claimed on Cloudflare.

First proof admits one run with one manual/native wait, not Task hierarchy.
Commerce child receipts retain their own authority/idempotency and native
compensation at consumer cutover. Source-reachable waitpoint cleanup must remain
correct even when unsupported hierarchy/batch inputs are refused.

Prove confirm/timeout/cancel races, revoked-subject rollback, forged checkpoint/
descriptor, exact body and principal correlation, original deadline preservation
and cold continuation. Validate complete record byte bounds around the existing
1 MiB checkpoint limit. Broader cancellation/fan-out needs indexed bounds and
durable progress; source chunk sizes alone do not establish total work limits.
