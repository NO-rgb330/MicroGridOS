import { RAM } from './ram.js';
import { CPU } from './cpu.js';
import { GPU } from './gpu.js';
import { VFS } from './fs.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing element: ' + id);
  return el as T;
};

/* ============================================================
   Hardware
   ============================================================ */
const ram = new RAM(128 * 1024);
const gpu = new GPU($<HTMLCanvasElement>('screen'));
const cpu = new CPU(ram);
const vfs = new VFS();

cpu.onOut = (b: number) => gpu.putChar(b);
gpu.start();

/* ============================================================
   Helpers
   ============================================================ */
const write = (s: string): void => gpu.write(s);
const line = (s = ''): void => gpu.write(s + '\n');
const hex = (n: number, w = 2): string => (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
const pad = (s: string | number, n: number): string => String(s).padEnd(n);

function fmtBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KiB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MiB';
  return (n / 1073741824).toFixed(2) + ' GiB';
}

/* ============================================================
   Programs
   ============================================================ */
interface Program { desc: string; src: string; data?: { addr: number; text: string } }

const PROGRAMS: Record<string, Program> = {
  hello: {
    desc: 'print a NUL-terminated string from RAM',
    data: { addr: 0x0100, text: 'HELLO FROM THE vCPU!\n' },
    src: `
      LDX #0x0100
loop: LDA [X]
      CMP A,B
      JZ  done
      OUT A
      INC X
      JMP loop
done: HLT`
  },
  count: {
    desc: 'count 0..9, then newline',
    src: `
      LDA #48
      LDX #10
loop: OUT A
      INC A
      DEC X
      JNZ loop
      LDA #10
      OUT A
      HLT`
  },
  stack: {
    desc: 'CALL / RET stack demo',
    src: `
      CALL pa
      CALL pb
      LDA #10
      OUT A
      HLT
pa:   LDA #65
      OUT A
      RET
pb:   LDA #66
      OUT A
      RET`
  },
  blit: {
    desc: 'write 256 bytes of RAM (drives the RAM meter)',
    src: `
      LDX #0x2000
      LDA #65
      LDB #0
loop: STA [X]
      INC X
      DEC B
      JNZ loop
      HLT`
  }
};

/* ============================================================
   Commands
   ============================================================ */
type Command = (args: string[]) => void | Promise<void>;

