# Full-source issuer correction: diagnostic five-scenario run

This preserved run precedes the explicit pin/frame API split. Its directory name
is historical; it is not a final accepted checkpoint. Each scenario used three
quiet samples, one warmup and a separate SQL diagnostic through the direct Node
harness with fresh requests and real ordinary-role PostgreSQL settlement.

| Scenario | Quiet median ms | Diagnostic statements | Transactions |
| --- | ---: | ---: | ---: |
| Standalone Payload | 80.4 | 134 | 9 |
| Standalone Medusa | 302.3 | 301 | 13 |
| Mixed Product | 440.8 | 554 | 49 |
| Mixed Payload | 664.5 | 640 | 50 |
| Mixed workflow | 839.6 | 872 | 63 |

All five graphs succeeded. Three samples provide diagnostic medians, not a P95
acceptance claim. The command took about 164.93 s. Raw reports retain every
sample, setup charge and SQL trace. The
[twenty-sample workflow run](../frontier-candidate-final-full/README.md) preserves
the subsequent performance regression and explains the completion-only extra
issuer work. Neither run measures the later pin/frame split.
