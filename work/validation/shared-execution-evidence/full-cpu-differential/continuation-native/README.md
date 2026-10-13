# Native GC cycle diagnostic

Operator-only Windows x64 probe, pinned to Node 24.16.0 and its V8 ABI. It adds
per-environment GC prologue/epilogue callbacks, reads QueryThreadCycleTime on the
owning thread, and reports cumulative main-thread GC cycles and collections.
Callbacks allocate nothing and invoke no JavaScript. Snapshot fills a caller-owned
BigUint64Array without constructing JS result objects. Environment cleanup removes
callbacks and deletes state; explicit disable is idempotent.

This is not a background collector CPU counter or allocation-origin tracker.
GC callback intervals include other registered synchronous GC callbacks. Callback
entry/exit and counter-call overhead are not calibrated away. Nonzero fault counts
invalidate diagnostic observation. The binary is not shipped by any runtime package.

Build inputs downloaded from the pinned official Node distribution:

- https://nodejs.org/download/release/v24.16.0/node-v24.16.0-headers.tar.gz
  SHA-256 `ee3466c7ed5101cdc82978a5164148204bfffae0ddacda24ef6d9805bdf4fc07`.
- https://nodejs.org/download/release/v24.16.0/win-x64/node.lib
  SHA-256 `4ab42af597bc4f0957e9e2dcd5db18bdf223406a0c8e0b6be0f28e57977b808b`.

Place the extracted node-v24.16.0 directory and node.lib beside build.cmd.
Run build.cmd with the recorded Visual Studio 2022 BuildTools installation.
Headers/libs/intermediate objects are ignored local build inputs; source, build
command and resulting diagnostic binary are retained. Campaign ledgers hash both
gc-cycles.cc and gc-cycles.node before and after capture.

Run `node --expose-gc work/validation/shared-execution-evidence/full-cpu-differential/continuation-native/test.mjs`
to verify collection accounting, monotonicity, bounds, bad arguments and disabling.
Explicit GC is used only in that isolated native test, never during campaigns.
The pinned `include/node/v8-isolate.h` documents the callback contract; the
JavaScript hooks follow [Node Promise hooks](https://nodejs.org/docs/v24.16.0/api/v8.html#promise-hooks).
