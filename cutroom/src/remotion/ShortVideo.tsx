import React, { useMemo } from 'react';
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ClipItem, Timeline } from '../core/timeline';
import { cropWindow } from '../core/agents/reframe';
import { Captions } from './Captions';
import { Graphics } from './Graphics';
import { loadCaptionFonts } from './fonts';
import { GRADE_FILTER, transitionAt, zoomAt, zoomFocusAt } from './math';

export interface MediaRef { src: string; voiceSrc?: string; origSrc?: string; width: number; height: number }

export interface ShortVideoProps {
  timeline: Timeline;
  /** mediaId → playable file (proxy in preview, master in render). */
  media: Record<string, MediaRef>;
  /** Base URL serving /fonts and /sfx. */
  assetBase: string;
  [key: string]: unknown;
}

const W = 1080;
const H = 1920;

const ClipView: React.FC<{ clip: ClipItem; media: MediaRef; timeline: Timeline; speech: (readonly [number, number])[] }> = ({ clip, media, timeline, speech }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = clip.start + frame / fps;
  const scale = zoomAt(timeline.zoom, t);
  // Camera travels toward a zoom's focus point (e.g. the ingredient plate) as the zoom builds up.
  const zf = zoomFocusAt(timeline.zoom, t);
  const base = clip.properties.crop;
  const k = zf ? Math.min(1, Math.max(0, (scale - 1) / Math.max(0.01, zf.to - 1))) : 0;
  const focus = zf ? { x: base.x + (zf.x - base.x) * k, y: base.y + (zf.y - base.y) * k, mode: 'manual' as const } : base;
  const win = cropWindow(media.width, media.height, focus, scale);
  const vw = W / win.w;
  const vh = H / win.h;
  // Voice isolation: play the denoised voice track and close it between phrases (only the speaker is heard).
  const iso = timeline.settings.voiceIsolation ?? 0;
  const role = clip.properties.role;
  // Inserts (gags) keep their own sound: the rooster must be heard.
  const isolate = iso > 0 && !!media.voiceSrc && role !== 'insert';
  // The channel intro plays its ORIGINAL audio, untouched, every time.
  const slogan = timeline.graphics.find((g) => g.properties.kind === 'slogan');
  const useOrig = !!slogan && !!media.origSrc && clip.start < slogan.end && clip.end > slogan.start;
  const inSlogan = (tt: number) => {
    if (!slogan) return 0;
    const ramp = 0.04;
    if (tt < slogan.start - ramp || tt > slogan.end + ramp) return 0;
    return Math.min(1, (tt - (slogan.start - ramp)) / ramp, (slogan.end + ramp - tt) / ramp);
  };
  const floor = 1 - 0.97 * iso;
  const gate = (tt: number) => {
    let near = Infinity;
    for (const [a, b] of speech) {
      if (tt >= a && tt <= b) return 1;
      near = Math.min(near, Math.abs(tt - a), Math.abs(tt - b));
    }
    return floor + (1 - floor) * Math.max(0, 1 - near / 0.25);
  };
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
      <OffthreadVideo
        src={media.src}
        trimBefore={Math.max(0, Math.round(clip.properties.srcStart * fps))}
        playbackRate={clip.properties.speed}
        volume={isolate ? 0 : (fr: number) => clip.properties.volume * (useOrig ? 1 - inSlogan(clip.start + fr / fps) : 1)}
        muted={isolate}
        pauseWhenBuffering
        style={{ position: 'absolute', width: vw, height: vh, left: -win.x * vw, top: -win.y * vh, maxWidth: 'none', objectFit: 'fill' }}
      />
      {isolate && (
        <Html5Audio
          src={media.voiceSrc!}
          trimBefore={Math.max(0, Math.round(clip.properties.srcStart * fps))}
          playbackRate={clip.properties.speed}
          volume={(f) => {
            const tt = clip.start + f / fps;
            return clip.properties.volume * (1 - (useOrig ? inSlogan(tt) : 0)) * (role === 'broll' ? floor : gate(tt));
          }}
        />
      )}
      {useOrig && (
        <Html5Audio
          src={media.origSrc!}
          trimBefore={Math.max(0, Math.round(clip.properties.srcStart * fps))}
          playbackRate={clip.properties.speed}
          volume={(f) => clip.properties.volume * inSlogan(clip.start + f / fps)}
        />
      )}
    </AbsoluteFill>
  );
};

