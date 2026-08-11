'use client'

import type { ReactNode } from 'react'
import {
  formatCoachMessage,
  type CoachInline,
} from '@/lib/coach/formatMessage'

function renderInline(nodes: CoachInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`
    if (node.type === 'text') {
      // Preserve soft line breaks from the parser.
      if (!node.value.includes('\n')) return <span key={key}>{node.value}</span>
      return node.value.split('\n').map((part, j, arr) => (
        <span key={`${key}-${j}`}>
          {part}
          {j < arr.length - 1 ? <br /> : null}
        </span>
      ))
    }
    if (node.type === 'bold') {
      return <strong key={key}>{renderInline(node.children, key)}</strong>
    }
    return <em key={key}>{renderInline(node.children, key)}</em>
  })
}

/**
 * Renders Coach assistant text with light Markdown (bold, lists, paragraphs).
 * User bubbles should stay plain `pre-wrap` text.
 */
export default function CoachMessageContent({ content }: { content: string }) {
  const blocks = formatCoachMessage(content)
  if (!blocks.length) return null

  return (
    <div className="coach-md">
      {blocks.map((block, i) => {
        if (block.type === 'paragraph') {
          return (
            <p key={i} className="coach-md__p">
              {renderInline(block.children, `p${i}`)}
            </p>
          )
        }
        const ListTag = block.ordered ? 'ol' : 'ul'
        return (
          <ListTag key={i} className="coach-md__list">
            {block.items.map((item, j) => (
              <li key={j} className="coach-md__li">
                {renderInline(item, `l${i}-${j}`)}
              </li>
            ))}
          </ListTag>
        )
      })}
    </div>
  )
}
