/**
 * Lightweight Markdown subset for Coach replies.
 * Supports paragraphs, soft line breaks, unordered/ordered lists,
 * ### section labels, **title** lines / exercise stacks, GitHub-style
 * pipe tables, **bold**, *italic*.
 * Pure + XSS-safe when rendered as React text nodes (no HTML passthrough).
 */

export type CoachInline =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: CoachInline[] }
  | { type: 'italic'; children: CoachInline[] }

export type CoachBlock =
  | { type: 'paragraph'; children: CoachInline[] }
  /** ### Section — small eyebrow label. */
  | { type: 'label'; children: CoachInline[] }
  /** Lone **Name** or leading bold line — larger skim title (exercise, PR, etc.). */
  | { type: 'title'; children: CoachInline[] }
  /**
   * Workout-style block: bold name + soft-break detail lines
   * (sets×reps / Target / Rest).
   */
  | { type: 'stack'; title: CoachInline[]; body: CoachInline[] }
  | { type: 'list'; ordered: boolean; items: CoachInline[][] }
  | {
      type: 'table'
      headers: CoachInline[][]
      rows: CoachInline[][][]
    }

export type CoachFormattedMessage = CoachBlock[]

const UL_RE = /^\s*[-*•]\s+(.+)$/
const OL_RE = /^\s*\d+[.)]\s+(.+)$/
const LABEL_RE = /^\s*#{2,3}\s+(.+?)\s*$/

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
        // Don't bold across line breaks — treat as per-line markers.
        if (inner && !inner.includes('\n')) {
          out.push({ type: 'bold', children: parseInline(inner) })
          i = end + 2
          continue
        }
      }
      // Unclosed or cross-line ** — bold to end of this line, drop the markers
      // so leftover asterisks never show in the bubble.
      const nl = input.indexOf('\n', i + 2)
      const endLine = nl === -1 ? input.length : nl
      const inner = input.slice(i + 2, endLine).replace(/\*+$/, '')
      if (inner.trim()) {
        out.push({ type: 'bold', children: parseInline(inner) })
      }
      i = endLine
      continue
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
        if (inner && !inner.includes('\n') && !/^\s|\s$/.test(inner)) {
          out.push({ type: 'italic', children: parseInline(inner) })
          i = end + 1
          continue
        }
      }
      // Orphan "*" — skip it (common model junk) instead of painting it.
      i += 1
      continue
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

function matchLabelLine(line: string): string | null {
  const hit = line.match(LABEL_RE)
  return hit ? hit[1]!.trim() : null
}

/** GFM pipe row cells, or null if not a data row. */
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  if (isTableSeparator(trimmed)) return null

  let body = trimmed
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  const cells = body.split('|').map(c => c.trim())
  if (cells.length < 2) return null
  return cells
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(trimmed)
}

function boldTextLength(children: CoachInline[]): number {
  return children
    .map(c => (c.type === 'text' ? c.value : ''))
    .join('')
    .trim().length
}

/** Lone **Title** line → skim title (exercise name, PR callout). */
function asTitleOnly(children: CoachInline[]): CoachInline[] | null {
  if (children.length !== 1) return null
  const only = children[0]!
  if (only.type !== 'bold') return null
  const len = boldTextLength(only.children)
  if (!len || len > 80) return null
  return only.children
}

/**
 * **Exercise** + soft-break detail lines → stack with larger title + muted body.
 */
function asTitleStack(
  children: CoachInline[],
): { title: CoachInline[]; body: CoachInline[] } | null {
  if (children[0]?.type !== 'bold') return null
  const titleNode = children[0]
  const len = boldTextLength(titleNode.children)
  if (!len || len > 80) return null

  const second = children[1]
  if (!second || second.type !== 'text' || !second.value.startsWith('\n')) {
    return null
  }

  const body: CoachInline[] = []
  const after = second.value.replace(/^\n+/, '')
  if (after) body.push({ type: 'text', value: after })
  body.push(...children.slice(2))
  if (!body.length) return null
  return { title: titleNode.children, body }
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

    const labelText = matchLabelLine(line)
    if (labelText) {
      blocks.push({ type: 'label', children: parseInline(labelText) })
      i += 1
      continue
    }

    // Pipe table: header + separator + ≥1 body row
    const headerCells = parseTableRow(line)
    if (
      headerCells &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]!)
    ) {
      const headers = headerCells.map(c => parseInline(c))
      const rows: CoachInline[][][] = []
      i += 2
      while (i < lines.length) {
        const cur = lines[i]!
        if (!cur.trim()) break
        if (matchLabelLine(cur) || matchListLine(cur)) break
        const cells = parseTableRow(cur)
        if (!cells) break
        const normalized = headerCells.map((_, idx) => cells[idx] ?? '')
        rows.push(normalized.map(c => parseInline(c)))
        i += 1
      }
      if (rows.length) {
        blocks.push({ type: 'table', headers, rows })
        continue
      }
      i -= 2
    }

    const listHit = matchListLine(line)
    if (listHit) {
      const ordered = listHit.ordered
      const items: CoachInline[][] = []
      while (i < lines.length) {
        const cur = lines[i]!
        if (!cur.trim()) break
        if (matchLabelLine(cur)) break
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
      if (matchListLine(cur) || matchLabelLine(cur)) break
      if (
        parseTableRow(cur) &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1]!)
      ) {
        break
      }
      paraLines.push(cur.trimEnd())
      i += 1
    }
    if (paraLines.length) {
      const children = parseParagraphLines(paraLines)
      if (paraLines.length === 1) {
        const title = asTitleOnly(children)
        if (title) {
          blocks.push({ type: 'title', children: title })
          continue
        }
      }
      const stack = asTitleStack(children)
      if (stack) {
        blocks.push({ type: 'stack', title: stack.title, body: stack.body })
        continue
      }
      blocks.push({ type: 'paragraph', children })
    }
  }

  return blocks
}
