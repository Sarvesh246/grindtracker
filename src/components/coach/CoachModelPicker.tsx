'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  COACH_AUTO_MODEL,
  COACH_MODEL_GROUPS,
  COACH_MODELS,
  coachModelById,
} from '@/lib/coach/models'
import { useCoach } from './CoachProvider'

type Row = { id: string; label: string; note: string }

const AUTO_ROW: Row = {
  id: COACH_AUTO_MODEL,
  label: 'Auto',
  note: 'Fastest model, switches when one is busy',
}

/** Flat order the arrow keys walk: Auto, then each group in menu order. */
const ROWS: Row[] = [
  AUTO_ROW,
  ...COACH_MODEL_GROUPS.flatMap(g => COACH_MODELS.filter(m => m.group === g.id)),
]

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * Model pill + upward menu above the Coach composer. The menu stays mounted
 * (`data-open` drives a CSS transition, `inert` while closed) so it can
 * animate out, and html.reduce-motion zeroes it like every other transition.
 */
export function CoachModelPicker() {
  const { model, setModel, servedBy, streaming } = useCoach()
  const [menuOpen, setOpen] = useState(false)
  // A send closes the menu (the model is locked while a reply streams).
  const open = menuOpen && !streaming
  const [active, setActive] = useState(0)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const current = coachModelById(model)
  const triggerLabel = current ? current.short : 'Auto'
  const fellBack = servedBy ? coachModelById(servedBy.model) : undefined
  const fellFrom = servedBy ? coachModelById(servedBy.from) : undefined

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = itemRefs.current[active]
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openMenu = () => {
    const i = ROWS.findIndex(r => r.id === model)
    setActive(i < 0 ? 0 : i)
    // The sheet clips overflow, so the menu may only use the room between the
    // sheet's top edge and the pill (the compact card can be short).
    const trigger = triggerRef.current
    const sheet = trigger?.closest('.coach-sheet')
    if (trigger && sheet) {
      const room =
        trigger.getBoundingClientRect().top - sheet.getBoundingClientRect().top - 22
      setMaxHeight(Math.max(160, Math.min(420, Math.floor(room))))
    }
    setOpen(true)
  }

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }

  const choose = (id: string) => {
    setModel(id)
    close(true)
  }

  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Close just the menu — the sheet's window-level Escape would
      // otherwise dismiss the whole Coach on the same key press.
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1) % ROWS.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i - 1 + ROWS.length) % ROWS.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(ROWS.length - 1)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  const renderRow = (row: Row) => {
    const index = ROWS.indexOf(row)
    const selected = row.id === model
    return (
      <button
        key={row.id}
        ref={el => {
          itemRefs.current[index] = el
        }}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        tabIndex={index === active ? 0 : -1}
        className={`coach-model__item${selected ? ' is-selected' : ''}`}
        onClick={() => choose(row.id)}
        onPointerMove={() => setActive(index)}
      >
        <span className="coach-model__item-text">
          <span className="coach-model__item-label">{row.label}</span>
          <span className="coach-model__item-note">{row.note}</span>
        </span>
        <span className="coach-model__check">{selected ? <Check /> : null}</span>
      </button>
    )
  }

  const status =
    fellBack && fellFrom
      ? `Answered by ${fellBack.short} · ${fellFrom.short} was busy`
      : current
        ? current.note
        : AUTO_ROW.note

  return (
    <div className="coach-model" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="coach-model__trigger press"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Coach model: ${current ? current.label : 'Auto'}`}
        disabled={streaming}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={e => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            openMenu()
          }
        }}
      >
        <svg className="coach-model__spark" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" />
        </svg>
        <span key={triggerLabel} className="coach-model__value">
          {triggerLabel}
        </span>
        <svg className="coach-model__chev" width="10" height="10" viewBox="0 0 10 6" fill="none" aria-hidden>
          <path d="M1 5l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <span
        key={status}
        className={`coach-model__status${fellBack ? ' is-fallback' : ''}`}
        aria-live="polite"
      >
        {status}
      </span>

      <div
        id={menuId}
        role="menu"
        aria-label="Choose Coach model"
        className="coach-model__menu"
        data-open={open}
        inert={!open}
        onKeyDown={onMenuKey}
      >
        <div
          className="coach-model__scroll scrollbar-hide"
          style={maxHeight ? { maxHeight } : undefined}
        >
          {renderRow(AUTO_ROW)}
          {COACH_MODEL_GROUPS.map(g => {
            const rows = COACH_MODELS.filter(m => m.group === g.id)
            if (!rows.length) return null
            return (
              <div key={g.id} role="group" aria-label={g.label}>
                <div className="coach-model__group" aria-hidden>
                  {g.label}
                </div>
                {rows.map(renderRow)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
