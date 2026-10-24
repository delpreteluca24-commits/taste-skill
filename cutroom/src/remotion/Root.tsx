import React from 'react';
import { Composition } from 'remotion';
import { ShortVideo, type ShortVideoProps } from './ShortVideo';

export const COMPOSITION_ID = 'Cutroom';

export const Root: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={ShortVideo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={{ timeline: null as unknown as ShortVideoProps['timeline'], media: {}, assetBase: '', outWidth: 1080, outHeight: 1920 }}
    calculateMetadata={({ props }) => {
      const p = props as ShortVideoProps & { outWidth?: number; outHeight?: number };
      const fps = p.timeline?.fps ?? 30;
      return {
        fps,
        durationInFrames: Math.max(1, Math.round((p.timeline?.duration ?? 1) * fps)),
        width: p.outWidth ?? 1080,
        height: p.outHeight ?? 1920,
      };
    }}
  />
);
