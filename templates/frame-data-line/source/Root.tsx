import React from 'react';
import { Composition } from 'remotion';
import { DataLine, type DataLineProps } from './DataLine';

const SAMPLE: DataLineProps = {
  data: {
    title: 'Monthly Active Users',
    points: [
      { label: 'Jan', value: 1200 },
      { label: 'Feb', value: 2400 },
      { label: 'Mar', value: 1800 },
      { label: 'Apr', value: 4200 },
      { label: 'May', value: 3600 },
      { label: 'Jun', value: 6100 },
    ],
    unit: 'K',
  },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="DataLine"
    component={DataLine}
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
