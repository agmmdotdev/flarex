# Flarex Design Notes

This folder holds exploratory design findings that are not implementation
roadmaps yet.

Use this folder for architecture comparisons, alternative authority models, and
research write-ups that should inform later roadmap work but should not become
the chronological implementation history. When a design note becomes an
implementation checkpoint, record the active work in the relevant `roadmaps/`
domain file.

## Notes

- `postgres-authoritative-sync.md`
  - Postgres as source of truth with Cloudflare WebSocket/cache/freshness
    layers.
- `postgres-multitenant-persistence-schema.md`
  - Convex-style multitenant generic document/index persistence for the
    Postgres-authoritative Flarex track.
