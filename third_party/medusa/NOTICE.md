# Medusa fork source notice

The files under `upstream/` are a complete, unmodified commit-tree import from
the Cloudflare-oriented Medusa fork at commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

The fork repository is `https://github.com/agmmdotdev/medusa-fork.git`. The
official `https://github.com/medusajs/medusa.git` repository and its `v2.13.4`
release are retained as historical provenance and comparison evidence. The
fork has independent Git history, so this notice does not claim an ancestor or
merge-base relationship with that official release.

The imported repository is licensed under the MIT License. Its exact root
license remains at `upstream/LICENSE`, and a convenience copy is retained at
`licenses/medusa-fork-MIT.txt`. Package-local license and notice files remain
inside the imported tree.

The verification harness outside `upstream/` is Flarex-owned. It does not
change the imported source's licenses and does not imply endorsement by or
affiliation with Medusa or its maintainers.

The island is source and regression evidence. It is not a Flarex runtime
dependency, database authority, public API, or production activation path.
