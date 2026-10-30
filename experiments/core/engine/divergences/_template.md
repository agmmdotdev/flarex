# Mechanism: replace with the focused divergence name

Design status: **Proposed / Accepted / Superseded**; select one.
Implementation status: **Unstarted / In progress / Implemented**; select one.
Measurement status: **Unmeasured / Required gates unmet / Required gates passed**;
select one and name any limits.

## Ownership and decision

- Owning slice, responsibility and decision record:
- Coordinator and responsible implementation owner:
- Decision source and any unresolved guarantee:
- Affected consumers, profiles and data; migration/reset disposition:

Keep this record focused on one mechanism. Link related records instead of
combining independent authority or lifecycle decisions.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- Source paths, symbols and content identities:
- Relevant executing callers and tests:
- Algorithm/state, ownership, concurrency order and failure/recovery behavior:
- Required invariants and observable guarantees:

Explain what the inspected code establishes and what it does not establish.

## Current core and proposed direction challenge

- Current executing owner/callers and reusable logic:
- Current costs, defects or unnecessary choreography, with evidence:
- Proposed direction and the assumptions tested against both implementations:
- Independent sub-agent findings, counterexamples and resolved disagreements:
- Unresolved findings and their effect on this slice:

## Why a difference is necessary

Name the concrete runtime constraint, native behavior or accepted product
obligation. Explain why translating the same mechanism cannot satisfy it and
why keeping/adapting another existing owner is insufficient. State the smallest
necessary difference and alternatives rejected with evidence.

## Replacement mechanism and implementation

- Responsible portable owner and host/persistence adapter boundaries:
- State and representations, operation inputs/results and data flow:
- Snapshot/index/cache eligibility and dependency/coverage treatment, if relevant:
- Concurrency, publication, cancellation, fencing and recovery interleavings:
- Exact executing paths/symbols once implemented; otherwise mark these as planned:
- Caller migration and removal of displaced code/exports/dependencies:

Explain how the replacement works, not only that it uses TypeScript, DO SQLite
or PostgreSQL. Platform components do not establish correctness on their own.

## Preserved and changed guarantees

List which reference guarantees remain equivalent, which intentionally differ,
and the consequences for visibility, authority, failure/error order, retries,
native effects, durability, resource limits and cost. Identify the decision
required before implementing any unresolved change.

## Required witnesses and remaining limits

- Normal-path and counterexample behaviors, including relevant racing writers:
- Owner and connected-consumer regressions; preserved native assertions:
- PGlite and ordinary-role PostgreSQL requirements for database claims:
- Actual Cloudflare host requirements for DO claims:
- Complete-operation cost, declared sizes/concurrency and applicable targets:
- Remaining unknowns and required reassessment/removal conditions:

Do not mark implemented from a design decision or measured from structural
similarity. Link code and Git evidence after validation; preserve unresolved
gates explicitly.
