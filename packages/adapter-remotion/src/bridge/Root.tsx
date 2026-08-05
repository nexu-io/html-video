// Root — registers the single generic bridge composition. render.ts overrides
// width/height/fps/durationInFrames per call via selectComposition(), and passes
// the HTML frame path + size through inputProps. (RFC-08 §5)
import type React from 'react';
import { Composition } from 'remotion';
import { HtmlFrameDriver, type HtmlFrameDriverProps } from './HtmlFrameDriver';

const DEFAULTS: HtmlFrameDriverProps = {
  html: '<!doctype html><html><body></body></html>',
  width: 1920,
  height: 1080,
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HtmlFrame"
      component={HtmlFrameDriver}
      // Placeholder metadata; render.ts overrides all of these at render time.
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={DEFAULTS}
      // Let inputProps.width/height drive the canvas so a 9:16 / 1:1 frame isn't
      // squashed into 16:9. duration/fps come from selectComposition overrides.
      calculateMetadata={({ props }) => ({
        width: props.width ?? 1920,
        height: props.height ?? 1080,
      })}
    />
  );
};
