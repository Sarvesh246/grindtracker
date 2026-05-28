import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GRIND',
  description: 'Track your gym progress',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#0f0f0f" />
      </head>
      <body>{children}</body>
    </html>
  )
}
