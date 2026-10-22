// Render del reel: frame deterministici con Playwright + audio sintetizzato → MP4 H.264 con ffmpeg.
// Uso: node render.mjs [--preview 0.5,3,9...]  (senza argomenti: video completo)
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const FPS = 30, DUR = 20
const out = join(here, 'out')
const previewArg = process.argv.indexOf('--preview')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('file://' + join(here, 'index.html'))
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)

if (previewArg > -1) {
  const times = process.argv[previewArg + 1].split(',').map(Number)
  mkdirSync(join(out, 'preview'), { recursive: true })
  for (const t of times) {
    await page.evaluate((t) => window.render(t), t)
    await page.screenshot({ path: join(out, 'preview', `t${t.toFixed(2)}.jpg`), type: 'jpeg', quality: 85 })
  }
} else {
  const frames = join(out, 'frames')
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames, { recursive: true })
  for (let i = 0; i < FPS * DUR; i++) {
    await page.evaluate((t) => window.render(t), i / FPS)
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 })
  }
  const wav = await page.evaluate(() => window.renderAudio())
  writeFileSync(join(out, 'audio.wav'), Buffer.from(wav, 'base64'))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%04d.jpg'), '-i', join(out, 'audio.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest', join(out, 'love-escape-reel.mp4')])
  rmSync(frames, { recursive: true, force: true })
}
console.log(errors.length ? errors.join('\n') : 'ok')
await browser.close()
