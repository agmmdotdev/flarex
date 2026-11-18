# Stopped setup attempt

The first traced smoke attempt stopped during workload setup with `ENOSPC`
before its first request sample. Its ignored work directory contained a
zero-byte `raw.json`; it produced no report or usable sample. After disk
recovery, the focused failure tests and readiness SQLSTATE classification
correction were completed. The final source was then frozen for the successful
16-sample traced smoke and 104-sample untraced full series, each in a separate
output directory. Those successful series
are retained here with their own manifests. No sample from the stopped
attempt is included in either series or their exclusion lists.
