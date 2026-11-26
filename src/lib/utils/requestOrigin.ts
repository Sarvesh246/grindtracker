const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Next can use its listening address for Request.url. The browser uses Host. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get('host')
  const forwardedProtocol = request.headers.get('x-forwarded-proto')
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https' ? forwardedProtocol : url.protocol.slice(0, -1)
  if (!host || !/^[\w.:[\]-]+$/.test(host)) return url.origin
  return URL.parse(`${protocol}://${host}`)?.origin ?? url.origin
}

export function isCrossOriginMutation(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false
  const caller = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  return (caller !== null && caller !== requestOrigin(request)) || site === 'same-site' || site === 'cross-site'
}
