const $ = (id) => document.getElementById(id);

/* Hardware */
const ram = new RAM(128 * 1024);
const container = $('frame');
const gpu = new GPU($('screen'), container);
const cpu = new CPU(ram);
const vfs = new VFS();

cpu.onOut = (b) => gpu.putChar(b);

/* Helpers */
const write = (s) => gpu.write(s);
const line = (s = '') => gpu.write(s + '\n');
const hex = (n, w = 2) => (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
const pad = (s, n) => String(s).padEnd(n);

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KiB';
  return (n / 1048576).toFixed(1) + ' MiB';
}

/* Programs */
const PROGRAMS = {
  hello: {
    desc: 'print a string',
    data: { addr: 0x0100, text: 'HELLO FROM THE vCPU!\n' },
    src: `LDX #0x0100\nloop: LDA [X]\nCMP A,B\nJZ done\nOUT A\nINC X\nJMP loop\ndone: HLT`
  },
  count: {
    desc: 'count 0..9',
    src: `LDA #48\nLDX #10\nloop: OUT A\nINC A\nDEC X\nJNZ loop\nLDA #10\nOUT A\nHLT`
  }
};

/* Commands */
const COMMANDS = {
  help() {
    line('system:    help, info, clear, reset');
    line('cpu:       progs, run <name>, regs, mem <addr>, poke <addr> <val>');
    line('storage:   ls, cat <file>, write <file> <text>, rm <file>, mkdir <dir>, df');
  },
  progs() {
    for (const [k, p] of Object.entries(PROGRAMS)) line(`  ${pad(k, 8)} ${p.desc}`);
  },
  run(args) {
    const p = PROGRAMS[args[0]];
    if (!p) return line('no such program');
    const code = CPU.assemble(p.src);
    cpu.load(code, 0);
    if (p.data) ram.writeString(p.data.addr, p.data.text);
    line(`[cpu] running ${args[0]}...`);
    const status = cpu.run(200000);
    line(`[cpu] ${status} · cycles=${cpu.cycles}`);
  },
  regs() {
    const f = cpu.flags;
    line(`A=0x${hex(cpu.r.A)} B=0x${hex(cpu.r.B)} X=0x${hex(cpu.r.X, 4)}`);
    line(`PC=0x${hex(cpu.pc, 4)} Z=${+f.z} C=${+f.c}`);
  },
  mem(args) {
    const addr = parseInt(args[0], 0) || 0;
    const len = Math.min(parseInt(args[1], 0) || 128, 1024);
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
    ram.write(parseInt(args[0], 0), parseInt(args[1], 0));
    line('ok');
  },
  info() {
    line(`RAM: ${fmtBytes(ram.used)} / ${fmtBytes(ram.size)}`);
    line(`CPU: ${cpu.cycles} cycles · PC=0x${hex(cpu.pc, 4)}`);
    line(`GPU: ${gpu.cols}x${gpu.rows} grid`);
    line(`VFS: ${vfs.mode} · ${fmtBytes(vfs.used)} used`);
  },
  clear() { gpu.clear(); },
  reset() { ram.clear(); cpu.reset(); boot(vfs.mode); },

  async ls() {
    const items = await vfs.list('/');
    if (!items.length) return line('(empty)');
    for (const it of items) line(`${it.kind === 'dir' ? 'd' : '-'} ${pad(it.size, 8)} ${it.name}`);
  },
  async cat(args) {
    const text = await vfs.read(args[0]);
    line(text);
  },
  async write(args) {
    const r = await vfs.write(args[0], args.slice(1).join(' '));
    line(`wrote ${r.bytes} B`);
  },
  async rm(args) {
    await vfs.remove(args[0], true);
    line('removed');
  },
  async mkdir(args) {
    await vfs.mkdir(args[0]);
    line('created');
  },
  async df() {
    line(`Backend: ${vfs.mode}`);
    line(`Used:    ${fmtBytes(vfs.used)} / 1 GiB`);
    line(`Files:   ${vfs.files}`);
  }
};

