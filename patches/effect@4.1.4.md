# Effect 4.1.4 cancellation Cause preservation

Flarex retains the complete Cause when foreign work rejects while cancellation
drains it. Effect 4.1.4 skips outer recovery handlers during interruption and
also removes every typed failure from the accumulated Cause. This erases late
native rejection evidence that RC112 retained, even after classification at the
owning boundary. Defects survive, so reclassifying errors would hide the mismatch.

The pinned patch removes that filtering in the source and published runtime.
Recovery handlers are still skipped; interruption, draining and finalization are
unchanged. Empty replacement lines keep retained statements at their published
source-map positions; the inline source content is updated consistently.
The patch does not run skipped type-changing mappers. Full-Cause projection
owners must mask their completed-Cause projection while restoring interruptibility
for work; the Core-to-CMS `nativeResult` owner follows that contract.

`test/execution/effectInterruptionCause.test.ts` in persistence checks skipped
handlers plus retained typed cleanup failures. Payload's actual `native-drain`
tests check Promise drain, close ordering, rejection identity and interruption
on PGlite and optional ordinary-role Postgres. Remove this patch only when an
upstream release passes those same contracts without it.
