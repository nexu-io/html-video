import React from 'react';
import { Composition } from 'remotion';
import { KpiPulse, type KpiPulseProps } from './KpiPulse';

const SAMPLE: KpiPulseProps = {
  data: {
    title: 'Local render',
    label: 'per-clip fee',
    caption: 'HTML becomes video on your laptop — no cloud lock-in.',
    unit: '¢',
    value: 0,
  },
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="KpiPulse"
      component={KpiPulse}
      durationInFrames={120}
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
