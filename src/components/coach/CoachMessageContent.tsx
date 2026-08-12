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
 * Renders Coach assistant text with light Markdown
 * (bold, lists, labels, titles, exercise stacks, tables).
 * User bubbles should stay plain `pre-wrap` text.
 */
export default function CoachMessageContent({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const blocks = formatCoachMessage(content)
  if (!blocks.length) return null

  return (
    <div className={['coach-md', className].filter(Boolean).join(' ')}>
      {blocks.map((block, i) => {
        if (block.type === 'paragraph') {
          return (
            <p key={i} className="coach-md__p">
              {renderInline(block.children, `p${i}`)}
            </p>
          )
        }
        if (block.type === 'label') {
          return (
            <p key={i} className="coach-md__label">
              {renderInline(block.children, `h${i}`)}
            </p>
          )
        }
        if (block.type === 'title') {
          return (
            <p key={i} className="coach-md__title">
              {renderInline(block.children, `t${i}`)}
            </p>
          )
        }
        if (block.type === 'stack') {
          return (
            <div key={i} className="coach-md__stack">
              <p className="coach-md__title">
                {renderInline(block.title, `st${i}`)}
              </p>
              <p className="coach-md__stack-body">
                {renderInline(block.body, `sb${i}`)}
              </p>
            </div>
          )
        }
        if (block.type === 'table') {
          return (
            <div key={i} className="coach-md__table-wrap">
              <table className="coach-md__table">
                <thead>
                  <tr>
                    {block.headers.map((cell, j) => (
                      <th key={j} className="coach-md__th">
                        {renderInline(cell, `th${i}-${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="coach-md__td">
                          {renderInline(cell, `td${i}-${r}-${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        const ListTag = block.ordered ? 'ol' : 'ul'
        return (
          <ListTag
            key={i}
            className={`coach-md__list${
              block.ordered ? ' coach-md__list--ordered' : ''
            }`}
          >
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