/* Shell */
function boot(mode) {
  gpu.clear();
  line('vOS 0.2 — Mainframe Interface');
  line('──────────────────────────────');
  line(`RAM: 128 KiB   CPU: vCPU-8   GPU: Auto   FS: ${mode}`);
  line('Type "help" for commands.');
  line('');
}

let buf = '';
let busy = false;
const history = [];
let hpos = 0;

const prompt = () => write('> ');
const eraseBuf = () => { for (let i = 0; i < buf.length; i++) gpu.putChar(8); buf = ''; };

async function exec(input) {
  const [name, ...args] = input.split(/\s+/);
  const cmd = COMMANDS[name.toLowerCase()];
  if (!cmd) return line(`unknown command: ${name}`);
  try { await cmd(args); } catch (e) { line('error: ' + e.message); }
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault(); gpu.clear(); prompt(); write(buf); return;
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

/* Diagnostics */
let cpuLoad = 0, gpuLoad = 0;
let lastCycles = 0, lastChars = 0, lastT = performance.now();

function setBar(id, pct) {
  const el = $(id + '-bar');
  const wrap = $(id + '-bar-wrap');
  if (!el || !wrap) return;
  el.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  wrap.className = 'bar' + (pct > 90 ? ' crit' : pct > 70 ? ' warn' : '');
}

function sample() {
  const now = performance.now();
  const dt = Math.max(1, now - lastT) / 1000;
  lastT = now;

  // RAM
  const rp = (ram.used / ram.size) * 100;
  $('ram-pct').textContent = rp.toFixed(1) + '%';
  $('ram-used').textContent = fmtBytes(ram.used);
  $('ram-total').textContent = fmtBytes(ram.size);
  $('ram-kernel').textContent = fmtBytes(ram.kernelUsed);
  $('ram-ops').textContent = `${ram.reads} R / ${ram.writes} W`;
  setBar('ram', rp);

  // CPU
  const dCyc = cpu.cycles - lastCycles;
  lastCycles = cpu.cycles;
  const hz = dCyc / dt;
  cpuLoad = cpuLoad * 0.6 + Math.min(100, (hz / 200000) * 100) * 0.4;
  $('cpu-pct').textContent = Math.round(cpuLoad) + '%';
  $('cpu-state').textContent = cpu.halted ? 'halted' : cpuLoad > 3 ? 'running' : 'idle';
  $('cpu-pc').textContent = '0x' + hex(cpu.pc, 4);
  $('cpu-cycles').textContent = cpu.cycles;
  $('cpu-rate').textContent = Math.round(hz) + ' Hz';
  setBar('cpu', cpuLoad);

  // GPU
  const dCh = gpu.chars - lastChars;
  lastChars = gpu.chars;
  const cps = dCh / dt;
  gpuLoad = gpuLoad * 0.6 + Math.min(100, (cps / 20000) * 100) * 0.4;
  $('gpu-pct').textContent = Math.round(gpuLoad) + '%';
  $('gpu-grid').textContent = `${gpu.cols}×${gpu.rows}`;
  $('gpu-cursor').textContent = `${gpu.col},${gpu.row}`;
  $('gpu-chars').textContent = gpu.chars;
  setBar('gpu', gpuLoad);

  // FS
  const fp = (vfs.used / vfs.cap) * 100;
  $('fs-pct').textContent = fp.toFixed(2) + '%';
  $('fs-used').textContent = fmtBytes(vfs.used);
  $('fs-files').textContent = vfs.files;
  $('fs-mode').textContent = vfs.mode;
  setBar('fs', fp);
}

/* Start */
(async () => {
  const mode = await vfs.init();
  boot(mode);
  prompt();
  setInterval(sample, 400);
  sample();
  gpu.start(); // Start render loop
})();