const COMMANDS: Record<string, Command> = {
  help() {
    line('system');
    line('  help                 this list');
    line('  info                 hardware status');
    line('  clear                clear the screen');
    line('  reset                cold boot');
    line('');
    line('cpu');
    line('  progs                list loadable programs');
    line('  run <name>           assemble + execute');
    line('  regs                 dump registers & flags');
    line('  mem <addr> [len]     hex dump RAM');
    line('  poke <addr> <byte>   write a byte into RAM');
    line('');
    line('storage  (OPFS, 1 GiB cap)');
    line('  ls [path]            list a directory');
    line('  cat <path>           print a file');
    line('  write <path> <text>  create / overwrite a file');
    line('  append <path> <text> append to a file');
    line('  rm <path> [-r]       delete a file or directory');
    line('  mkdir <path>         create a directory');
    line('  df                   storage usage');
  },

  progs() {
    line('programs');
    for (const [k, p] of Object.entries(PROGRAMS)) line('  ' + pad(k, 8) + p.desc);
  },

  run(args) {
    const name = args[0];
    const p = PROGRAMS[name];
    if (!p) return line('no such program: ' + (name || '(none)'));
    let code: Uint8Array;
    try { code = CPU.assemble(p.src); }
    catch (e) { return line('assembler: ' + (e as Error).message); }
    cpu.load(code, 0);
    if (p.data) ram.writeString(p.data.addr, p.data.text);
    line(`[cpu] ${name}: ${code.length} bytes @ 0x0000`);
    const status = cpu.run(200000);
    line(`[cpu] ${status} · pc=0x${hex(cpu.pc, 4)} · ${cpu.cycles} cycles total`);
  },

  regs() {
    const { A, B, X } = cpu.r;
    const f = cpu.flags;
    line(`A=0x${hex(A)}  B=0x${hex(B)}  X=0x${hex(X, 4)}   (${A}, ${B}, ${X})`);
    line(`PC=0x${hex(cpu.pc, 4)}  SP=0x${hex(cpu.sp, 4)}  cycles=${cpu.cycles}`);
    line(`flags Z=${+f.z} C=${+f.c} N=${+f.n}   ${cpu.halted ? 'HALTED' : 'running'}`);
  },

  mem(args) {
    const addr = parseInt(args[0], 0);
    const len = Math.min(parseInt(args[1], 0) || 128, 2048);
    if (Number.isNaN(addr)) return line('usage: mem <addr> [len]');
    for (let row = 0; row < len; row += 16) {
      let h = '', a = '';
      for (let i = 0; i < 16 && row + i < len; i++) {
        const b = ram.peek(addr + row + i);
        h += hex(b) + ' ';
        a += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
      }
      line(`${hex(addr + row, 5)}  ${pad(h, 48)} |${a}|`);
    }
  },

  poke(args) {
    const addr = parseInt(args[0], 0), val = parseInt(args[1], 0);
    if (Number.isNaN(addr) || Number.isNaN(val)) return line('usage: poke <addr> <byte>');
    ram.write(addr, val);
    line(`0x${hex(addr, 5)} <= 0x${hex(val & 0xFF)}`);
  },

  info() {
    line(`RAM  ${fmtBytes(ram.size)} · ${ram.reads} reads · ${ram.writes} writes · ${fmtBytes(ram.used)} touched`);
    line(`     kernel space 0x10000-0x1FFFF · ${fmtBytes(ram.kernelUsed)} buffered`);
    line(`GPU  ${gpu.cols}x${gpu.rows} cells · ${gpu.chars} chars · ${gpu.wraps} scrolls · ${gpu.frames} frames`);
    line(`CPU  ${cpu.cycles} cycles · ${cpu.halted ? 'halted' : 'running'} · pc=0x${hex(cpu.pc, 4)}`);
    line(`FS   ${vfs.mode} · ${fmtBytes(vfs.used)} / ${fmtBytes(vfs.cap)} · ${vfs.files} files`);
  },

  clear() { gpu.clear(); },

  reset() { ram.clear(); cpu.reset(); boot(vfs.mode); },

  async ls(args) {
    const path = args[0] || '/';
    const items = await vfs.list(path);
    if (!items.length) return line('(empty)');
    for (const it of items) {
      const kind = it.kind === 'dir' ? 'd' : '-';
      const size = it.kind === 'dir' ? '        —' : pad(it.size, 9);
      line(`${kind} ${size}  ${it.name}${it.kind === 'dir' ? '/' : ''}`);
    }
  },

  async cat(args) {
    if (!args[0]) return line('usage: cat <path>');
    const text = await vfs.read(args[0]);
    const n = Math.min(text.length, ram.kernelSize);
    for (let i = 0; i < n; i++) ram.write(0x10000 + i, text.charCodeAt(i));
    gpu.write(text.endsWith('\n') ? text : text + '\n');
    line(`[kernel] ${n} B staged @ 0x10000`);
  },

  async write(args) {
    if (args.length < 2) return line('usage: write <path> <text...>');
    const r = await vfs.write(args[0], args.slice(1).join(' '));
    line(`wrote ${r.bytes} B -> ${args[0]} (${r.size} B on disk)`);
  },

  async append(args) {
    if (args.length < 2) return line('usage: append <path> <text...>');
    const r = await vfs.write(args[0], args.slice(1).join(' '), true);
    line(`appended ${r.bytes} B -> ${args[0]} (${r.size} B on disk)`);
  },

  async rm(args) {
    if (!args[0]) return line('usage: rm <path> [-r]');
    const recursive = args.includes('-r');
    const r = await vfs.remove(args[0], recursive);
    line(`removed ${r.kind} ${args[0]}${r.size ? ' (' + fmtBytes(r.size) + ')' : ''}`);
  },

  async mkdir(args) {
    if (!args[0]) return line('usage: mkdir <path>');
    await vfs.mkdir(args[0]);
    line('created ' + args[0]);
  },

  async df() {
    const pct = (vfs.used / vfs.cap * 100).toFixed(2);
    line(`backend : ${vfs.mode}`);
    line(`used    : ${fmtBytes(vfs.used)}  (${pct}% of cap)`);
    line(`cap     : ${fmtBytes(vfs.cap)}`);
    line(`free    : ${fmtBytes(vfs.cap - vfs.used)}`);
    line(`files   : ${vfs.files}   dirs: ${vfs.dirs}`);
  }
};

