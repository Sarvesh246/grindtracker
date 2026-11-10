import Link from 'next/link'

export default function NotFound() {
  return (
    <main style={{ minHeight: '70dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '24px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '40px', color: 'var(--accent-text)' }}>GRIND</div>
      <p style={{ color: 'var(--text-secondary)' }}>That page could not be found.</p>
      <Link href="/home" className="press" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '48px', padding: '0 28px', borderRadius: '12px', background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }}>GO HOME</Link>
    </main>
  )
}
