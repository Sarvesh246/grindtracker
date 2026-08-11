/**
 * Lightweight Markdown subset for Coach replies.
 * Supports paragraphs, soft line breaks, unordered/ordered lists, **bold**, *italic*.
 * Pure + XSS-safe when rendered as React text nodes (no HTML passthrough).
 */

export type CoachInline =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: CoachInline[] }
  | { type: 'italic'; children: CoachInline[] }

export type CoachBlock =
  | { type: 'paragraph'; children: CoachInline[] }
  | { type: 'list'; ordered: boolean; items: CoachInline[][] }

export type CoachFormattedMessage = CoachBlock[]

const UL_RE = /^\s*[-*•]\s+(.+)$/
const OL_RE = /^\s*\d+[.)]\s+(.+)$/

function parseInline(input: string): CoachInline[] {
  const out: CoachInline[] = []
  let i = 0

  const pushText = (value: string) => {
    if (!value) return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.value += value
    else out.push({ type: 'text', value })
  }

  while (i < input.length) {
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2)
      if (end !== -1) {
        const inner = input.slice(i + 2, end)
        if (inner) out.push({ type: 'bold', children: parseInline(inner) })
        i = end + 2
        continue
      }
    }

    // Single-asterisk italic — avoid treating "**" or list leftovers as italic.
    if (
      input[i] === '*' &&
      input[i + 1] !== '*' &&
      input[i + 1] !== undefined
    ) {
      const end = input.indexOf('*', i + 1)
      if (end !== -1 && input[end + 1] !== '*') {
        const inner = input.slice(i + 1, end)
        if (inner && !inner.includes('\n')) {
          out.push({ type: 'italic', children: parseInline(inner) })
          i = end + 1
          continue
        }
      }
    }

    if (input[i] === '_' && input[i + 1] !== '_') {
      const end = input.indexOf('_', i + 1)
      if (end !== -1) {
        const inner = input.slice(i + 1, end)
        if (inner && !/\s/.test(inner[0]!) && !/\s/.test(inner[inner.length - 1]!)) {
          out.push({ type: 'italic', children: parseInline(inner) })
          i = end + 1
          continue
        }
      }
    }

    pushText(input[i]!)
    i += 1
  }

  return out
}

/** Split paragraph text on soft newlines into inline runs joined by line breaks. */
function parseParagraphLines(lines: string[]): CoachInline[] {
  const children: CoachInline[] = []
  lines.forEach((line, idx) => {
    if (idx > 0) children.push({ type: 'text', value: '\n' })
    children.push(...parseInline(line))
  })
  return children
}

function matchListLine(
  line: string,
): { ordered: boolean; content: string } | null {
  const ul = line.match(UL_RE)
  if (ul) return { ordered: false, content: ul[1]! }
  const ol = line.match(OL_RE)
  if (ol) return { ordered: true, content: ol[1]! }
  return null
}

/**
 * Parse Coach assistant text into structured blocks for readable rendering.
 */
export function formatCoachMessage(raw: string): CoachFormattedMessage {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!text) return []

  const lines = text.split('\n')
  const blocks: CoachBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    if (!line.trim()) {
      i += 1
      continue
    }

    const listHit = matchListLine(line)
    if (listHit) {
      const ordered = listHit.ordered
      const items: CoachInline[][] = []
      while (i < lines.length) {
        const cur = lines[i]!
        if (!cur.trim()) break
        const hit = matchListLine(cur)
        if (!hit || hit.ordered !== ordered) break
        items.push(parseInline(hit.content.trim()))
        i += 1
      }
      if (items.length) blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const cur = lines[i]!
      if (!cur.trim()) break
      if (matchListLine(cur)) break
      paraLines.push(cur.trimEnd())
      i += 1
    }
    if (paraLines.length) {
      blocks.push({
        type: 'paragraph',
        children: parseParagraphLines(paraLines),
      })
    }
  }

  return blocks
}
