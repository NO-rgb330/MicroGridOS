import type { RAM } from './ram.js';

export interface Registers { A: number; B: number; X: number; }
export interface Flags { z: boolean; c: boolean; n: boolean; }

export class CPU {
  static readonly ISA = {
    HLT: 0x00, OUT: 0x01,
    LDA_IMM: 0x02, LDB_IMM: 0x03, LDX_IMM: 0x04,
    LDA_IND: 0x05, STA_IND: 0x06,
    CMP: 0x07,
    INC_A: 0x08, INC_B: 0x09, INC_X: 0x0A,
    DEC_A: 0x0B, DEC_B: 0x0C, DEC_X: 0x0D,
    JMP: 0x0E, JZ: 0x0F, JNZ: 0x10, CALL: 0x11, RET: 0x12,
    PUSH_A: 0x13, POP_A: 0x14,
    ADD: 0x15, SUB: 0x16,
  } as const;

  readonly ram: RAM;
  r: Registers = { A: 0, B: 0, X: 0 };
  flags: Flags = { z: false, c: false, n: false };
  pc = 0;
  sp = 0xFFFE;
  cycles = 0;
  halted = false;
  onOut: ((b: number) => void) | null = null;

  constructor(ram: RAM) { this.ram = ram; }

  reset(): void {
    this.r = { A: 0, B: 0, X: 0 };
    this.flags = { z: false, c: false, n: false };
    this.pc = 0;
    this.sp = 0xFFFE;
    this.cycles = 0;
    this.halted = false;
  }

  load(code: Uint8Array, addr: number): void {
    for (let i = 0; i < code.length; i++) this.ram.write(addr + i, code[i]);
    this.r = { A: 0, B: 0, X: 0 };
    this.flags = { z: false, c: false, n: false };
    this.sp = 0xFFFE;
    this.pc = addr;
    this.halted = false;
  }

  run(maxCycles: number): 'halted' | 'budget' {
    let n = 0;
    while (!this.halted && n < maxCycles) { this.step(); this.cycles++; n++; }
    return this.halted ? 'halted' : 'budget';
  }

  private step(): void {
    const op = this.ram.read(this.pc++);
    switch (op) {
      case 0x00: this.halted = true; break;
      case 0x01: if (this.onOut) this.onOut(this.r.A); break;

      case 0x02: this.r.A = this.ram.read(this.pc++); this.flag(this.r.A); break;
      case 0x03: this.r.B = this.ram.read(this.pc++); this.flag(this.r.B); break;
      case 0x04: {
        const lo = this.ram.read(this.pc++);
        const hi = this.ram.read(this.pc++);
        this.r.X = lo | (hi << 8);
        this.flag(this.r.X & 0xFF);
        break;
      }
      case 0x05: this.r.A = this.ram.read(this.r.X); this.flag(this.r.A); break;
      case 0x06: this.ram.write(this.r.X, this.r.A); break;
      case 0x07:
        this.flags.z = this.r.A === this.r.B;
        this.flags.c = this.r.A < this.r.B;
        this.flags.n = (this.r.A & 0x80) !== 0;
        break;
      case 0x08: this.r.A = (this.r.A + 1) & 0xFF; this.flag(this.r.A); break;
      case 0x09: this.r.B = (this.r.B + 1) & 0xFF; this.flag(this.r.B); break;
      case 0x0A: this.r.X = (this.r.X + 1) & 0xFFFF; this.flag(this.r.X & 0xFF); break;
      case 0x0B: this.r.A = (this.r.A - 1) & 0xFF; this.flag(this.r.A); break;
      case 0x0C: this.r.B = (this.r.B - 1) & 0xFF; this.flag(this.r.B); break;
      case 0x0D: this.r.X = (this.r.X - 1) & 0xFFFF; this.flag(this.r.X & 0xFF); break;
      case 0x0E: { const lo = this.ram.read(this.pc++); const hi = this.ram.read(this.pc++); this.pc = lo | (hi << 8); break; }
      case 0x0F: { const lo = this.ram.read(this.pc++); const hi = this.ram.read(this.pc++); if (this.flags.z) this.pc = lo | (hi << 8); break; }
      case 0x10: { const lo = this.ram.read(this.pc++); const hi = this.ram.read(this.pc++); if (!this.flags.z) this.pc = lo | (hi << 8); break; }
      case 0x11: {
        const lo = this.ram.read(this.pc++); const hi = this.ram.read(this.pc++);
        this.sp = (this.sp - 1) & 0xFFFF; this.ram.write(this.sp, (this.pc >> 8) & 0xFF);
        this.sp = (this.sp - 1) & 0xFFFF; this.ram.write(this.sp, this.pc & 0xFF);
        this.pc = lo | (hi << 8);
        break;
      }
      case 0x12: {
        const lo = this.ram.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF;
        const hi = this.ram.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF;
        this.pc = lo | (hi << 8);
        break;
      }
      case 0x13: this.sp = (this.sp - 1) & 0xFFFF; this.ram.write(this.sp, this.r.A); break;
      case 0x14: this.r.A = this.ram.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF; this.flag(this.r.A); break;
      case 0x15: this.r.A = (this.r.A + this.r.B) & 0xFF; this.flag(this.r.A); break;
      case 0x16: this.r.A = (this.r.A - this.r.B) & 0xFF; this.flag(this.r.A); break;
      default: throw new Error('invalid opcode 0x' + op.toString(16));
    }
  }