/** One composition for preview (Remotion Player) and export (renderMedia): preview == final render. */
export const ShortVideo: React.FC<ShortVideoProps> = ({ timeline, media, assetBase }) => {
  loadCaptionFonts(assetBase);
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const s = timeline.settings;
  const f = (sec: number) => Math.round(sec * fps);

  const tr = transitionAt(timeline.transitions, t);
  let layerTransform = '';
  let layerFilter = GRADE_FILTER[s.grade] ?? 'none';
  let flash = 0;
  let swipe: number | null = null;
  if (tr) {
    if (tr.kind === 'whip') { layerTransform = `translateX(${tr.dir * tr.k * -160}px)`; layerFilter += ` blur(${(tr.k * 16).toFixed(1)}px)`; }
    if (tr.kind === 'zoom') { layerTransform = `scale(${1 + tr.k * 0.2})`; layerFilter += ` blur(${(tr.k * 6).toFixed(1)}px)`; }
    if (tr.kind === 'blur') layerFilter += ` blur(${(tr.k * 18).toFixed(1)}px)`;
    if (tr.kind === 'flash') flash = tr.k * 0.85;
    if (tr.kind === 'swipe') swipe = tr.dir < 0 ? tr.k : 2 - tr.k;
  }
  for (const e of timeline.effects) {
    if (t >= e.start && t < e.end && e.properties.kind === 'flash') flash = Math.max(flash, (1 - (t - e.start) / (e.end - e.start)) * e.properties.intensity);
  }

  // Music ducking: speech spans from the subtitle words.
  // Words merged into phrases: gating/ducking per word pumps audibly between words.
  const speech = useMemo(() => {
    const spans = timeline.subtitles.flatMap((x) => x.properties.words.map((w) => [w.start - 0.12, w.end + 0.2] as [number, number])).sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    for (const s of spans) {
      const last = out[out.length - 1];
      if (last && s[0] - last[1] < 0.6) last[1] = Math.max(last[1], s[1]);
      else out.push([s[0], s[1]]);
    }
    return out as (readonly [number, number])[];
  }, [timeline.subtitles]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <div style={{ position: 'absolute', width: W, height: H, transform: `scale(${width / W})`, transformOrigin: 'top left' }}>
        <AbsoluteFill style={{ transform: layerTransform || undefined, filter: layerFilter }}>
          {timeline.clips.map((c) => {
            const m = media[c.source];
            if (!m) return null;
            return (
              <Sequence key={c.id} from={f(c.start)} durationInFrames={Math.max(1, f(c.end) - f(c.start))} premountFor={Math.round(fps * 0.8)}>
                <ClipView clip={c} media={m} timeline={timeline} speech={speech} />
              </Sequence>
            );
          })}
        </AbsoluteFill>
        {s.grade === 'cinematic' ? <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)' }} /> : null}
        <Graphics items={timeline.graphics} t={t} accent={s.accent} duration={timeline.duration} media={media} />
        {/* Captions sit above cutaways (speech continues over a photo) and step aside for the slogan, which is the caption. */}
        {!timeline.graphics.some((g) => g.properties.kind === 'slogan' && t >= g.start && t < g.end) && <Captions subs={timeline.subtitles} cs={s.captions} t={t} />}
        {flash > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: flash }} /> : null}
        {swipe !== null ? <AbsoluteFill style={{ background: s.accent, transform: `translateX(${(swipe - 1) * 100}%)` }} /> : null}
      </div>

      {timeline.audio.map((x) => (
        <Sequence key={x.id} from={f(x.start)} durationInFrames={Math.max(1, f(x.end) - f(x.start) + f(0.6))} layout="none">
          <Html5Audio src={`${assetBase}/sfx/${x.properties.name}.wav`} volume={x.properties.volume} />
        </Sequence>
      ))}
      {timeline.music.map((m) => {
        const src = m.source.startsWith('builtin:') ? `${assetBase}/music/${m.source.slice(8)}.wav` : media[m.source]?.src;
        if (!src) return null;
        const { volume, duckVolume, fadeIn, fadeOut } = m.properties;
        return (
          <Sequence key={m.id} from={f(m.start)} durationInFrames={Math.max(1, f(m.end) - f(m.start))} layout="none">
            <Html5Audio
              src={src}
              loop
              volume={(fr) => {
                const tt = m.start + fr / fps;
                // Smooth ducking: ramps in/out over 0.35 s around phrases instead of switching per word.
                let near = Infinity;
                for (const [a, b] of speech) near = Math.min(near, tt >= a && tt <= b ? 0 : Math.min(Math.abs(tt - a), Math.abs(tt - b)));
                const duck = Math.max(0, 1 - near / 0.35);
                const fade = Math.min(1, (tt - m.start) / Math.max(0.01, fadeIn), (m.end - tt) / Math.max(0.01, fadeOut));
                return Math.max(0, (volume + (duckVolume - volume) * duck) * fade);
              }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
