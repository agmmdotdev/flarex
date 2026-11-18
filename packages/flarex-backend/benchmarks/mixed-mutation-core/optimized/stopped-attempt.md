# Stopped setup attempt before the corrected smoke

The first optimized smoke attempt was interrupted after roughly three minutes without completing `prepareMixedMutationPerformanceSeries`. It produced no sample or `raw.json`; no result has been imputed for it.

During that attempt, PostgreSQL backend PID 6252 was idle in a transaction after a new frontier batch and held the scope-clock row lock. Backend PID 3272 waited on a transaction-ID lock while seeking `fx_system_scope_clock FOR NO KEY UPDATE`. The working-set read path was found to invoke nested `requireAdmission` inside a checked read transaction. The owner moved that admission before `runRead`. The subsequent neutral PostgreSQL working-set test, Product and workflow Worker success tests on PGlite and PostgreSQL, and the 16-sample smoke passed. The observation identifies the lock cycle in this local run; it does not measure general PostgreSQL or production performance.

The completed smoke's `raw.json` and `report.md` belong to the later attempt. The smoke may have overlapped a brief lint run during setup or early Product samples, and a later review found a verdict-ordering issue to correct before final measurement. It is retained as diagnostic evidence, not the final 104-sample distribution.
