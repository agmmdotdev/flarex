# Repository Operations

## Goal And Ownership

Flarex operates as an independent project with scoped commits, evidence-backed
rules and complementary TypeScript/Effect and systems reviews.

- `custom/cloudflare-executor` is its own Git repository; the parent Convex
  checkout remains a primary behavior reference and ignores this nested repo.
- `AGENTS.md` owns shared workflow, design precedence, ownership, checks, cleanup
  and scoped commits. Accepted designs/domain roadmaps own architecture and
  current status; Git owns chronology and validation receipts.
- Significant code changes require spawning both read-only project reviewers:
  `typescript-diff-reviewer` and `code-quality-diff-reviewer`. AGENTS.md owns
  exemptions, checkpoint inputs and final rerun requirements. The main thread
  owns fixes and Git and preserves unrelated work.
- No routine requirement to create a new planning document or spawn other
  agents follows from these review rules.

## Reviewer Responsibilities

The TypeScript reviewer owns type/runtime/encoded contract agreement, public
API compatibility, soundness, responsibility/utility placement, existing-owner
reuse and Effect implementation quality. Every materially changed TypeScript
operation receives a semantic applicability assessment, including plain
Promise/throw/null/ad-hoc substitutes without Effect imports.

The systems reviewer owns behavioral/data correctness, trust, transactions,
concurrency, recovery, reliability, performance, operability, maintainability
consequences and test adequacy. It reports concrete systems effects in Effect
code without repeating Effect API/style checks.

Reviewer definitions in `.codex/agents/*.toml` own investigation and finding
formats. Reviews trace connected contracts/owners and falsifiable failure
scenarios, distinguish executed checks from supplied/static evidence, and
disclose scope/gaps. Green checks, counts and "no findings" do not prove overall
quality. Concrete materially connected pre-existing debt is labeled; unrelated
audits and package migrations are outside checkpoint scope.

## Implementation Guidance

`.agents/skills/effect-ts-patterns/SKILL.md` owns construct selection and active
implementation practice. `effect-ts-error-handling` owns failure/retry/recovery
semantics; `.codex/agents/effect-review-guide.md` owns Flarex API facts and
platform/contract exceptions. Their optional references and
[Effect-native guidance](./effect-native-guidance/README.md) supply focused
examples and domain evidence; do not duplicate their cookbook here.

Apply those standards while implementing and correct authorized connected
touched-flow debt with decisive validation. Existing inconsistency is not
precedent. Preserve pure helpers and deliberate framework/protocol boundaries;
do not turn a checkpoint into a repository-wide migration.

## Limits And Sources

Verify installed APIs against manifests/lockfile before copying version-specific
examples. Optional `opensrc/` caches (Effect-smol and T3 Code) can be stale or
absent; current installed source and accepted contracts take precedence.
Reviewers do not replace focused security/database/migration/Cloudflare or
ordinary-role real-Postgres validation. Distinguish private conformance from
public capability, deployment and production evidence.
