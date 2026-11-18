This immutable snapshot was executed and captured before slice09 runtime edits
from Flarex commit `8b52e473dfd66d8b8d7655bf865abc147ba1b154`, with the Convex
reference pinned at `db914cf06e2b06ee985646611b9e12ed7a770318`.

The existing production owners constructed positive-record query/mutation
programs, compiled and activated the schema, selected the actual program head,
authenticated the selected program, claimed and committed a request with result
`{ scores: { Ada: 42 } }`, closed the owner, then cold reopened and authenticated
the same selected program before recovering and replaying the committed outcome.
The snapshot contains every row of the five physical tables, actual program
definitions, head, original request identity, and the observed cold-reopen trace.
It contains only fresh, test-owned state. No identity hash was hand modeled.

The capture used explicit package-export aliases into the clean baseline
checkout and rejected any loaded package source whose real path escaped that
checkout. The capture harness, loaded source paths and individual source hashes
remain private validation evidence; they are not part of the runtime or fixture
loader. The current regression only reads and replays these frozen rows through
the actual persistence and program owners. Regenerating this file from the
current serializer would destroy the historical authentication witness.
