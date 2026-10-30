/**
 * Weighted TinyLFU admission and probation LRU translated from convex/moka
 * ef75713ad43a39fae18c3c01fa414eefa9439af0 src/sync/base_cache.rs and
 * src/common/concurrent/deques.rs. Copyright Moka contributors, Apache-2.0 OR MIT.
 * Synchronous JS maintenance adaptation: see typescript-weighted-page-cache.md.
 */
import { CoreIndexCacheFrequencySketch } from "./indexCacheSketch";

interface PolicyEntry<Value> {
  readonly value: Value;
  readonly hash: bigint;
  readonly weight: number;
}

/** Private page residency policy, not cache validity or commit authority. */
export class CoreIndexCachePolicy<Value> {
  private readonly entries = new Map<string, PolicyEntry<Value>>();
  private sketch = new CoreIndexCacheFrequencySketch();
  private sketchEnabled = false;
  private weight = 0;

  constructor(
    private readonly capacity: number,
    private readonly hash: (key: string) => bigint,
    private readonly removed: (key: string, value: Value) => void,
  ) {}

  get weightedSize(): number { return this.weight; }
  get size(): number { return this.entries.size; }

  get(key: string): Value | undefined {
    const found = this.entries.get(key);
    this.sketch.increment(found?.hash ?? this.hash(key));
    if (found !== undefined) this.moveToBack(key, found);
    return found?.value;
  }

  peek(key: string): Value | undefined { return this.entries.get(key)?.value; }

  /** Source compute's existing-entry path preserves the earlier begin timestamp. */
  insert(key: string, value: Value, weight: number): boolean {
    if (this.entries.has(key) || weight > this.capacity || this.capacity === 0) return false;
    const hash = this.hash(key);
    if (this.weight + weight > this.capacity) {
      const candidateFrequency = this.sketch.frequency(hash);
      let victimWeight = 0;
      let victimFrequency = 0;
      const victims: string[] = [];
      for (const [victimKey, victim] of this.entries) {
        if (victimWeight >= weight || victimFrequency > candidateFrequency) break;
        victimWeight += victim.weight;
        victimFrequency += this.sketch.frequency(victim.hash);
        victims.push(victimKey);
      }
      if (victimWeight < weight || candidateFrequency <= victimFrequency) return false;
      for (const victim of victims) this.remove(victim);
    }
    this.entries.set(key, { value, weight, hash });
    this.weight += weight;
    if (!this.sketchEnabled && this.weight >= this.capacity / 2) {
      // Pinned weighted-cache estimator; do not invert this source formula.
      const estimate = Math.floor(this.entries.size * (this.weight / this.capacity));
      this.sketch.ensureCapacity(Math.max(128, Math.min(estimate, 2 ** 32 - 1)));
      this.sketchEnabled = true;
    }
    return true;
  }

  /** Mark-ready replacement has unchanged weight/registration and moves to MRU. */
  touch(key: string): void {
    const found = this.entries.get(key);
    if (found !== undefined) this.moveToBack(key, found);
  }

  remove(key: string): void {
    const found = this.entries.get(key);
    if (found === undefined) return;
    this.entries.delete(key);
    this.weight -= found.weight;
    this.removed(key, found.value);
  }

  clear(): void {
    for (const key of this.entries.keys()) this.remove(key);
    this.sketch = new CoreIndexCacheFrequencySketch();
    this.sketchEnabled = false;
  }

  private moveToBack(key: string, entry: PolicyEntry<Value>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
