/**
 * Root — registers the native DataDonut composition.
 *
 * The adapter's render.ts overrides width/height/fps/durationInFrames per call
 * via selectComposition() and feeds real data through inputProps.
 * calculateMetadata ensures the canvas adapts to non-16:9 aspect ratios.
 */
import React from 'react';
import { Composition } from 'remotion';
import { DataDonut, type DataDonutProps } from './DataDonut';

const SAMPLE: DataDonutProps = {
  data: {
    title: 'Revenue by Region',
    unit: 'K',
    items: [
      { label: 'North America', value: 420, color: '#3B82F6' },
      { label: 'Europe', value: 280, color: '#22C55E' },
      { label: 'Asia Pacific', value: 190, color: '#EAB308' },
      { label: 'Latin America', value: 75, color: '#F97316' },
      { label: 'Middle East', value: 35, color: '#A855F7' },
    ],
    centerLabel: 'Revenue',
  },
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DataDonut"
      component={DataDonut}
      // Placeholder — render.ts overrides these at render time.
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={SAMPLE}
      calculateMetadata={({ props }) => ({
        width: (props as { width?: number }).width ?? 1920,
        height: (props as { height?: number }).height ?? 1080,
      })}
    />
  );
};
