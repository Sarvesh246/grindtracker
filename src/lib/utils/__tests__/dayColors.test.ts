import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NAMED_DAY_COLORS,
  NAMED_DAY_COLORS_LIGHT,
  calendarCellBackground,
  joinDayTypes,
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
