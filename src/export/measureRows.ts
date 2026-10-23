import { measure, type MeasurementKey, type Measurements } from '../dsp/measure'
import { formatMeasurement, measurementDef } from '../dsp/measureDefs'
import { channelName } from '../util/names'
import { sampleRange, type CursorState, type LiveChannel, type MeasureRange, type TimeWindow } from '../model/view'

export interface MeasuredChannel {
  channel: LiveChannel
  m: Measurements
}

/** Measurements of the visible channels over a range, as the measurement table shows them */
export function measureChannels(channels: LiveChannel[], range: MeasureRange, win: TimeWindow, cursors: CursorState): MeasuredChannel[] {
  return channels
    .filter((c) => c.display.visible)
    .map((channel) => {
      const [i0, i1] = sampleRange(channel.wave, range, win, cursors)
      return { channel, m: measure(channel.wave.data, i0, i1, channel.wave.t0, channel.wave.dt) }
    })
}

/** Table rows (name + formatted values) for images and reports */
export function measurementTable(rows: MeasuredChannel[], keys: MeasurementKey[]) {
  return {
    columns: ['Channel', ...keys.map((k) => measurementDef(k).label)],
    rows: rows.map(({ channel, m }) => ({
      color: channel.display.color,
      cells: [
        `${channelName(channel.wave.id)}${channel.display.label ? ` ${channel.display.label}` : ''}`,
        ...keys.map((k) => formatMeasurement(k, m[k], channel.wave.yUnit)),
      ],
    })),
  }
}
