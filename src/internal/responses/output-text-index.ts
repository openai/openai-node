/**
 * Stores output text lengths in a complete binary segment tree.
 *
 * Leaves begin at `capacity`; each parent contains the sum of its children.
 * Rebuilding when capacity doubles preserves every existing contribution and
 * makes growth linear in the total number of appended outputs.
 */
export class OutputTextIndex {
  private capacity = 1;
  private values: number[] = [0, 0];
  private size = 0;

  get length(): number {
    return this.size;
  }

  append(value: number): void {
    if (this.size === this.capacity) {
      this.grow();
    }

    const index = this.size;
    this.size += 1;
    this.update(index, value);
  }

  update(index: number, value: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`missing output at index ${index}`);
    }

    let node = this.capacity + index;
    const difference = value - (this.values[node] ?? 0);
    if (difference === 0) {
      return;
    }

    while (node >= 1) {
      this.values[node] = (this.values[node] ?? 0) + difference;
      node = Math.floor(node / 2);
    }
  }

  prefixSum(end: number): number {
    if (!Number.isSafeInteger(end) || end < 0 || end > this.size) {
      throw new RangeError(`missing output at index ${end}`);
    }

    let start = this.capacity;
    let stop = this.capacity + end;
    let sum = 0;

    while (start < stop) {
      if (start % 2 === 1) {
        sum += this.values[start] ?? 0;
        start += 1;
      }
      if (stop % 2 === 1) {
        stop -= 1;
        sum += this.values[stop] ?? 0;
      }
      start = Math.floor(start / 2);
      stop = Math.floor(stop / 2);
    }

    return sum;
  }

  private grow(): void {
    const previousCapacity = this.capacity;
    this.capacity *= 2;
    const values = Array.from({ length: this.capacity * 2 }, () => 0);

    for (let index = 0; index < this.size; index += 1) {
      values[this.capacity + index] = this.values[previousCapacity + index] ?? 0;
    }

    for (let index = this.capacity - 1; index > 0; index -= 1) {
      values[index] = (values[index * 2] ?? 0) + (values[index * 2 + 1] ?? 0);
    }

    this.values = values;
  }
}