/* ============================================================
   Boot & shell
   ============================================================ */
function boot(mode: 'opfs' | 'memory'): void {
  gpu.clear();
  line('vOS 0.1 — a command line in four parts');
  line('──────────────────────────────────────');
  line('  RAM   128 KiB flat · 16-bit CPU bus + 64 KiB kernel  [ok]');
  line(`  GPU   ${gpu.cols}x${gpu.rows} text framebuffer · canvas raster   [ok]`);
  line(`  CPU   vCPU-8 · ${Object.keys(CPU.ISA).length} opcodes · ${cpu.cycles} cycles   [ok]`);
  line(`  FS    ${mode === 'opfs' ? 'OPFS persistent' : 'in-memory fallback'} · 1 GiB cap     [ok]`);
  line('');
  line('type "help" for commands.');
  line('');
}

let buf = '';
let busy = false;
const history: string[] = [];
let hpos = 0;

const prompt = (): void => write('> ');
const eraseBuf = (): void => {
  for (let i = 0; i < buf.length; i++) gpu.putChar(8);
  buf = '';
};

async function exec(input: string): Promise<void> {
  const [name, ...args] = input.split(/\s+/);
  const cmd = COMMANDS[name.toLowerCase()];
  if (!cmd) return line(`unknown command "${name}" — try "help"`);
  try { await cmd(args); }
  catch (err) { line('error: ' + (err instanceof Error ? err.message : String(err))); }
}

addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    gpu.clear();
    prompt();
    write(buf);
    return;
  }

  if (busy) { if (e.key === 'Enter') e.preventDefault(); return; }

  if (e.key === 'Enter') {
    e.preventDefault();
    gpu.write('\n');
    const cmd = buf.trim();
    buf = '';
    if (cmd) { history.push(cmd); hpos = history.length; }
    busy = true;
    exec(cmd).then(() => { busy = false; prompt(); });
    return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (buf.length) { buf = buf.slice(0, -1); gpu.putChar(8); }
    return;
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (!history.length) return;
    hpos = Math.max(0, Math.min(history.length, hpos + (e.key === 'ArrowUp' ? -1 : 1)));
    eraseBuf();
    buf = history[hpos] || '';
    write(buf);
    return;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    buf += e.key;
    gpu.putChar(e.key.charCodeAt(0));
  }
});

/* ============================================================
   Diagnostics
   ============================================================ */
