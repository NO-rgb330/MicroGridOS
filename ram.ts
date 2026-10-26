class RAM {
  constructor(size = 128 * 1024, kernelSize = 64 * 1024) {
    this.size = size;
    this.kernelSize = kernelSize;
    this.buf = new Uint8Array(size);
    this.touched = new Uint8Array(Math.ceil(size / 8));
    this.reads = 0;
    this.writes = 0;
  }

  read(addr) {
    this.reads++;
    return this.buf[addr & 0x1FFFF];
  }

  write(addr, val) {
    const a = addr & 0x1FFFF;
    this.buf[a] = val & 0xFF;
    this.touched[a >> 3] |= 1 << (a & 7);
    this.writes++;
  }

  peek(addr) { return this.buf[addr & 0x1FFFF]; }

  writeString(addr, s) {
    for (let i = 0; i < s.length; i++) this.write(addr + i, s.charCodeAt(i));
    this.write(addr + s.length, 0);
  }

  clear() {
    this.buf.fill(0);
    this.touched.fill(0);
    this.reads = 0;
    this.writes = 0;
  }

  get used() {
    let n = 0;
    for (let i = 0; i < this.touched.length; i++) n += POPCOUNT[this.touched[i]];
    return n;
  }

  get kernelUsed() {
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
