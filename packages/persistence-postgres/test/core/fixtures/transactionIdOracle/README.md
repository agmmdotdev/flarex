# Transaction ID oracle

`vectors.json` is generated independently by the Rust producer in this directory.
It never imports the TypeScript implementation. The producer pins the RNG crates
from Convex `db914cf06e2b06ee985646611b9e12ed7a770318`:

- `rand 0.9.4`
- `rand_chacha 0.9.0`
- `rand_core 0.9.1`
- `ppv-lite86 0.2.17`

The compiled RNG support crates also match Source's `zerocopy 0.8.20` and
`cfg-if 1.0.0`. `Cargo.lock` records the complete standalone oracle resolution;
it is not a replacement for the enclosing Convex workspace lockfile. The oracle
uses deterministic `from_seed` and never asks the OS for entropy.

Regenerate with `cargo run --locked --manifest-path <this-directory>/Cargo.toml
--target-dir <temporary-target-directory>`, saving standard output as
`vectors.json`. Keep compiler output on standard error. Do not build the enclosing
Convex workspace or commit a Cargo target directory.

The four 33-ID sequences directly perform Source's `fill_bytes(&mut id[..14])`
and append the pinned big-endian day. The 40 block vectors use the genuine
ChaCha12 `set_word_pos` to cover ordinary positions, the final low 32-bit counter,
carry into the high word and the final 64-bit counter. Four 256-byte streams
start at counter `2^64 - 2` and cross the wrapping boundary. Tests exercise the
shared scalar block primitive there; production transaction generators expose
neither seek nor writable clone capabilities.

Public-ID fixtures use a minimal scalar port of Source
`crates/value/src/{id_v6,base32}.rs`: VInt table number, complete internal ID,
little-endian wrapping Fletcher16 footer/version zero and Crockford base32.
This separately checks the unchanged TypeScript public codec with generated IDs.
The generator dependency's public true-value test aliases ChaCha20, so those
fixtures were deliberately not reused as ChaCha12 evidence.

The generated JSON is data. RNG code is supplied by the pinned Rust packages,
licensed MIT OR Apache-2.0. Their translated primitive's notice is retained in
`src/core/chacha12.ts`. Source's transaction wrapper and ID codec are attributed
to Convex, Inc. under the enclosing `convex-backend/LICENSE.md`.

The Source base32 fork carries this notice:

Copyright (c) 2015 The base32 Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
