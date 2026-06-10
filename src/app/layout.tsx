import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { ThemeProvider, type Theme } from '@/lib/contexts/ThemeContext'
import './globals.css'

export const metadata: Metadata = {
  title: 'GRIND',
  description: 'Track your gym progress',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GRIND',
  },
}

// Resolve the initial theme from the cookie (default dark) so the SSR'd <html>
// class and the browser-chrome color match the user's saved preference — no flash.
async function getInitialTheme(): Promise<Theme> {
  const pref = (await cookies()).get('grind_theme_pref')?.value
  return pref === 'light' ? 'light' : 'dark'
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await getInitialTheme()
  return {
    width: 'device-width',
    initialScale: 1,
    // Lock zoom. Once iOS zooms the page (pinch, double-tap, or auto-zoom on
    // focusing an input with font-size < 16px), position:fixed elements pin to
    // the layout viewport and drift on every scroll — detaching the bottom
    // bars on the active workout page. App-style PWA, so no zoom is expected.
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
    themeColor: theme === 'light' ? '#ecebe7' : '#0f0f0f',
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getInitialTheme()

  return (
    <html lang="en" className={theme === 'light' ? 'light' : undefined}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  )
}
