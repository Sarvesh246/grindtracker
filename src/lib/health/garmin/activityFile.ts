import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'
import { Decoder, Stream } from '@garmin/fitsdk'
import { Buffer } from 'node:buffer'
import { list, number, object } from './normalize'

const MAX_FIT_BYTES = 12 * 1024 * 1024
const MAX_ACTIVITY_POINTS = 1200
const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31

async function extractFit(file: Uint8Array) {
  if (file[0] !== 80 || file[1] !== 75) return Buffer.from(file)
  const zip = new ZipReader(new Uint8ArrayReader(file), { useWebWorkers: false })
  try {
    let entries = 0
    for await (const entry of zip.getEntriesGenerator()) {
      if (++entries > 80) return null
      if (entry.directory || !/\.fit$/i.test(entry.filename)) continue
      if (entry.uncompressedSize > MAX_FIT_BYTES || entry.encrypted) return null
      const chunks: Buffer[] = []
      let size = 0
      await entry.getData(new WritableStream<Uint8Array>({
        write(chunk) {
          size += chunk.byteLength
          if (size > MAX_FIT_BYTES) throw new RangeError('FIT archive exceeds limit')
          chunks.push(Buffer.from(chunk))
        }
      }), { checkSignature: true })
      return Buffer.concat(chunks, size)
    }
    return null
  } finally {
    await zip.close()
  }
}

function thin<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows
  return Array.from({ length: limit }, (_, i) => rows[Math.floor(i * (rows.length - 1) / (limit - 1))])
}

export async function decodeActivityFile(file: Uint8Array, gps: boolean) {
  try {
    const fit = await extractFit(file)
    if (!fit || fit.length > MAX_FIT_BYTES) return null
    const stream = Stream.fromBuffer(fit)
    const decoder = new Decoder(stream)
    if (!decoder.isFIT() || !decoder.checkIntegrity()) return null
    const decoded = decoder.read({ includeUnknownData: false, convertDateTimesToDates: true })
    if (decoded.errors.length) return null
    const messages = object(decoded.messages)
    const records = list(messages.recordMesgs).map(object)
    const trace = thin(records.flatMap(p => {
      const time = p.timestamp instanceof Date ? p.timestamp.getTime() : NaN
      const hr = number(p.heartRate, 20, 250), distance = number(p.distance)
      const altitude = number(p.enhancedAltitude ?? p.altitude, -1000, 12000)
      return Number.isFinite(time) && (hr != null || distance != null || altitude != null)
        ? [{ time, hr, distance, altitude }] : []
    }), MAX_ACTIVITY_POINTS)
    const route = gps ? thin(records.flatMap(p => {
      const lat = number(p.positionLat, -(2 ** 31), 2 ** 31 - 2)
      const lon = number(p.positionLong, -(2 ** 31), 2 ** 31 - 2)
      return lat != null && lon != null && Math.abs(lat * SEMICIRCLE_TO_DEGREES) <= 90
        ? [[lat * SEMICIRCLE_TO_DEGREES, lon * SEMICIRCLE_TO_DEGREES] as [number, number]] : []
    }), 800) : undefined
    const laps = list(messages.lapMesgs).slice(0, 100).map(object).map(lap => ({
      duration_seconds: number(lap.totalTimerTime), distance_m: number(lap.totalDistance),
      ascent_m: number(lap.totalAscent), average_hr: number(lap.avgHeartRate, 20, 250)
    }))
    const sets = list(messages.setMesgs).slice(0, 180).map(object).map(set => ({
      category: list(set.category).filter(v => typeof v === 'string' || typeof v === 'number').slice(0, 4),
      duration_seconds: number(set.duration), reps: number(set.repetitions, 0, 1000),
      weight_kg: number(set.weight, 0, 2000)
    }))
    return { trace, laps, sets, route }
  } catch {
    return null
  }
}
