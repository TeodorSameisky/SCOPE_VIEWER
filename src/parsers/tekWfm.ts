import type { Waveform } from '../model/types'

/**
 * Parser for Tektronix binary waveform files (WFM#001 / WFM#002 / WFM#003),
 * as written by TDS/DPO/MSO 5k/7k/70k and the 4/5/6-Series MSOs.
 * Layout reference: Tektronix "Reference Waveform File Format" (077-0220-xx).
 * Only the first frame of a FastFrame acquisition is read.
 */

const FORMAT_READERS: Record<number, { size: number; read: (dv: DataView, o: number, le: boolean) => number }> = {
  0: { size: 2, read: (dv, o, le) => dv.getInt16(o, le) },
  1: { size: 4, read: (dv, o, le) => dv.getInt32(o, le) },
  2: { size: 4, read: (dv, o, le) => dv.getUint32(o, le) },
  4: { size: 4, read: (dv, o, le) => dv.getFloat32(o, le) },
  5: { size: 8, read: (dv, o, le) => dv.getFloat64(o, le) },
  6: { size: 1, read: (dv, o) => dv.getUint8(o) },
  7: { size: 1, read: (dv, o) => dv.getInt8(o) },
}

/** Size of the header, up to the end of the curve information (WFM#001: 2 bytes less) */
const HEADER_SIZE = 0x346

function readString(bytes: Uint8Array, offset: number, len: number): string {
  let end = offset
  while (end < offset + len && bytes[end] !== 0) end++
  return new TextDecoder('latin1').decode(bytes.subarray(offset, end)).trim()
}

export function isTekWfm(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 16) return false
  const sig = new TextDecoder('latin1').decode(new Uint8Array(buf, 2, 8))
  return sig.startsWith(':WFM#00')
}

export function parseTekWfm(buf: ArrayBuffer, id: string): Waveform {
  const bytes = new Uint8Array(buf)
  const dv = new DataView(buf)
  const order = buf.byteLength >= 16 ? dv.getUint16(0, true) : 0
  if (order !== 0x0f0f && order !== 0xf0f0) throw new Error(`${id}: not a Tektronix WFM file`)
  const le = order === 0x0f0f
  const version = readString(bytes, 2, 8)
  const v = parseInt(version.replace(':WFM#', ''), 10)
  if (!(v >= 1 && v <= 3)) throw new Error(`${id}: unsupported WFM version "${version}"`)
  // WFM#001 lacks the 2-byte "summary frame type" field at 0x09a.
  const s = v === 1 ? -2 : 0
  if (buf.byteLength < HEADER_SIZE + s) throw new Error(`${id}: the file ends inside the WFM header`)

  const bytesPerPoint = dv.getUint8(0x00f)
  const curveOffset = dv.getInt32(0x010, le)

  const expDim1 = 0x0a8 + s
  const yScale = dv.getFloat64(expDim1, le)
  const yOffset = dv.getFloat64(expDim1 + 0x08, le)
  const yUnit = readString(bytes, expDim1 + 0x14, 20)
  const format = dv.getInt32(expDim1 + 0x48, le)

  const impDim1 = 0x1e8 + s
  const xScale = dv.getFloat64(impDim1, le)
  const xOffset = dv.getFloat64(impDim1 + 0x08, le)
  const xUnit = readString(bytes, impDim1 + 0x14, 20)

  const curveInfo = 0x332 + s
  const dataStart = dv.getUint32(curveInfo + 0x04, le)
  const postStart = dv.getUint32(curveInfo + 0x08, le)

  const reader = FORMAT_READERS[format]
  if (!reader) throw new Error(`${id}: unsupported sample format ${format}`)
  if (reader.size !== bytesPerPoint) throw new Error(`${id}: inconsistent sample size`)
  if (!(xScale > 0 && Number.isFinite(xScale))) throw new Error(`${id}: invalid sample interval`)
  if (!Number.isFinite(yScale) || !Number.isFinite(yOffset)) throw new Error(`${id}: invalid vertical scale`)
  if (curveOffset < 0 || postStart < dataStart) throw new Error(`${id}: invalid curve offsets`)

  const n = Math.floor((postStart - dataStart) / bytesPerPoint)
  const base = curveOffset + dataStart
  if (!n) throw new Error(`${id}: the waveform has no samples`)
  if (base + n * bytesPerPoint > buf.byteLength) throw new Error(`${id}: truncated waveform data`)

  const data = new Float32Array(n)
  if (format === 0 && le && base % 2 === 0) {
    const raw = new Int16Array(buf, base, n)
    for (let i = 0; i < n; i++) data[i] = raw[i] * yScale + yOffset
  } else {
    for (let i = 0; i < n; i++) data[i] = reader.read(dv, base + i * bytesPerPoint, le) * yScale + yOffset
  }

  return { id, data, t0: xOffset, dt: xScale, yUnit: yUnit || 'V', xUnit: xUnit || 's' }
}
