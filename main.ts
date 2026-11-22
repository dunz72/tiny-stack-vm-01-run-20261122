// Tiny stack VM for make.fun's tiny-stack-vm-01 ISA (kit ISA.md).
// Reads /input/<id>/{program,input}.bin, writes /output/<id>/{stdout.bin,exit.txt}.
// Node 22, stdlib only. Values are 32-bit ints; data stack <= 256, call
// stack <= 64, memory 256 words, <= 1,000,000 steps, <= 65,536 output bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode tables: immediate length, pops, pushes (0 for unknown opcodes).
const IM = new Uint8Array(256);
const PO = new Uint8Array(256);
const PU = new Uint8Array(256);
const VA = new Uint8Array(256);
for (const o of [0, 1, 2, 3, 4, 5, 6, 7, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22, 0x30, 0x31, 0x32, 0x33, 0x34, 0x40, 0x41, 0x50, 0x51, 0x52, 0x53]) VA[o] = 1;
IM[1] = 1; IM[2] = 4; IM[0x30] = IM[0x31] = IM[0x32] = IM[0x33] = 2;
for (const o of [1, 2, 0x52]) PU[o] = 1;
for (const o of [3, 0x17, 0x1b, 0x31, 0x32, 0x40, 0x50, 0x51, 0x53]) PO[o] = 1;
PO[4] = 1; PU[4] = 2;
PO[5] = 2; PU[5] = 2;
PO[6] = 2; PU[6] = 3;
PO[7] = 3; PU[7] = 3;
for (const o of [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22]) { PO[o] = 2; PU[o] = 1; }
PO[0x41] = 2;

function run(prog, input) {
  const n = prog.length;
  const st = new Int32Array(256);
  let sp = 0;
  const cs = new Int32Array(64);
  let cp = 0;
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let olen = 0, ipos = 0, pc = 0, steps = 0;
  const done = (exit) => ({ out: out.subarray(0, olen), exit });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = prog[pc];
    if (!VA[op]) return done(5);
    const imm = IM[op];
    if (pc + imm >= n) return done(9);
    steps++;
    const next = pc + 1 + imm;
    const pops = PO[op], pushes = PU[op];
    if (sp < pops) return done(2);
    if (sp - pops + pushes > 256) return done(3);
    pc = next;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: st[sp++] = (prog[next - 1] << 24) >> 24; break;
      case 0x02: st[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; break;
      case 0x07: { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; break; }
      case 0x17: st[sp - 1] = -st[sp - 1] | 0; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e: case 0x20: case 0x21: case 0x22: {
        const b = st[sp - 1], a = st[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return done(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return done(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return done(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return done(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; st[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = st[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return done(7);
        cs[cp++] = next; pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = cs[--cp];
        break;
      case 0x40: {
        const addr = st[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = st[sp - 1], v = st[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2; mem[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(st[sp - 1]);
        if (olen + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        out[olen++] = st[--sp] & 255;
        break;
      case 0x52: st[sp++] = ipos < input.length ? input[ipos++] : -1; break;
      case 0x53: return done(st[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  let prog;
  try { prog = readFileSync(join(I, id, 'program.bin')); } catch { continue; }
  let input;
  try { input = readFileSync(join(I, id, 'input.bin')); } catch { input = new Uint8Array(0); }
  const { out, exit } = run(prog, input);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), out);
  writeFileSync(join(O, id, 'exit.txt'), String(exit) + '\n');
}
