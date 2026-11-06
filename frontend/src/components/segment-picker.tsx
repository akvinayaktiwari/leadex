'use client'

import type { IcpSegment } from '@/types'

interface Props {
  segments: IcpSegment[]
  selected: Set<string>
  onToggle: (segmentId: string) => void
}

function buildLabel(count: number): string {
  if (count === 0) return 'Pick segments to build leads'
  return `Build leads for ${count} segment${count === 1 ? '' : 's'}`
}

function SegmentCard({ segment, checked, onToggle }: { segment: IcpSegment; checked: boolean; onToggle: () => void }) {
  return (
    <li className={`card segment${checked ? ' segment-selected' : ''}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={onToggle} /> <strong>{segment.name}</strong>
        <span className="hint"> · about {segment.sharePct}% of buyers</span>
      </label>
      <div className="share" aria-hidden="true"><span style={{ width: `${segment.sharePct}%` }} /></div>
      <p>{segment.useCase}. <span className="hint">Why now: {segment.pain}</span></p>
      <p className="hint">Who decides: {segment.buyerTitles.join(', ')}</p>
      <ul className="criteria">{segment.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
    </li>
  )
}

export function SegmentPicker({ segments, selected, onToggle }: Props) {
  if (segments.length === 0) return null
  return (
    <section className="panel" aria-label="Who buys from you">
      <h2>Who buys from you</h2>
      <ul className="cards">
        {segments.map((segment) => (
          <SegmentCard key={segment.segmentId} segment={segment} checked={selected.has(segment.segmentId)} onToggle={() => onToggle(segment.segmentId)} />
        ))}
      </ul>
      <button type="button" disabled>{buildLabel(selected.size)}</button>
      <p className="hint">Lead builds open with accounts and credits.</p>
    </section>
  )
}
