'use client'

import { useState } from 'react'
import { useClaimCorrections } from '@/hooks/use-claim-corrections'
import { useRunEvents, type EventSourceFactory } from '@/hooks/use-run-events'
import { getPublicConfig } from '@/services/config'
import { CompetitorList } from './competitor-list'
import { ProfileCard } from './profile-card'
import { SegmentPicker } from './segment-picker'
import { StepTimeline } from './step-timeline'
import { SiteHeader } from './ui/site-header'
import { SECTION_LABEL } from './ui/styles'

export function AnalysisView({ runId, domain, createSource }: { runId: string; domain: string; createSource?: EventSourceFactory }) {
  const { run, connection } = useRunEvents(runId, getPublicConfig().streamUrl, createSource)
  const { corrections, correct } = useClaimCorrections(domain)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (segmentId: string): void => setSelected((current) => {
    const next = new Set(current)
    if (next.has(segmentId)) next.delete(segmentId)
    else next.add(segmentId)
    return next
  })
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl space-y-6 px-4 pt-32 pb-24">
        <div>
          <p className={`${SECTION_LABEL} mb-2`}>Website analysis · {domain}</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">Who buys from {domain}</h1>
        </div>
        <StepTimeline run={run} connection={connection} />
        {run.profile ? <ProfileCard profile={run.profile} corrections={corrections} onCorrect={correct} /> : null}
        <CompetitorList competitors={run.competitors} />
        <SegmentPicker segments={run.segments} selected={selected} onToggle={toggle} />
      </main>
    </>
  )
}