  private flag(v: number): void {
    this.flags.z = (v & 0xFF) === 0;
    this.flags.n = (v & 0x80) !== 0;
  }

  /* ---------------- assembler ---------------- */

  static assemble(src: string): Uint8Array {
    const lines = src.split('\n').map(l => l.replace(/;.*$/, '').trim()).filter(Boolean);
    interface Line { label?: string; mnemonic?: string; operand?: string; }
    const parsed: Line[] = [];

    for (const raw of lines) {
      let rest = raw, label: string | undefined;
      const lm = rest.match(/^(\w+):\s*(.*)$/);
      if (lm) { label = lm[1]; rest = lm[2].trim(); }
      if (!rest) { parsed.push({ label }); continue; }
      const sp = rest.indexOf(' ');
      const mnemonic = (sp < 0 ? rest : rest.slice(0, sp)).toUpperCase();
      const operand = sp < 0 ? '' : rest.slice(sp + 1).trim();
      parsed.push({ label, mnemonic, operand });
    }

    const labels: Record<string, number> = {};
    let pc = 0;
    for (const p of parsed) {
      if (p.label) labels[p.label] = pc;
      if (p.mnemonic) pc += this.size(p.mnemonic, p.operand || '');
    }

    const out: number[] = [];
    for (const p of parsed) if (p.mnemonic) this.emit(out, p.mnemonic, p.operand || '', labels);
    return new Uint8Array(out);
  }

  private static size(mnemonic: string, operand: string): number {
    switch (mnemonic) {
      case 'LDA': case 'LDB': return operand.startsWith('#') ? 2 : 1;
      case 'LDX': case 'JMP': case 'JZ': case 'JNZ': case 'CALL': return 3;
      default: return 1;
    }
  }

  private static imm(op: string, labels: Record<string, number>): number {
    op = op.trim();
    if (/^0x[0-9a-f]+$/i.test(op)) return parseInt(op, 16);
    if (/^\d+$/.test(op)) return parseInt(op, 10);
    if (op in labels) return labels[op];
    throw new Error('unknown operand: ' + op);
  }

  private static emit(out: number[], mnemonic: string, operand: string, labels: Record<string, number>): void {
    const b8 = (v: number) => out.push(v & 0xFF);
    const b16 = (v: number) => { out.push(v & 0xFF); out.push((v >> 8) & 0xFF); };
    const ind = /^\[X\]$/i.test(operand.trim());

    switch (mnemonic) {
      case 'HLT': b8(0x00); break;
      case 'OUT': b8(0x01); break;
      case 'LDA':
        if (operand.startsWith('#')) { b8(0x02); b8(this.imm(operand.slice(1), labels)); }
        else if (ind) b8(0x05);
        else throw new Error('bad LDA operand: ' + operand);
        break;
      case 'LDB':
        if (operand.startsWith('#')) { b8(0x03); b8(this.imm(operand.slice(1), labels)); }
        else throw new Error('bad LDB operand: ' + operand);
        break;
      case 'LDX': b8(0x04); b16(this.imm(operand.replace(/^#/, ''), labels)); break;
      case 'STA':
        if (ind) b8(0x06); else throw new Error('bad STA operand: ' + operand);
        break;
      case 'CMP': b8(0x07); break;
      case 'INC':
        if (/^A$/i.test(operand)) b8(0x08);
        else if (/^B$/i.test(operand)) b8(0x09);
        else if (/^X$/i.test(operand)) b8(0x0A);
        else throw new Error('bad INC: ' + operand);
        break;
      case 'DEC':
        if (/^A$/i.test(operand)) b8(0x0B);
        else if (/^B$/i.test(operand)) b8(0x0C);
        else if (/^X$/i.test(operand)) b8(0x0D);
        else throw new Error('bad DEC: ' + operand);
        break;
      case 'JMP': b8(0x0E); b16(this.imm(operand, labels)); break;
      case 'JZ': b8(0x0F); b16(this.imm(operand, labels)); break;
      case 'JNZ': b8(0x10); b16(this.imm(operand, labels)); break;
      case 'CALL': b8(0x11); b16(this.imm(operand, labels)); break;
      case 'RET': b8(0x12); break;
      case 'PUSH': b8(0x13); break;
      case 'POP': b8(0x14); break;
      case 'ADD': b8(0x15); break;
      case 'SUB': b8(0x16); break;
      default: throw new Error('unknown mnemonic: ' + mnemonic);
    }
  }
}
