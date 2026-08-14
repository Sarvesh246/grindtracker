import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NAMED_DAY_COLORS,
  NAMED_DAY_COLORS_LIGHT,
  DAY_COLOR_PRESETS,
  calendarCellBackground,
  categoryColorKey,
  joinDayTypes,
  mapDayColorRows,
  normalizeDayColor,
  onDayFill,
  resolveDayColor,
  resolveDayTextColor,
} from '../dayColors'

describe('dayColors', () => {
  it('uses neon fills in dark mode and mid-tones in light', () => {
    assert.equal(resolveDayColor('push', []), NAMED_DAY_COLORS.push)
    assert.equal(resolveDayColor('push', [], true), NAMED_DAY_COLORS_LIGHT.push)
    assert.notEqual(NAMED_DAY_COLORS.push, NAMED_DAY_COLORS_LIGHT.push)
  })

  it('darkens light-mode label text vs fill', () => {
    const fill = resolveDayColor('push', [], true)
    const text = resolveDayTextColor('push', [], true)
    assert.notEqual(fill, text)
    // Deep olive should be darker (lower luminance) than mid olive fill.
    assert.ok(text < fill)
  })

  it('maps custom types from the light extra pool', () => {
    const extras = ['abs', 'cardio']
    assert.equal(resolveDayColor('abs', extras, true), '#7c3aed')
    assert.equal(resolveDayColor('cardio', extras, true), '#db2777')
  })

  it('lets a custom hex override the derived palette', () => {
    assert.equal(resolveDayColor('push', [], false, '#818cf8'), '#818cf8')
    assert.equal(resolveDayColor('push', [], false, '  #ABC '), '#aabbcc')
    // Invalid / missing custom falls back.
    assert.equal(resolveDayColor('push', [], false, 'red'), NAMED_DAY_COLORS.push)
    assert.equal(resolveDayColor('push', [], false, null), NAMED_DAY_COLORS.push)
  })

  it('darkens a custom hex in light mode so it still reads as text', () => {
    const fill = resolveDayColor('push', [], true, '#c8f135')
    const text = resolveDayTextColor('push', [], true, '#c8f135')
    assert.notEqual(fill, '#c8f135')
    assert.notEqual(text, fill)
    assert.ok(text < fill)
  })
})

describe('normalizeDayColor / presets', () => {
  it('accepts 3-digit and 6-digit hex', () => {
    assert.equal(normalizeDayColor('#AbC'), '#aabbcc')
    assert.equal(normalizeDayColor('#C8F135'), '#c8f135')
    assert.equal(normalizeDayColor('nope'), null)
  })

  it('includes named-day hues in the picker presets', () => {
    assert.ok(DAY_COLOR_PRESETS.includes(NAMED_DAY_COLORS.push))
    assert.ok(DAY_COLOR_PRESETS.includes(NAMED_DAY_COLORS.pull))
    assert.ok(DAY_COLOR_PRESETS.includes(NAMED_DAY_COLORS.legs))
  })

  it('maps color rows and ignores junk', () => {
    const map = mapDayColorRows([
      { day_key: 'push', color: '#38BDF8' },
      { day_key: 'abs', color: 'nope' },
    ])
    assert.deepEqual(map, { push: '#38bdf8' })
  })

  it('picks dark text on light fills and light text on dark fills', () => {
    assert.equal(onDayFill('#c8f135'), '#0f0f0f')
    assert.equal(onDayFill('#1e3a8a'), '#f0f0f0')
  })

  it('uses leaderboard category as the default color key', () => {
    assert.equal(categoryColorKey('chest', { chest: 'push' }), 'push')
    assert.equal(categoryColorKey('push', {}), 'push')
    assert.equal(categoryColorKey('abs', {}), 'other')
  })
})

describe('calendarCellBackground', () => {
  it('is a flat tint for a single day', () => {
    const bg = calendarCellBackground(['#38bdf8'], false)
    assert.equal(bg.startsWith('linear-gradient'), false)
    assert.ok(bg.startsWith('#38bdf8'))
  })

  it('splits two days on a diagonal instead of a muddy smear', () => {
    const bg = calendarCellBackground(['#38bdf8', '#a78bfa'], false)
    assert.ok(bg.startsWith('linear-gradient(135deg'))
    assert.ok(bg.includes('#38bdf8'))
    assert.ok(bg.includes('#a78bfa'))
  })
})

describe('joinDayTypes', () => {
  it('joins two and three day names', () => {
    assert.equal(joinDayTypes(['pull', 'abs']), 'pull and abs')
    assert.equal(joinDayTypes(['push', 'pull', 'abs']), 'push, pull, and abs')
  })
})
