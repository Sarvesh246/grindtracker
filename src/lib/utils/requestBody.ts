/** Enforce the byte limit even when the request has no Content-Length. */
export async function readBodyText(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) return { ok: false }
  const reader = request.body?.getReader()
  if (!reader) return { ok: true, text: '' }
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      void reader.cancel().catch(() => {})
      return { ok: false }
    }
    chunks.push(value)
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const body = await readBodyText(request, maxBytes)
  if (!body.ok) throw new RangeError('Request body is too large')
  return JSON.parse(body.text)
}
