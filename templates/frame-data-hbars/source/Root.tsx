import React from 'react';
import { Composition } from 'remotion';
import { DataHBars, type DataHBarsProps } from './DataHBars';

const SAMPLE: DataHBarsProps = {
  data: {
    title: 'Department Scores',
    items: [
      { label: 'Engineering', value: 92 },
      { label: 'Design', value: 88 },
      { label: 'Marketing', value: 76 },
      { label: 'Sales', value: 71 },
      { label: 'Support', value: 65 },
      { label: 'Operations', value: 58 },
    ],
    splitAt: 3,
    unit: 'pts',
  },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="DataHBars"
    component={DataHBars}
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
