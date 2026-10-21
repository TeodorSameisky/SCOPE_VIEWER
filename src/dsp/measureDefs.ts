import type { MeasurementKey } from './measure'

export type MeasureGroup = 'amplitude' | 'timing'

export interface MeasurementDef {
  key: MeasurementKey
  label: string
  /** 'y' = vertical unit of the channel */
  unit: 'y' | 's' | 'Hz' | '%'
  group: MeasureGroup
  /** One-line description */
  short: string
  /** How the value is computed */
  method: string
  formula?: string
}

/**
 * Definitions and documentation of all automatic measurements. The wording follows
 * the conventions of Tektronix oscilloscopes (IEEE 181 style reference levels).
 */
export const MEASUREMENT_DEFS: MeasurementDef[] = [
  {
    key: 'max',
    label: 'Maximum',
    unit: 'y',
    group: 'amplitude',
    short: 'Most positive value in the range.',
    method: 'The largest sample value inside the measurement range, including overshoot and noise peaks.',
  },
  {
    key: 'min',
    label: 'Minimum',
    unit: 'y',
    group: 'amplitude',
    short: 'Most negative value in the range.',
    method: 'The smallest sample value inside the measurement range, including undershoot and noise peaks.',
  },
  {
    key: 'pkpk',
    label: 'Peak-to-peak',
    unit: 'y',
    group: 'amplitude',
    short: 'Difference between Maximum and Minimum.',
    method: 'Total vertical span of the signal in the range. Sensitive to single spikes and noise.',
    formula: 'Max − Min',
  },
  {
    key: 'mean',
    label: 'Mean',
    unit: 'y',
    group: 'amplitude',
    short: 'Average value (DC level) over the range.',
    method:
      'Arithmetic mean of all samples in the range. For periodic signals the result depends on whether the range covers whole periods; use "Between cursors" set to an integer number of periods for a cycle mean.',
    formula: 'Σ vᵢ / N',
  },
  {
    key: 'rms',
    label: 'RMS',
    unit: 'y',
    group: 'amplitude',
    short: 'True root-mean-square value, DC included.',
    method:
      'Square root of the mean of the squared samples. Includes the DC component (like a DC-coupled true-RMS meter). Same note on whole periods as for Mean.',
    formula: '√( Σ vᵢ² / N )',
  },
  {
    key: 'top',
    label: 'Top',
    unit: 'y',
    group: 'amplitude',
    short: 'The upper signal level (the "high" state), ignoring overshoot.',
    method:
      'The most frequent value (histogram mode) in the upper half of the signal’s range. If there is no distinct level (e.g. a sine or a ramp) Maximum is used instead.',
  },
  {
    key: 'base',
    label: 'Base',
    unit: 'y',
    group: 'amplitude',
    short: 'The lower signal level (the "low" state), ignoring undershoot.',
    method:
      'The most frequent value (histogram mode) in the lower half of the signal’s range. If there is no distinct level Minimum is used instead.',
  },
  {
    key: 'amplitude',
    label: 'Amplitude',
    unit: 'y',
    group: 'amplitude',
    short: 'Height of the pulse: Top minus Base.',
    method: 'Difference between the two signal levels. Unlike Peak-to-peak it is not affected by overshoot, ringing or short spikes.',
    formula: 'Top − Base',
  },
  {
    key: 'frequency',
    label: 'Frequency',
    unit: 'Hz',
    group: 'timing',
    short: 'Repetition rate: 1 / Period.',
    method: 'Reciprocal of the Period measurement. Needs at least two rising edges in the range.',
    formula: '1 / Period',
  },
  {
    key: 'period',
    label: 'Period',
    unit: 's',
    group: 'timing',
    short: 'Time between consecutive rising edges.',
    method:
      'Average time between successive rising edges, each taken where the signal crosses the 50 % (mid) reference level. With more than two edges in the range the result is averaged over all cycles.',
    formula: '(t_last − t_first) / (edges − 1)',
  },
  {
    key: 'riseTime',
    label: 'Rise time',
    unit: 's',
    group: 'timing',
    short: 'Duration of the first rising edge, 10 % → 90 %.',
    method:
      'Time the first rising edge in the range needs to go from the 10 % to the 90 % reference level. Crossings are interpolated between samples; the result cannot be meaningfully shorter than about two sample intervals.',
    formula: 't(90 %) − t(10 %)',
  },
  {
    key: 'fallTime',
    label: 'Fall time',
    unit: 's',
    group: 'timing',
    short: 'Duration of the first falling edge, 90 % → 10 %.',
    method: 'Time the first falling edge in the range needs to go from the 90 % to the 10 % reference level, interpolated between samples.',
    formula: 't(10 %) − t(90 %)',
  },
  {
    key: 'posWidth',
    label: 'Positive width',
    unit: 's',
    group: 'timing',
    short: 'Duration of the first high pulse, at 50 %.',
    method: 'Time from the first rising edge to the following falling edge, both taken at the 50 % reference level.',
    formula: 't(fall, 50 %) − t(rise, 50 %)',
  },
  {
    key: 'duty',
    label: 'Duty cycle',
    unit: '%',
    group: 'timing',
    short: 'Share of the period the signal is high.',
    method: 'Positive width divided by Period. Needs a complete pulse and at least two rising edges in the range.',
    formula: 'Positive width / Period × 100 %',
  },
]

export const MEASURE_GROUP_LABEL: Record<MeasureGroup, string> = { amplitude: 'Amplitude', timing: 'Timing' }

/** General notes shown with the measurement reference */
export const MEASUREMENT_NOTES: { title: string; text: string }[] = [
  {
    title: 'Measurement range',
    text: 'Measurements use the samples on screen, between the cursors or of the whole record, selected in the measurement bar. Zooming in "On screen" mode therefore changes the result.',
  },
  {
    title: 'Reference levels',
    text: 'Timing measurements use reference levels at 10 %, 50 % and 90 % of the Amplitude, counted from Base to Top. An edge is only counted once the signal has passed both the 10 % and the 90 % level (hysteresis), so noise around one level does not create false edges.',
  },
  {
    title: 'When timing shows “—”',
    text: 'Timing values need clear signal levels. If the range holds no complete edge, too few edges, or only noise (Amplitude below 20 % of Peak-to-peak) the value is not shown. Zoom out or choose “Whole record”.',
  },
]

export function measurementDef(key: MeasurementKey): MeasurementDef {
  return MEASUREMENT_DEFS.find((d) => d.key === key)!
}
