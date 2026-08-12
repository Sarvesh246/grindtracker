import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COACH_STRESS_CATALOG,
  COACH_STRESS_CATEGORIES,
} from '../stressCatalog'
import { COACH_SYSTEM_PROMPT } from '../prompt'

describe('COACH_STRESS_CATALOG', () => {
  it('covers every required category with at least one case', () => {
    const present = new Set(COACH_STRESS_CATALOG.map(c => c.category))
    for (const cat of COACH_STRESS_CATEGORIES) {
      assert.ok(present.has(cat), `missing category ${cat}`)
    }
  })

  it('has unique case ids', () => {
    const ids = COACH_STRESS_CATALOG.map(c => c.id)
    assert.equal(ids.length, new Set(ids).size)
  })

  it('marks pure definitions as personalization-unnecessary', () => {
    const facts = COACH_STRESS_CATALOG.filter(c => c.category === 'simple_factual')
    assert.ok(facts.length >= 2)
    for (const c of facts) {
      assert.equal(c.personalization, 'unnecessary', c.id)
      assert.ok(
        c.mustNot.some(m => /personal|logging|PR|volume/i.test(m)),
        `${c.id} should forbid unneeded personalization`,
      )
    }
  })

  it('requires decision-first shape for recommendation asks', () => {
    const recs = COACH_STRESS_CATALOG.filter(
      c => c.category === 'direct_recommendation',
    )
    assert.ok(recs.length >= 2)
    for (const c of recs) {
      assert.equal(c.format, 'decision_first', c.id)
    }
  })

  it('requires safety_first for injury/symptom cases', () => {
    const safety = COACH_STRESS_CATALOG.filter(c => c.category === 'safety')
    assert.ok(safety.length >= 2)
    for (const c of safety) {
      assert.equal(c.format, 'safety_first', c.id)
      assert.ok(c.must.some(m => /not.*push|stop|safety|no diagnosis/i.test(m)))
    }
  })

  it('requires exact-three shape for the holding-me-back case', () => {
    const hit = COACH_STRESS_CATALOG.find(c => c.id === 'progress-three-things')
    assert.ok(hit)
    assert.ok(hit!.must.some(m => /exactly three/i.test(m)))
  })

  it('aligns catalog intents with system-prompt root rules', () => {
    // Catalog is useless if the prompt no longer encodes the same principles.
    const anchors = [
      /Personalization: required \/ useful \/ unnecessary/i,
      /Output-shape following/i,
      /Evidence vs interpretation/i,
      /Safety \(overrides performance\)/i,
      /Decision → brief reason → fallback/i,
      /do not dump every metric/i,
      /Internal\/database jargon/i,
    ]
    for (const pattern of anchors) {
      assert.match(COACH_SYSTEM_PROMPT, pattern)
    }
  })
})
