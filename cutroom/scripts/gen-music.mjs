#!/usr/bin/env node
// Built-in music library, synthesized from scratch (Karplus-Strong plucked strings) → no licensing risk.
// "tarantella": Neapolitan-style 6/8 in A minor — mandolin tremolo melody, guitar bass + strums, light tambourine.
// Usage: node scripts/gen-music.mjs [outDir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'public/music');
mkdirSync(out, { recursive: true });

const SR = 44100;
const EIGHTH = 0.2; // 6/8 at 100 dotted-quarter bpm
const LENGTH = 78; // seconds (loops in the app)
const buf = new Float32Array(Math.ceil(SR * (LENGTH + 2)));

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const freq = (n) => {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  return 440 * 2 ** ((NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
};

/** Karplus-Strong pluck added into the mix. `bright` 0..1 shapes the excitation, `decay` the sustain. */
function pluck(t0, f, dur, gain, { decay = 0.996, bright = 0.6, pan = 0 } = {}) {
  const n = Math.max(2, Math.round(SR / f));
  const ring = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const r = rand();
    prev = bright * r + (1 - bright) * prev; // low-pass noise burst = softer attack
    ring[i] = prev;
  }
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let idx = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const a = ring[idx];
    const b = ring[(idx + 1) % n];
    const v = decay * 0.5 * (a + b);
    ring[idx] = v;
    idx = (idx + 1) % n;
    const env = i < 40 ? i / 40 : 1;
    const tail = len - i < 400 ? (len - i) / 400 : 1;
    buf[start + i] += a * gain * env * tail * (1 + pan * 0);
  }
}

/** Mandolin: two slightly detuned courses, tremolo picking. */
function mandolin(t0, note, beats, gain) {
  const f = freq(note);
  const strokes = Math.round((beats * EIGHTH) / 0.05);
  for (let k = 0; k < strokes; k++) {
    const t = t0 + k * 0.05 + (rand() * 0.004);
    const g = gain * (k % 2 ? 0.72 : 1) * (k === 0 ? 1.25 : 1);
    pluck(t, f, 0.16, g, { decay: 0.994, bright: 0.85 });
    pluck(t + 0.003, f * 1.0018, 0.16, g * 0.7, { decay: 0.994, bright: 0.85 });
  }
}

function tambourine(t0, gain) {
  const start = Math.round(t0 * SR);
  for (let i = 0; i < SR * 0.09; i++) {
    const e = Math.exp(-i / (SR * 0.018));
    buf[start + i] += rand() * gain * e * (i % 3 === 0 ? 1 : 0.4);
  }
}

// Melody: [note, eighths] — an original tarantella-style line (8 bars of 6/8 per phrase).
const A = [
  ['A4', 1], ['C5', 1], ['E5', 1], ['E5', 1], ['D5', 1], ['C5', 1],
  ['B4', 1], ['D5', 1], ['E5', 1], ['E5', 1], ['D5', 1], ['B4', 1],
  ['A4', 1], ['C5', 1], ['E5', 1], ['A5', 1], ['G5', 1], ['E5', 1],
  ['F5', 1], ['E5', 1], ['D5', 1], ['C5', 1], ['B4', 1], ['G#4', 1],
  ['D5', 1], ['F5', 1], ['A5', 1], ['A5', 1], ['G5', 1], ['F5', 1],
  ['E5', 1], ['A4', 1], ['C5', 1], ['E5', 1], ['D5', 1], ['C5', 1],
  ['B4', 1], ['G#4', 1], ['B4', 1], ['D5', 1], ['C5', 1], ['B4', 1],
  ['A4', 3], ['E4', 1], ['A4', 2],
];
const B = [
  ['C5', 2], ['B4', 1], ['C5', 2], ['D5', 1],
  ['E5', 3], ['C5', 3],
  ['D5', 2], ['C5', 1], ['D5', 2], ['E5', 1],
  ['F5', 3], ['D5', 3],
  ['E5', 1], ['F5', 1], ['E5', 1], ['D5', 1], ['C5', 1], ['B4', 1],
  ['C5', 1], ['D5', 1], ['C5', 1], ['B4', 1], ['A4', 1], ['G#4', 1],
  ['A4', 1], ['B4', 1], ['C5', 1], ['B4', 1], ['G#4', 1], ['E4', 1],
  ['A4', 6],
];
// Chords per bar: [bass root, fifth, chord tones]
const CH = {
  Am: ['A2', 'E3', ['A3', 'C4', 'E4']], E7: ['E2', 'B2', ['G#3', 'D4', 'E4']], Dm: ['D3', 'A2', ['D4', 'F4', 'A3']], C: ['C3', 'G2', ['C4', 'E4', 'G3']], F: ['F2', 'C3', ['F3', 'A3', 'C4']],
};
const harmA = ['Am', 'E7', 'Am', 'E7', 'Dm', 'Am', 'E7', 'Am'];
const harmB = ['C', 'Am', 'Dm', 'F', 'Am', 'E7', 'E7', 'Am'];

const bar = EIGHTH * 6;
const form = [['A', A, harmA], ['A', A, harmA], ['B', B, harmB], ['A', A, harmA], ['B', B, harmB], ['A', A, harmA], ['A', A, harmA], ['B', B, harmB]];
let t = 0.4;
for (const [, mel, harm] of form) {
  if (t > LENGTH - 2) break;
  harm.forEach((c, i) => {
    const [root, fifth, tones] = CH[c];
    const b0 = t + i * bar;
    pluck(b0, freq(root), 0.55, 0.55, { decay: 0.997, bright: 0.35 });
    pluck(b0 + 3 * EIGHTH, freq(fifth), 0.55, 0.45, { decay: 0.997, bright: 0.35 });
    for (const off of [1, 2, 4, 5]) tones.forEach((n, j) => pluck(b0 + off * EIGHTH + j * 0.012, freq(n), 0.22, 0.14, { decay: 0.993, bright: 0.5 }));
    tambourine(b0, 0.05);
    tambourine(b0 + 3 * EIGHTH, 0.04);
  });
  let mt = t;
  for (const [n, d] of mel) {
    mandolin(mt, n, d, 0.22);
    mt += d * EIGHTH;
  }
  t += harm.length * bar;
}

// Normalize and write 16-bit mono WAV, then master with ffmpeg (small room, gentle EQ, fades, AAC).
let max = 0;
for (const v of buf) max = Math.max(max, Math.abs(v));
const pcm = Buffer.alloc(buf.length * 2);
for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.round((buf[i] / max) * 0.9 * 32767), i * 2);
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24);
hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
const wav = path.join(out, 'tarantella.raw.wav');
writeFileSync(wav, Buffer.concat([hdr, pcm]));
const dst = path.join(out, 'tarantella.m4a');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-t', String(LENGTH),
  '-af', `highpass=f=60,equalizer=f=2500:t=q:w=1:g=-2,aecho=0.8:0.5:40|70:0.18|0.12,pan=stereo|c0=c0|c1=c0,afade=t=in:d=0.3,afade=t=out:st=${LENGTH - 2}:d=2,loudnorm=I=-18:TP=-2`,
  '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', dst]);
unlinkSync(wav);
console.log('✓', dst);
