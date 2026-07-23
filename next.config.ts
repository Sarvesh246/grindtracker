import type { NextConfig } from 'next'

const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    // Build-time placeholder envs (see CLAUDE.md → Building locally) can be
    // non-URLs. Fall back to a wildcard rather than emitting a broken CSP.
    return 'https://*.supabase.co'
  }
})()

// Content-Security-Policy.
//
// 'unsafe-inline' on style-src is unavoidable here: the app styles almost
// everything with inline `style={{ ... }}` props, and Next injects inline
// <style> for the font faces. 'unsafe-inline' on script-src is likewise needed
// for Next's inline bootstrap/hydration payload — removing it requires nonce
// plumbing through a middleware rewrite, which is a bigger change than this
// hardening pass. Even so, locking connect-src/frame-ancestors/object-src is
// the part that actually stops clickjacking and data exfiltration.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://lh3.googleusercontent.com ${supabaseOrigin}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${supabaseOrigin} wss://*.supabase.co`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `manifest-src 'self'`,
  `upgrade-insecure-requests`,
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Belt-and-braces with frame-ancestors, for older browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 2 years, preload-eligible. Vercel terminates TLS, so this is safe.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // The app needs none of these; deny them outright.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  },
  // Keep the origin out of cross-origin process groups.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

const nextConfig: NextConfig = {
  // Don't advertise the framework version to scanners.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
        ],
      },
      {
        // Every route, including the manifest above (headers merge).
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
}

export default nextConfig
