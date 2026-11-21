type Page<T> = { data: T[] | null; count: number | null; error: unknown }

/** Fetch a stably ordered result, even if the API caps a page below 500 rows. */
export async function exportPages<T>(read: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = []
  let expected: number | null = null
  do {
    const { data, count, error } = await read(rows.length, rows.length + 499)
    if (error) throw error
    if (!data || count === null || (expected !== null && count !== expected)) {
      throw new Error('Export row count changed during download')
    }
    expected = count
    rows.push(...data)
    if (rows.length > expected || (rows.length < expected && data.length === 0)) {
      throw new Error('Export row count does not match the downloaded data')
    }
  } while (rows.length < expected)
  return rows
}
