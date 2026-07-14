# Runtime Topology Probe Agent Rules

These rules apply only inside `apps/runtime-topology-probe`.

This app is an isolated Cloudflare topology and latency experiment, not the
main Flarex implementation. Once the user approves the complete experiment
described in `PLAN.md`, agents should research and execute its ordered gates
without pausing for a separate approval after every gate. Keep each gate's
preflight, challenge, boundary, and proof explicit in the working plan and task
updates.

This local exception changes only the parent repository's per-gate approval
pause. It does not relax any other parent rule:

- keep the experiment isolated from production Flarex data and resources;
- do not update active architecture roadmaps merely to describe this probe;
- keep Postgres, OCC, compiler, and real sync semantics out of mocked paths;
- use the required reviewers before significant code checkpoints;
- validate proportionally, keep commits scoped, and preserve unrelated work;
- recheck the exact Cloudflare account, resource names, secrets, limits, cost
  budget, and teardown path before an external deployment; and
- stop for user direction if work would expand beyond the approved experiment
  or the external target cannot be identified safely.
