import { BlobReader, ZipReader } from '@zip.js/zip.js'
import {
  buildBatches, GARMIN_EXPORT_FILE, parseGarminExportText, parseGarminHealthStatusText,
  withExportHrv, type ImportedNight,
} from './importers'

export type GarminPreview = {
  found: number
  accepted: number
  skipped: { key: string; reason: string }[]
  batches: ReturnType<typeof buildBatches>['batches']
  recent: ImportedNight[]
  from: string
  to: string
}

export type GarminWorkerMessage =
  | { type: 'progress'; text: string }
  | { type: 'done'; preview: GarminPreview }
  | { type: 'error'; text: string }

const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 32 * 1024 * 1024
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 20_000
const MAX_MATCHES = 400
const MAX_RECORDS = 10_000
const budgetError = 'This export exceeds the import limit. Unzip it on a computer and upload smaller groups of sleep and health-status JSON files.'

export async function inspectGarminExports(
  files: File[], zone: string | undefined, progress: (text: string) => void,
): Promise<GarminPreview> {
  const hrv = new Map<string, number>()
  const nights = new Map<string, ImportedNight>()
  const skipped: GarminPreview['skipped'] = []
  let extracted = 0
  let matches = 0
  let entries = 0
  let records = 0
  if (files.length > MAX_MATCHES || files.reduce((sum, file) => sum + file.size, 0) > MAX_ARCHIVE_BYTES) {
    throw new Error(budgetError)
  }

  function allow(size: number) {
    if (++matches > MAX_MATCHES || size > MAX_ENTRY_BYTES || extracted + size > MAX_EXTRACTED_BYTES) {
      throw new Error(budgetError)
    }
  }

  function parse(name: string, text: string) {
    if (/healthStatusData/i.test(name)) {
      const values = parseGarminHealthStatusText(text)
      records += values.size
      for (const [date, value] of values) hrv.set(date, value)
    } else {
      const parsed = parseGarminExportText(text, { fallbackZone: zone })
      records += parsed.nights.length + parsed.skipped.length
      for (const night of parsed.nights) nights.set(night.provider_id, night)
      skipped.push(...parsed.skipped)
    }
    if (records > MAX_RECORDS) throw new Error(budgetError)
  }

  for (const [index, file] of files.entries()) {
    progress(`Inspecting file ${index + 1} of ${files.length}…`)
    if (!/\.zip$/i.test(file.name)) {
      allow(file.size)
      extracted += file.size
      parse(file.name, await file.text())
      continue
    }
    const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false })
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        if (++entries > MAX_ENTRIES) throw new Error(budgetError)
        if (entry.directory || !GARMIN_EXPORT_FILE.test(entry.filename)) continue
        allow(entry.uncompressedSize)
        progress(`Reading matching file ${matches}…`)
        let written = 0
        const decoded: string[] = []
        const decoder = new TextDecoder()
        await entry.getData(new WritableStream<Uint8Array>({
          write(chunk) {
            written += chunk.byteLength
            extracted += chunk.byteLength
            if (written > MAX_ENTRY_BYTES || extracted > MAX_EXTRACTED_BYTES) throw new Error(budgetError)
            decoded.push(decoder.decode(chunk, { stream: true }))
          },
        }), { checkSignature: true })
        decoded.push(decoder.decode())
        parse(entry.filename, decoded.join(''))
      }
    } finally {
      await reader.close()
    }
  }

  if (!nights.size) {
    throw new Error(matches
      ? 'No sleep nights found. Choose your Garmin sleepData.json files.'
      : 'No sleepData.json file found in that upload.')
  }
  const all = withExportHrv([...nights.values()], hrv).sort((a, b) => a.start_at.localeCompare(b.start_at))
  const built = buildBatches(all, 'garmin_export', new Date())
  return {
    found: all.length, accepted: built.accepted, skipped: [...skipped, ...built.skipped],
    batches: built.batches, recent: all.slice(-5).reverse(), from: all[0].wake_date,
    to: all[all.length - 1].wake_date,
  }
}
