# Application active selection during logical publication

Status: the read-only selection correction and logical Currency commit-hold,
binding-change and revocation witnesses are implemented. Physical
installation/profile binding cases retain their host consumer. This is part of
shared-storage consumer cutover, not advanced schema evolution.

## Reproducible boundary

A PostgreSQL logical Currency command has finished materialization and is held
before physical COMMIT. Its transaction holds the scope publication lock. A
fresh native Currency list request should finish on its own older snapshot;
another write should hit the bounded publication lock timeout. The logical
Currency commit-hold witness now proves that behavior under both host roots.

The initial logical replacement formed a new read while the commit was held.
The read waited until the writer's 10-second command deadline and then returned.
`pg_stat_activity` identified the waiting statement as a `FOR SHARE` read of
`fx_system_scope_clock`, blocked on the writer transaction. The Effect trace
placed it in `ApplicationActivation.readActive` through
`ApplicationReadiness.readReady`, before the commerce read session began.
Changing only the later active-selection lock to key-share did not remove the
wait: the legacy readiness read still takes a share lock. The attempted lock
change was reverted. A connected logical Currency test reproduced the timeout
under both standalone and atomic hosts before the core correction.

## Owner and replacement contract

Read-only legacy readiness and active-selection transactions now use the core
scope-clock snapshot-read (`FOR KEY SHARE`) lock. The relation active-read path
uses the same lock; composite binding preparation already reconstructs its
planning inputs in the accepting transaction. PostgreSQL permits an ordinary
publication's non-key clock update to overlap a key-share read, while a scope
lifecycle transition still requires `FOR UPDATE` and cannot overlap it. The
stored-readiness check reuses the clock already locked by its read transaction
instead of silently reacquiring `FOR SHARE`. These changes keep the public
selection and activation shapes and all stored formats intact. A selection
may observe the last committed state while a normal publication is pending;
it is not serving authority. The accepting transaction still verifies live
scope, generation, revocation, active head, binding and selected readiness
dependencies. Activation and readiness settlement keep their strong locks.

Application point commits also advance physical index coverage with the scope
clock. The physical-readiness reader now obtains the build rows and their clock
from one nonblocking PostgreSQL statement snapshot. This prevents a
`READ COMMITTED` selection from pairing coverage at N+1 with an earlier clock
at N or waiting on a build row held by an ordinary publication. The accepting
transaction still validates its own current readiness evidence. If a later
table-frontier read observes another commit during inspection, the reader
rechecks the clock and retries the provisional result within a bound instead
of reporting the older build as permanently uncovered.
Unique-set readiness uses the existing concurrent-progress observation lane:
key-share protection on the scope clock and selected build rows lets ordinary
non-key coverage updates proceed, then a second clock observation validates
the selected rows. A changing clock causes a bounded inspection retry before
returning a readiness verdict. Strong lifecycle changes still conflict with
key-share.

The logical Currency commit-hold witness now proves a fresh older-snapshot
read completes before COMMIT, a competing write gets the bounded publication
lock refusal, and only one write publishes with replay. The physical commerce
snapshot fixture is retired. Logical Currency also covers binding removal and
authorization revocation after snapshot formation and before native work.
Binding removal reports `bindingChanged`; scope revocation reports
`invalidAuthority`. A rejected read leaves logical rows, history, indexes,
facts, events and outcomes untouched. Other physical installation/profile
binding cases retain their separate consumer until logical or shared-core
witnesses replace them. Validate
legacy and relation selection, failure/recovery and source readiness on PGlite
where applicable and ordinary-role PostgreSQL. Remove the remaining physical fixture
only after those claims and its remaining consumers have replacement evidence.
The ordinary-role PostgreSQL readiness witness also holds a clock and enabled
index-build coverage update through COMMIT, checks selection before release,
and checks a stale-clock call against the newly committed build row.
A separate unique-set witness holds its enabled coverage update through COMMIT
and checks readiness both before and after release.
