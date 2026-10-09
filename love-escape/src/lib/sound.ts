// Ambient pad generato con Web Audio: nessun file audio, funziona offline.
// Parte SOLO su richiesta (pulsante Sound) e si spegne con dissolvenza.
let ctx: AudioContext | null = null
let master: GainNode | null = null
let nodes: AudioScheduledSourceNode[] = []

const NOTES = [87.31, 130.81, 174.61, 220.0, 261.63, 329.63, 392.0] // Fmaj9 aperto

export async function startAmbient() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx = ctx ?? new AC()
  await ctx.resume()
  master = ctx.createGain()
  master.gain.value = 0
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  filter.Q.value = 0.6
  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.frequency.value = 0.05
  lfoGain.gain.value = 350
  lfo.connect(lfoGain).connect(filter.frequency)
  lfo.start()
  nodes.push(lfo)

  const delay = ctx.createDelay(2)
  delay.delayTime.value = 0.55
  const fb = ctx.createGain()
  fb.gain.value = 0.35
  delay.connect(fb).connect(delay)

  filter.connect(master)
  filter.connect(delay)
  delay.connect(master)
  master.connect(ctx.destination)

  NOTES.forEach((f, i) => {
    for (const detune of [-6, 6]) {
      const o = ctx!.createOscillator()
      o.type = i < 2 ? 'sine' : 'triangle'
      o.frequency.value = f
      o.detune.value = detune
      const g = ctx!.createGain()
      g.gain.value = i < 2 ? 0.16 : 0.05
      o.connect(g).connect(filter)
      o.start()
      nodes.push(o)
    }
  })
  master.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 3)
}

export function stopAmbient() {
  if (!ctx || !master) return
  const m = master
  const list = nodes
  nodes = []
  master = null
  m.gain.cancelScheduledValues(ctx.currentTime)
  m.gain.setValueAtTime(m.gain.value, ctx.currentTime)
  m.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2)
  window.setTimeout(() => {
    list.forEach((n) => { try { n.stop() } catch { /* già fermo */ } })
    m.disconnect()
  }, 1400)
}
