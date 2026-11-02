'use client'

// /analysis?run=<runId>&domain=<domain>. A query string, not /analysis/[domain]: the site is a static export, which
// cannot pre-render a page per unknown domain.
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalysisView } from '@/components/analysis-view'

function AnalysisFromQuery() {
  const params = useSearchParams()
  const runId = params.get('run')
  const domain = params.get('domain')
  if (!runId || !domain) return <main className="analysis"><p className="status-bad">This link is missing its analysis. Start again from the home page.</p></main>
  return <AnalysisView runId={runId} domain={domain} />
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<main className="analysis"><p className="hint">Loading…</p></main>}>
      <AnalysisFromQuery />
    </Suspense>
  )
}
