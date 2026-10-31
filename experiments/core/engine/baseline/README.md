# Supported consumer baseline

Status: **Source-inspected goal inventory; replacement and fresh runtime proofs
remain open**. This fixes the existing bounded consumer families the
[single-owner goal](../GOAL.md) must migrate. Support means the executing admitted
profile, not every method exported by the native framework or SDK.

| Profile family | Owning inventory |
| --- | --- |
| Application queries, mutations and retained action/task boundaries | [Application](./application.md) |
| Admitted native commerce modules/workflows and checkout | [Medusa](./medusa.md) |
| Native Local API scalar/content/reference profiles | [Payload](./payload.md) |

The [framework capability migration map](./framework-capability-map.md) connects
these native profiles to translated-core foundations, missing shared contracts
and concrete compatibility proofs. It is planning-only and distinguishes
existing native behavior from completed replacement execution.

The enumerating runtime profiles and their connected witnesses define the
boundary. These notes name the owners rather than freezing old private APIs.
Each replacement may break internals while preserving supported behavior and
actual durable obligations. A source-file count is not an operation count or
passing-test count. Proposed features and unrelated work in progress do not
silently expand the goal inventory.

Source inspection is based on Flarex `2fadeab2a` plus the current shared-worktree
bytes, Medusa's recorded source fork and installed Payload 3.88.0. Record changed
executing inputs when a slice begins and compare them with the baseline owners.
Generated runtime artifacts and conditional source/dist exports must be identified
in their actual validation lane; a source-only hash is not a whole-runtime closure.

## Discrepancies resolved for goal scoping

- Older Medusa capability maps describe an inactive source audit or measured
  Currency preflight; they do not enumerate the later executing workflows.
  Current admitted module/workflow code and its meaningful tests take precedence.
- Payload's historical `firstProfile` describes an earlier subset. Later private
  evidence and executing direct/participant profiles include more operations.
  The native query-operator catalog is not the Flarex-admitted grammar.
- SDK query-builder exports do not establish live Application Worker support.
  Baseline the actual query RPC and current function API, including their refusal
  boundaries. Native logical-store aggregates are a separate consumer profile.
- Current tracked native Cart creation/refresh and Promotion computation extend
  the earlier existing-cart checkout inventory. Their bounded executing contracts
  and tests are included in the Medusa map; general Cart/Promotion operations are
  not implied. Recheck and preserve shared-worktree changes before each slice.

This inventory establishes which existing responsibilities enter the goal.
Complete transitive execution closure, updated runtime tests, both database
lanes, actual Cloudflare proof, all required migrations and performance gates
remain explicit implementation/acceptance tasks. No current pass is claimed here.
