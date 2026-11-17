import Link from 'next/link'
import { ChevronLeft } from '@/components/ui/Icons'

export default function NotFound() {
  return <section className="page" style={{ padding: '40px 24px 100px', maxWidth: 640, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 400 }}>MEASUREMENT NOT FOUND</h1>
    <p style={{ margin: '16px 0', lineHeight: 1.5, color: 'var(--text-secondary)' }}>Nothing recorded for this one yet.</p>
    <Link href="/progress/health" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, color: 'var(--accent-text)' }}><ChevronLeft size={14} />Health</Link>
  </section>
}
