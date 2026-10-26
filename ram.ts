/**
 * ram.ts — flat, byte-addressable RAM.
 * 128 KiB total: 64 KiB user space (0x0000–0xFFFF) + 64 KiB kernel space (0x10000–0x1FFFF).
 */
export class RAM {
  readonly size: number;
  readonly kernelSize: number;
  readonly buf: Uint8Array;
  private readonly touched: Uint8Array;
  reads = 0;
  writes = 0;

  constructor(size = 128 * 1024, kernelSize = 64 * 1024) {
    this.size = size;
    this.kernelSize = kernelSize;
    this.buf = new Uint8Array(size);
    this.touched = new Uint8Array(Math.ceil(size / 8));
  }

  read(addr: number): number {
    this.reads++;
    return this.buf[addr & 0x1FFFF];
  }

  write(addr: number, val: number): void {
    const a = addr & 0x1FFFF;
    this.buf[a] = val & 0xFF;
    this.touched[a >> 3] |= 1 << (a & 7);
    this.writes++;
  }

  peek(addr: number): number {
    return this.buf[addr & 0x1FFFF];
  }

  readString(addr: number, maxLen = 4096): string {
    let s = '';
    for (let i = 0; i < maxLen; i++) {
      const b = this.buf[(addr + i) & 0x1FFFF];
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    return s;
  }

  writeString(addr: number, s: string): void {
    for (let i = 0; i < s.length; i++) this.write(addr + i, s.charCodeAt(i));
    this.write(addr + s.length, 0); // NUL terminator
  }

  clear(): void {
    this.buf.fill(0);
    this.touched.fill(0);
    this.reads = 0;
    this.writes = 0;
  }

  /** Bytes ever written since clear (bitmap popcount). */
  get used(): number {
    let n = 0;
    for (let i = 0; i < this.touched.length; i++) n += POPCOUNT[this.touched[i]];
    return n;
  }

  /** Bytes written in kernel space (upper 64 KiB). */
  get kernelUsed(): number {
    let n = 0;
    const start = this.kernelSize >> 3;
    for (let i = start; i < this.touched.length; i++) n += POPCOUNT[this.touched[i]];
    return n;
  }
}

const POPCOUNT = (() => {
  const t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
  return t;
})();
