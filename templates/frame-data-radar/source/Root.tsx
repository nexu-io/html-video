import React from 'react';
import { Composition } from 'remotion';
import { DataRadar, type DataRadarProps } from './DataRadar';

const SAMPLE: DataRadarProps = {
  data: {
    title: 'KPI Five Dimensions',
    axes: [
      { label: 'Cost', value: 0.28 },
      { label: 'Quality', value: 0.45 },
      { label: 'Delivery', value: 0.62 },
      { label: 'Flexibility', value: 0.35 },
      { label: 'Innovation', value: 0.50 },
    ],
    maxValue: 0.8,
    warnThreshold: 0.3,
  },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="DataRadar"
    component={DataRadar}
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
