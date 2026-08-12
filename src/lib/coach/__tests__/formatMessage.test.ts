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

    const ol = formatCoachMessage(
      'Brace first.\n\n1. Breath in\n2. Press\n3. Exhale',
    )
    assert.equal(ol.length, 2)
    assert.equal(ol[0]!.type, 'paragraph')
    assert.equal(ol[1]!.type, 'list')
    if (ol[1]!.type === 'list') {
      assert.equal(ol[1].ordered, true)
      assert.equal(ol[1].items.length, 3)
    }
  })

  it('parses ### section labels for multi-topic answers', () => {
    const blocks = formatCoachMessage(
      [
        'Overall you’re in a good spot.',
        '',
        '### Strength',
        '- **Bench:** up this month',
        '',
        '### Consistency',
        '11-day streak.',
      ].join('\n'),
    )
    assert.equal(blocks[0]!.type, 'paragraph')
    assert.equal(blocks[1]!.type, 'label')
    if (blocks[1]!.type === 'label') {
      assert.deepEqual(blocks[1].children, [
        { type: 'text', value: 'Strength' },
      ])
    }
    assert.equal(blocks[2]!.type, 'list')
    assert.equal(blocks[3]!.type, 'label')
    assert.equal(blocks[4]!.type, 'paragraph')
  })

  it('promotes a lone bold line to a section label', () => {
    const blocks = formatCoachMessage('**Breathing**\n\nExhale on the press.')
    assert.equal(blocks[0]!.type, 'label')
    if (blocks[0]!.type === 'label') {
      assert.deepEqual(blocks[0].children, [
        { type: 'text', value: 'Breathing' },
      ])
    }
    assert.equal(blocks[1]!.type, 'paragraph')
  })

  it('keeps blank-line paragraphs separate', () => {
    const blocks = formatCoachMessage('Answer first.\n\nThen detail.')
    assert.equal(blocks.length, 2)
    assert.ok(blocks.every(b => b.type === 'paragraph'))
  })

  it('parses GitHub-style pipe tables', () => {
    const blocks = formatCoachMessage(
      [
        'Volume is up.',
        '',
        '| Lift | Last | Best |',
        '| --- | --- | --- |',
        '| Bench | **185** | 195 |',
        '| Squat | 225 | 245 |',
        '',
        'Keep the same weights next session.',
      ].join('\n'),
    )
    assert.equal(blocks[0]!.type, 'paragraph')
    assert.equal(blocks[1]!.type, 'table')
    if (blocks[1]!.type !== 'table') return
    assert.equal(blocks[1].headers.length, 3)
    assert.equal(blocks[1].rows.length, 2)
    assert.equal(blocks[1].rows[0]![1]![0]!.type, 'bold')
    assert.equal(blocks[2]!.type, 'paragraph')
  })
})
