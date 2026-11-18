# Trigger Mutate-Then-Refuse Start Outcome

Status: **implemented portable outcome; shared-core settlement integration pending**.
At pinned Trigger `f10bc23785e569e5d917318cf2033aabdbe96a0b`,
`RunAttemptSystem.startRunAttempt` checks the next ordinal against 250, calls
`attemptFailed` with synthetic `TASK_RUN_CRASHED` / `Max attempts reached.`,
then throws `ServiceValidationError`. That synthetic completion has no retry
settings and the reached source classification permanently fails the run.

Flarex's borrowed operation is settled by its trusted outer owner. Translating
the final expected refusal into `Effect.fail` inside that operation would roll
back the terminalization that the source branch preserves. Return a precise
tentative Outcome for completed terminalization plus refused start. Only after
confirmed settlement may the outer caller expose the refusal. That Outcome is
not a commit receipt or permission to launch code.

Ordinary snapshot/run/state/lock validation refusals remain typed failures with
no writes. A persistence or authority failure while terminalizing still fails
the operation; defects/interruption and uncertain outcomes are not converted
to successful refusal data. There is no callback letting an adapter choose the
failure/retry policy and no broad `catch` translating every store error to 500.

The [component tests](../slices/02-adopted-attempt-start.md) prove branch and
channel behavior through primitive ports. Real atomic settlement, lost-response
replay and error projection need both database lanes at the later shared-core
integration gate; mocked successful values cannot establish those guarantees.
