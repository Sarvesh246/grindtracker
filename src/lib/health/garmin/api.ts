import { Buffer } from 'node:buffer'

const origin = 'https://personal.connectapi.garmin.com'
const tokenPath = '/personalapitoken-service/personal-api/personal-api-key/token'
const MAX_JSON = 2 * 1024 * 1024
const MAX_ACTIVITY = 8 * 1024 * 1024

export class GarminApiError extends Error {
  constructor(readonly code: 'credentials' | 'rate_limit' | 'upstream' | 'response', readonly retryAt?: number) {
    super(code)
  }
}

function retryAfter(header: string | null) {
  if (!header) return
  return /^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : Date.parse(header) || undefined
}

async function readBytes(response: Response, max: number) {
  if (!response.body || Number(response.headers.get('content-length')) > max)
    throw new GarminApiError('response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) throw new GarminApiError('response')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks, size)
}

async function json(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 404) return null
  try {
    return JSON.parse((await readBytes(response, MAX_JSON)).toString('utf8'))
  } catch (error) {
    if (error instanceof GarminApiError) throw error
    throw new GarminApiError('response')
  }
}

type Fetch = typeof fetch

export function garminApi(key: string, request: Fetch = fetch, deadline?: AbortSignal) {
  let access: Promise<{ value: string; expires: number }> | undefined

  async function send(path: string, authorization: string, method = 'GET') {
    const url = new URL(path, origin)
    if (url.origin !== origin) throw new GarminApiError('response')
    try {
      const timeout = AbortSignal.timeout(8_000)
      return await request(url, {
        method, headers: { Authorization: authorization }, redirect: 'error', cache: 'no-store',
        signal: deadline ? AbortSignal.any([timeout, deadline]) : timeout
      })
    } catch {
      throw new GarminApiError('upstream')
    }
  }

  function check(response: Response, allowMissing = false) {
    if (response.ok || (allowMissing && response.status === 404)) return response
    void response.body?.cancel().catch(() => {})
    if (response.status === 401 || response.status === 403) throw new GarminApiError('credentials')
    if (response.status === 429) throw new GarminApiError('rate_limit', retryAfter(response.headers.get('retry-after')))
    throw new GarminApiError('upstream')
  }

  async function exchange() {
    // Garmin's token endpoint responds with a raw JWT and rejects application/json.
    const response = check(await send(tokenPath, 'ApiKey ' + key, 'POST'))
    const value = (await readBytes(response, 16 * 1024)).toString('utf8').trim()
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) throw new GarminApiError('response')
    let expires: number
    try {
      const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'))
      expires = Number(claims.exp) * 1000
    } catch {
      throw new GarminApiError('response')
    }
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new GarminApiError('credentials')
    return { value, expires }
  }

  async function getToken() {
    const previous = access
    if (previous && (await previous).expires <= Date.now() + 60_000 && access === previous)
      access = undefined
    access ??= exchange()
    const current = access
    try {
      return (await current).value
    } catch (error) {
      if (access === current) access = undefined
      throw error
    }
  }

  async function get(path: string, parameters?: Record<string, string>) {
    const search = parameters ? '?' + new URLSearchParams(parameters) : ''
    const token = await getToken()
    let response = await send(path + search, 'Bearer ' + token)
    if (response.status === 401) {
      await response.body?.cancel()
      if (access && (await access).value === token) access = undefined
      response = await send(path + search, 'Bearer ' + await getToken())
    }
    return check(response, true)
  }

  return {
    async get(path: string, parameters?: Record<string, string>) {
      return json(await get(path, parameters))
    },
    async activityFile(id: string) {
      const response = await get('/download-service/files/activity/' + encodeURIComponent(id))
      return response.status === 404 || response.status === 204 ? null : readBytes(response, MAX_ACTIVITY)
    }
  }
}

export type GarminApi = ReturnType<typeof garminApi>
