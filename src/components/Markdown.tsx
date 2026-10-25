/**
 * Minimal dark-theme markdown renderer for the legal pages.
 * Supported subset: ## h2, ### h3, paragraphs, "1." numbered lists,
 * "-" bullet lists, **bold** inline. That's all the legal docs use —
 * deliberately tiny so both this and the static generator agree on output.
 */
import { Fragment, type ReactNode } from 'react'

function inline(text: string, keyBase: string): ReactNode[] {
  // **bold** segments
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []

  const flushPara = (key: string) => {
    if (para.length === 0) return
    const content = para.join(' ')
    blocks.push(
      <p key={key} className="text-sm leading-relaxed text-[#C7C7CC]">
        {inline(content, key)}
      </p>,
    )
    para = []
  }
  const flushList = (key: string) => {
    if (!list) return
    const cls = 'ml-5 list-outside space-y-1.5 text-sm leading-relaxed text-[#C7C7CC]'
    const items = list.items.map((item, i) => (
      <li key={`${key}-${i}`}>{inline(item, `${key}-${i}`)}</li>
    ))
    blocks.push(
      list.ordered ? (
        <ol key={key} className={`${cls} list-decimal`}>
          {items}
        </ol>
      ) : (
        <ul key={key} className={`${cls} list-disc marker:text-[#D7FF3F]`}>
          {items}
        </ul>
      ),
    )
    list = null
  }

  lines.forEach((raw, idx) => {
    const line = raw.trim()
    const key = `b${idx}`
    if (line === '') {
      flushPara(key)
      flushList(key)
      return
    }
    if (line.startsWith('### ')) {
      flushPara(key)
      flushList(key)
      blocks.push(
        <h3 key={key} className="text-sm font-semibold text-white">
          {inline(line.slice(4), key)}
        </h3>,
      )
      return
    }
    if (line.startsWith('## ')) {
      flushPara(key)
      flushList(key)
      blocks.push(
        <h2 key={key} className="pt-2 text-base font-semibold text-white">
          {inline(line.slice(3), key)}
        </h2>,
      )
      return
    }
    const ordered = /^(\d+)\.\s+/.exec(line)
    if (ordered) {
      flushPara(key)
      if (!list || !list.ordered) {
        flushList(key)
        list = { ordered: true, items: [] }
      }
      list.items.push(line.slice(ordered[0].length))
      return
    }
    if (line.startsWith('- ')) {
      flushPara(key)
      if (!list || list.ordered) {
        flushList(key)
        list = { ordered: false, items: [] }
      }
      list.items.push(line.slice(2))
      return
    }
    flushList(key)
    para.push(line)
  })
  flushPara('end')
  flushList('end')

  return <div className="space-y-4">{blocks}</div>
}
