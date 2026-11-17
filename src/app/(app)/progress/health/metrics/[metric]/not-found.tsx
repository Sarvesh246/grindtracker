import Link from 'next/link'

export default function NotFound() {
  return <section className="page" style={{ padding: '40px 24px 100px', maxWidth: 640, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 400 }}>MEASUREMENT NOT FOUND</h1>
    <p style={{ margin: '16px 0', lineHeight: 1.5, color: 'var(--text-secondary)' }}>That health measurement isn’t available. Choose a recorded measurement from Health.</p>
    <Link href="/progress/health" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, color: 'var(--accent-text)' }}>‹ Back to Health</Link>
  </section>
}
