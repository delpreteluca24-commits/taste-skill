#!/usr/bin/env node
// Built-in track "pizzeria", synthesized from scratch → no licensing risk.
// Cheerful Neapolitan canzone in D major, 2/4 at 112 bpm: mandolin melody (picked + tremolo), musette accordion
// (melody in the B sections, off-beat stabs elsewhere), guitar, upright bass "oom-pah", soft shaker. Original melody.
// Usage: node scripts/gen-music-pizzeria.mjs [outDir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'public/music');
mkdirSync(out, { recursive: true });

const SR = 44100;
const E = 60 / 112 / 2; // eighth note
const BAR = 4 * E;
const L = new Float32Array(SR * 80);
const R = new Float32Array(SR * 80);

let seed = 20261001;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const freq = (n) => {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  return 440 * 2 ** ((NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
};
const put = (i, v, pan) => {
  if (i < 0 || i >= L.length) return;
  L[i] += v * Math.cos((pan + 1) * Math.PI / 4);
  R[i] += v * Math.sin((pan + 1) * Math.PI / 4);
};

/** Karplus-Strong plucked string. */
function pluck(t0, f, dur, gain, { decay = 0.996, bright = 0.6, pan = 0 } = {}) {
  const n = Math.max(2, Math.round(SR / f));
  const ring = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) { prev = bright * rand() + (1 - bright) * prev; ring[i] = prev; }
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const a = ring[idx];
    ring[idx] = decay * 0.5 * (a + ring[(idx + 1) % n]);
    idx = (idx + 1) % n;
    const env = Math.min(1, i / 30, (len - i) / (SR * 0.06));
    put(start + i, a * gain * env, pan);
  }
}

/** Mandolin: double course; picked on short notes, tremolo on long ones. */
function mandolin(t0, note, eighths, gain) {
  const f = freq(note);
  const dur = eighths * E;
  const course = (t, g) => {
    pluck(t, f, 0.5, g, { decay: 0.995, bright: 0.8, pan: 0.25 });
    pluck(t + 0.004, f * 1.002, 0.5, g * 0.7, { decay: 0.995, bright: 0.8, pan: 0.35 });
  };
  if (eighths < 2) { course(t0, gain); return; }
  const step = E / 4;
  for (let k = 0; k * step < dur - 0.02; k++) course(t0 + k * step + rand() * 0.003, gain * (k === 0 ? 1.1 : k % 2 ? 0.55 : 0.75));
}

/** Musette accordion: two reeds ±7 cents (the classic Italian beating), bellows envelope. */
function accordion(t0, note, dur, gain, pan = -0.3) {
  const f = freq(note);
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const H = 10;
  for (const det of [2 ** (-7 / 1200), 2 ** (7 / 1200)]) {
    const ph = Array.from({ length: H }, () => (rand() + 1) * 3.14);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.025) * Math.min(1, (len - i) / (SR * 0.05));
      let v = 0;
      for (let h = 1; h <= H; h++) v += Math.sin(2 * Math.PI * f * det * h * t + ph[h - 1]) / h ** 1.15 * (h === 2 ? 0.6 : 1);
      put(start + i, v * gain * env * 0.5, pan);
    }
  }
}

function shaker(t0, gain) {
  const start = Math.round(t0 * SR);
  let hp = 0, prev = 0;
  for (let i = 0; i < SR * 0.06; i++) {
    const x = rand();
    hp = 0.85 * (hp + x - prev); prev = x; // high-passed noise
    const e = Math.min(1, i / (SR * 0.008)) * Math.exp(-i / (SR * 0.02));
    put(start + i, hp * gain * e, 0.5);
  }
}

// Chords: [bass root, bass fifth, chord voicing]
const CH = {
  D: ['D2', 'A2', ['F#3', 'A3', 'D4']], A7: ['A2', 'E2', ['G3', 'C#4', 'E4']], G: ['G2', 'D3', ['G3', 'B3', 'D4']],
  E7: ['E2', 'B2', ['G#3', 'D4', 'E4']], Bm: ['B2', 'F#2', ['F#3', 'B3', 'D4']],
};
// Melodies: [note | 'R', eighths]; 8 bars of 2/4 each.
const A = [
  ['A4', 1], ['F#4', 1], ['A4', 1], ['D5', 1], ['F#5', 2], ['E5', 1], ['D5', 1],
  ['C#5', 1], ['E5', 1], ['A5', 1], ['G5', 1], ['E5', 3], ['A4', 1],
  ['G4', 1], ['C#5', 1], ['E5', 1], ['G5', 1], ['F#5', 1], ['E5', 1], ['D5', 1], ['C#5', 1],
  ['D5', 1], ['F#5', 1], ['E5', 1], ['C#5', 1], ['D5', 3], ['R', 1],
];
const harmA = ['D', 'D', 'A7', 'A7', 'A7', 'A7', 'D', 'D'];
const B = [
  ['B4', 1], ['D5', 1], ['G5', 2], ['F#5', 1], ['A5', 1], ['F#5', 1], ['D5', 1],
  ['E5', 1], ['G#5', 1], ['B5', 1], ['G#5', 1], ['A5', 2], ['G5', 1], ['E5', 1],
  ['F#5', 1], ['D5', 1], ['B4', 1], ['D5', 1], ['E5', 1], ['C#5', 1], ['A4', 1], ['C#5', 1],
  ['D5', 1], ['F#5', 1], ['E5', 1], ['C#5', 1], ['D5', 4],
];
const harmB = ['G', 'D', 'E7', 'A7', 'Bm', 'A7', 'A7', 'D'];

