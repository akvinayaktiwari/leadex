'use client'

import type { IcpSegment } from '@/types'
import { BUTTON_PRIMARY, CARD } from './ui/styles'

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
    <li className={`rounded-xl border p-4 transition-colors ${checked ? 'border-violet-300 bg-violet-50/50' : 'border-gray-100 bg-gray-50/60'}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 h-4 w-4 accent-violet-600" />
        <span>
          <strong className="font-display text-gray-900">{segment.name}</strong>
          <span className="text-sm text-gray-500"> · about {segment.sharePct}% of buyers</span>
        </span>
      </label>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <div className="h-full rounded-full bg-linear-to-r from-primary to-primary-container" style={{ width: `${segment.sharePct}%` }} />
      </div>
      <p className="mt-3 text-sm text-gray-800">{segment.useCase}. <span className="text-gray-500">Why now: {segment.pain}</span></p>
      <p className="mt-1 text-sm text-gray-500">Who decides: {segment.buyerTitles.join(', ')}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {segment.criteria.map((criterion) => <li key={criterion} className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-600">{criterion}</li>)}
      </ul>
    </li>
  )
}

export function SegmentPicker({ segments, selected, onToggle }: Props) {
  if (segments.length === 0) return null
  return (
    <section className={CARD} aria-label="Who buys from you">
      <h2 className="mb-1 text-xl font-bold text-gray-900">Who buys from you</h2>
      <p className="mb-4 text-sm text-gray-500">Pick the groups you want leads for.</p>
      <ul className="grid gap-3">
        {segments.map((segment) => (
          <SegmentCard key={segment.segmentId} segment={segment} checked={selected.has(segment.segmentId)} onToggle={() => onToggle(segment.segmentId)} />
        ))}
      </ul>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" disabled className={BUTTON_PRIMARY}>{buildLabel(selected.size)}</button>
        <p className="text-sm text-gray-500">Lead builds open with accounts and credits.</p>
      </div>
    </section>
  )
}
