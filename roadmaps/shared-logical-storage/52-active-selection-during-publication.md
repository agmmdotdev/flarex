# Application active selection during logical publication

Status: core correction required before retiring the physical commerce
commit-hold snapshot witness. This is part of shared-storage consumer cutover,
not advanced schema evolution.

## Reproducible boundary

A PostgreSQL logical Currency command has finished materialization and is held
before physical COMMIT. Its transaction holds the scope publication lock. A
fresh native Currency list request should finish on its own older snapshot;
another write should hit the bounded publication lock timeout. The retained
physical commerce snapshot test proves that behavior for its older host.

The attempted logical replacement formed a new read while the commit was held.
The read waited until the writer's 10-second command deadline and then returned.
`pg_stat_activity` identified the waiting statement as a `FOR SHARE` read of
`fx_system_scope_clock`, blocked on the writer transaction. The Effect trace
placed it in `ApplicationActivation.readActive` through
`ApplicationReadiness.readReady`, before the commerce read session began.
Changing only the later active-selection lock to key-share did not remove the
wait: the legacy readiness read still takes a share lock. The attempted lock
change was reverted. The logical test currently covers older-held snapshot
visibility and protected-execution admission; the physical commit-hold cases
remain until an equivalent logical witness passes.

## Owner and replacement contract

The Application active-selection/readiness owner must separate preparation
from fresh admission so a normal data publication does not serialize an
unrelated snapshot read. Keep scope revocation, generation fencing, active-head
and readiness validation authoritative. A weaker lock is acceptable only if
the complete readiness observations remain coherent and the accepting
transaction revalidates them against the current authority. Do not add a
commerce-side cached selection, bypass readiness, or relax the old test.

Preflight the legacy and composite Application selection paths together, then
select the narrowest common correction. Preserve existing public selection and
activation contracts unless evidence requires a documented break. Validate
held COMMIT reads, concurrent publication refusal, revocation and binding
changes, uncertain outcomes, and source readiness on PGlite where applicable
and ordinary-role PostgreSQL. Migrate the remaining physical snapshot tests
and delete their fixture only after all claims have logical or shared-core
replacement evidence.