function comp(t, harm, { stabs = true } = {}) {
  harm.forEach((c, i) => {
    const [root, fifth, tones] = CH[c];
    const b0 = t + i * BAR;
    pluck(b0, freq(root), 2 * E + 0.05, 0.3, { decay: 0.997, bright: 0.12, pan: -0.05 });
    pluck(b0 + 2 * E, freq(fifth), 2 * E + 0.05, 0.26, { decay: 0.997, bright: 0.12, pan: -0.05 });
    for (const off of [1, 3]) {
      tones.forEach((n, j) => pluck(b0 + off * E + j * 0.01, freq(n), 0.2, 0.11, { decay: 0.992, bright: 0.45, pan: 0.15 }));
      if (stabs) tones.forEach((n) => accordion(b0 + off * E, n, E * 0.7, 0.028));
    }
    for (let k = 0; k < 8; k++) shaker(b0 + k * (E / 2), k % 2 ? 0.035 : 0.06);
  });
}
function melody(t, mel, inst) {
  let mt = t;
  for (const [n, d] of mel) {
    if (n !== 'R') {
      if (inst !== 'acc') mandolin(mt, n, d, 0.17);
      if (inst !== 'mand') accordion(mt, n, d * E * 0.95, inst === 'acc' ? 0.06 : 0.035, -0.35);
    }
    mt += d * E;
  }
}

// Form: 2-bar vamp, then A A B B A A' B A — mandolin leads, accordion takes the B sections, both in the finale.
let t = 0.15;
comp(t, ['D', 'A7']);
t += 2 * BAR;
for (const [mel, harm, inst] of [[A, harmA, 'mand'], [A, harmA, 'mand'], [B, harmB, 'acc'], [B, harmB, 'both'], [A, harmA, 'mand'], [A, harmA, 'acc'], [B, harmB, 'mand'], [A, harmA, 'both']]) {
  comp(t, harm, { stabs: inst !== 'acc' });
  melody(t, mel, inst);
  t += harm.length * BAR;
}
// Final chord.
const [root, , tones] = CH.D;
pluck(t, freq(root), 2.5, 0.55, { decay: 0.998, bright: 0.25 });
tones.forEach((n, j) => { pluck(t + j * 0.02, freq(n), 2.5, 0.12, { decay: 0.998, bright: 0.45, pan: 0.15 }); accordion(t, n, 1.8, 0.03); });
mandolin(t, 'D5', 6, 0.15);
const LENGTH = t + 2.6;

// Small-room reverb (Schroeder: 4 combs + 2 allpasses per channel), then 16-bit stereo WAV.
function reverb(x, offs) {
  const y = new Float32Array(x.length);
  for (const [d, g] of [[1116, 0.78], [1188, 0.77], [1277, 0.76], [1356, 0.75]].map(([d, g]) => [d + offs, g])) {
    const b = new Float32Array(d); let k = 0, lp = 0;
    for (let i = 0; i < x.length; i++) { const o = b[k]; lp = o * 0.6 + lp * 0.4; b[k] = x[i] + lp * g; k = (k + 1) % d; y[i] += o * 0.25; }
  }
  for (const d of [556 + offs, 441 + offs]) {
    const b = new Float32Array(d); let k = 0;
    for (let i = 0; i < y.length; i++) { const o = b[k]; const v = y[i] + o * 0.5; b[k] = v; y[i] = o - v * 0.5; k = (k + 1) % d; }
  }
  return y;
}
const n = Math.ceil(LENGTH * SR);
const wl = reverb(L.subarray(0, n), 0);
const wr = reverb(R.subarray(0, n), 23);
let max = 0;
const mixL = new Float32Array(n), mixR = new Float32Array(n);
for (let i = 0; i < n; i++) { mixL[i] = L[i] + 0.22 * wl[i]; mixR[i] = R[i] + 0.22 * wr[i]; max = Math.max(max, Math.abs(mixL[i]), Math.abs(mixR[i])); }
const pcm = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  pcm.writeInt16LE(Math.round((mixL[i] / max) * 0.9 * 32767), i * 4);
  pcm.writeInt16LE(Math.round((mixR[i] / max) * 0.9 * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24);
hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
const wav = path.join(out, 'pizzeria.raw.wav');
writeFileSync(wav, Buffer.concat([hdr, pcm]));
const dst = path.join(out, 'pizzeria.m4a');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav,
  '-af', 'highpass=f=45,equalizer=f=350:t=q:w=1:g=-1.5,equalizer=f=3000:t=q:w=1:g=-2.5,acompressor=threshold=-18dB:ratio=2:attack=15:release=250,loudnorm=I=-18:TP=-2',
  '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', dst]);
unlinkSync(wav);
console.log('✓', dst, `${LENGTH.toFixed(1)} s`);