const D = {
  ramPct: $('ram-pct'), ramBar: $('ram-bar'), ramWrap: $('ram-bar-wrap'),
  ramUsed: $('ram-used'), ramTotal: $('ram-total'), ramKernel: $('ram-kernel'),
  ramReads: $('ram-reads'), ramWrites: $('ram-writes'),
  cpuPct: $('cpu-pct'), cpuBar: $('cpu-bar'), cpuWrap: $('cpu-bar-wrap'),
  cpuState: $('cpu-state'), cpuPc: $('cpu-pc'), cpuCycles: $('cpu-cycles'), cpuRate: $('cpu-rate'),
  gpuPct: $('gpu-pct'), gpuBar: $('gpu-bar'), gpuWrap: $('gpu-bar-wrap'),
  gpuGrid: $('gpu-grid'), gpuCursor: $('gpu-cursor'), gpuChars: $('gpu-chars'), gpuScrolls: $('gpu-scrolls'),
  fsPct: $('fs-pct'), fsBar: $('fs-bar'), fsWrap: $('fs-bar-wrap'),
  fsUsed: $('fs-used'), fsCap: $('fs-cap'), fsFiles: $('fs-files'), fsMode: $('fs-mode')
};

const clamp = (v: number): number => Math.max(0, Math.min(100, v));

let cpuLoad = 0, gpuLoad = 0;
let lastCycles = 0, lastChars = 0, lastT = performance.now();

function setBar(el: HTMLElement, wrap: HTMLElement, v: number): void {
  const p = clamp(v);
  el.style.width = p.toFixed(1) + '%';
  wrap.classList.toggle('warn', p >= 70 && p < 90);
  wrap.classList.toggle('crit', p >= 90);
}

function sample(): void {
  const now = performance.now();
  const dt = Math.max(1, now - lastT) / 1000;
  lastT = now;

  const rp = ram.used / ram.size * 100;
  D.ramPct.textContent = rp.toFixed(1) + '%';
  setBar(D.ramBar, D.ramWrap, rp);
  D.ramUsed.textContent = fmtBytes(ram.used);
  D.ramTotal.textContent = fmtBytes(ram.size);
  D.ramKernel.textContent = fmtBytes(ram.kernelUsed);
  D.ramReads.textContent = ram.reads.toLocaleString();
  D.ramWrites.textContent = ram.writes.toLocaleString();

  const dCyc = cpu.cycles - lastCycles;
  lastCycles = cpu.cycles;
  const hz = dCyc / dt;
  cpuLoad = cpuLoad * 0.55 + clamp(hz / 200000 * 100) * 0.45;
  D.cpuPct.textContent = Math.round(cpuLoad) + '%';
  setBar(D.cpuBar, D.cpuWrap, cpuLoad);
  D.cpuState.textContent = cpu.halted ? 'halted' : (cpuLoad > 3 ? 'running' : 'idle');
  D.cpuPc.textContent = '0x' + hex(cpu.pc, 4);
  D.cpuCycles.textContent = cpu.cycles.toLocaleString();
  D.cpuRate.textContent = Math.round(hz).toLocaleString() + ' Hz';

  const dCh = gpu.chars - lastChars;
  lastChars = gpu.chars;
  const cps = dCh / dt;
  gpuLoad = gpuLoad * 0.55 + clamp(cps / 20000 * 100) * 0.45;
  D.gpuPct.textContent = Math.round(gpuLoad) + '%';
  setBar(D.gpuBar, D.gpuWrap, gpuLoad);
  D.gpuGrid.textContent = gpu.cols + '×' + gpu.rows;
  D.gpuCursor.textContent = gpu.col + ',' + gpu.row;
  D.gpuChars.textContent = gpu.chars.toLocaleString();
  D.gpuScrolls.textContent = gpu.wraps.toLocaleString();

  const sp = vfs.used / vfs.cap * 100;
  D.fsPct.textContent = sp.toFixed(2) + '%';
  setBar(D.fsBar, D.fsWrap, sp);
  D.fsUsed.textContent = fmtBytes(vfs.used);
  D.fsCap.textContent = fmtBytes(vfs.cap);
  D.fsFiles.textContent = vfs.files.toLocaleString();
  D.fsMode.textContent = vfs.mode;
}

/* ============================================================
   Cold boot
   ============================================================ */
(async () => {
  const mode = await vfs.init();
  boot(mode);
  prompt();
  setInterval(sample, 400);
  sample();
})();
