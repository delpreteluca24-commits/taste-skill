#!/usr/bin/env node
// Synthesizes the SFX library with ffmpeg. No third-party audio → no licensing risk.
// Usage: node scripts/gen-sfx.mjs [outDir]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'public/sfx');
mkdirSync(out, { recursive: true });

const SR = 44100;
const sfx = {
  // filtered pink-noise swell with phaser movement
  whoosh: ['-f', 'lavfi', '-i', `anoisesrc=c=pink:r=${SR}:d=0.55:a=0.9`, '-af', 'highpass=f=350,lowpass=f=4200,aphaser=type=t:speed=2,afade=t=in:d=0.22:curve=exp,afade=t=out:st=0.25:d=0.3:curve=exp,volume=1.6'],
  swipe: ['-f', 'lavfi', '-i', `anoisesrc=c=white:r=${SR}:d=0.3:a=0.7`, '-af', 'highpass=f=1600,lowpass=f=9000,afade=t=in:d=0.08,afade=t=out:st=0.1:d=0.2:curve=exp,volume=1.2'],
  pop: ['-f', 'lavfi', '-i', `aevalsrc='0.9*sin(2*PI*(380+900*exp(-28*t))*t)*exp(-22*t)':s=${SR}:d=0.18`],
  click: ['-f', 'lavfi', '-i', `aevalsrc='0.8*sin(2*PI*2400*t)*exp(-140*t)+0.3*sin(2*PI*5200*t)*exp(-200*t)':s=${SR}:d=0.06`],
  hit: ['-f', 'lavfi', '-i', `aevalsrc='0.95*sin(2*PI*(48+140*exp(-22*t))*t)*exp(-7*t)+0.25*(random(0)*2-1)*exp(-45*t)':s=${SR}:d=0.5`, '-af', 'lowpass=f=5000'],
  impact: ['-f', 'lavfi', '-i', `aevalsrc='0.9*sin(2*PI*(38+100*exp(-9*t))*t)*exp(-3.5*t)+0.35*(random(0)*2-1)*exp(-14*t)':s=${SR}:d=1.1`, '-af', 'lowpass=f=3500,aecho=0.8:0.6:60|120:0.25|0.15'],
  riser: ['-f', 'lavfi', '-i', `aevalsrc='0.35*sin(2*PI*(180*t+380*t*t))*pow(t/1.2,2)+0.25*(random(0)*2-1)*pow(t/1.2,3)':s=${SR}:d=1.2`, '-af', 'highpass=f=200,afade=t=out:st=1.12:d=0.08'],
  notification: ['-f', 'lavfi', '-i', `aevalsrc='0.6*(lt(t,0.13)*sin(2*PI*988*t)*exp(-14*t)+gte(t,0.13)*sin(2*PI*1319*(t-0.13))*exp(-8*(t-0.13)))':s=${SR}:d=0.7`],
  // Viral "ting": glassy bell strike (bell partials, slight detune shimmer) + an octave-up sparkle 70 ms later,
  // a tiny noise glint on the attack and a short room. Peaks within 3 ms so it lands exactly on the frame.
  ting: ['-f', 'lavfi', '-i', `aevalsrc='(0.42*sin(2*PI*1976*t)+0.30*sin(2*PI*1981*t)+0.22*sin(2*PI*3952*t)*exp(-3*t)+0.16*sin(2*PI*5454*t)*exp(-6*t)+0.07*sin(2*PI*10670*t)*exp(-20*t))*exp(-3.2*t)*min(1,t/0.002)+gte(t,0.07)*(0.28*sin(2*PI*3952*(t-0.07))+0.12*sin(2*PI*7904*(t-0.07))*exp(-8*(t-0.07)))*exp(-5*(t-0.07))*min(1,(t-0.07)/0.002)+0.05*(random(0)*2-1)*exp(-t/0.006)':s=${SR}:d=1.3`, '-af', 'highpass=f=900,aecho=0.8:0.35:23|41:0.25|0.15,afade=t=out:st=1.05:d=0.25'],
  ding: ['-f', 'lavfi', '-i', `aevalsrc='0.55*sin(2*PI*1568*t)*exp(-4.5*t)+0.22*sin(2*PI*3136*t)*exp(-7*t)':s=${SR}:d=1.0`],
};

for (const [name, args] of Object.entries(sfx)) {
  const file = path.join(out, `${name}.wav`);
  const tmp = `${file}.tmp.wav`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', tmp]);
  // Peak-normalize every effect to -3 dBFS so per-effect gains in the engine are meaningful.
  const probe = spawnSync('ffmpeg', ['-nostats', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const max = parseFloat(/max_volume: (-?[\d.]+) dB/.exec(probe)?.[1] ?? '0');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', `volume=${(-3 - max).toFixed(2)}dB`, '-c:a', 'pcm_s16le', file]);
  unlinkSync(tmp);
  console.log('✓', file);
}
