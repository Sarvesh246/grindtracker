import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatCoachMessage } from '../formatMessage'

describe('formatCoachMessage', () => {
  it('renders bold labels without leftover asterisks', () => {
    const blocks = formatCoachMessage('You have **11 days** of streak.')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0]!.type, 'paragraph')
    if (blocks[0]!.type !== 'paragraph') return
    assert.deepEqual(blocks[0].children, [
      { type: 'text', value: 'You have ' },
      { type: 'bold', children: [{ type: 'text', value: '11 days' }] },
      { type: 'text', value: ' of streak.' },
    ])
  })

  it('splits star bullets into a list even without blank lines', () => {
    const raw = [
      'Yes, you are making solid progress. Key signs:',
      '* **Consistency:** 11-day streak.',
      '* **Recent PRs:** Incline Dumbbell Press.',
      '* **Body Weight:** Up to 160.1 lbs.',
      'Keep logging your sessions.',
    ].join('\n')

    const blocks = formatCoachMessage(raw)
    assert.equal(blocks.length, 3)
    assert.equal(blocks[0]!.type, 'paragraph')
    assert.equal(blocks[1]!.type, 'list')
    assert.equal(blocks[2]!.type, 'paragraph')

    if (blocks[1]!.type !== 'list') return
    assert.equal(blocks[1].ordered, false)
    assert.equal(blocks[1].items.length, 3)
    assert.equal(blocks[1].items[0]![0]!.type, 'bold')
    if (blocks[1].items[0]![0]!.type === 'bold') {
      assert.deepEqual(blocks[1].items[0]![0].children, [
        { type: 'text', value: 'Consistency:' },
      ])
    }
  })

  it('supports dash bullets and numbered lists', () => {
    const ul = formatCoachMessage('- One\n- Two')
    assert.equal(ul[0]!.type, 'list')
    if (ul[0]!.type === 'list') {
      assert.equal(ul[0].ordered, false)
      assert.equal(ul[0].items.length, 2)
    }

    const ol = formatCoachMessage('1. First\n2. Second')
    assert.equal(ol[0]!.type, 'list')
    if (ol[0]!.type === 'list') {
      assert.equal(ol[0].ordered, true)
      assert.equal(ol[0].items.length, 2)
    }
  })

  it('keeps blank-line paragraphs separate', () => {
    const blocks = formatCoachMessage('Answer first.\n\nThen detail.')
    assert.equal(blocks.length, 2)
    assert.ok(blocks.every(b => b.type === 'paragraph'))
  })
})
