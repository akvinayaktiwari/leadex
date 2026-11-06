'use client'

// /analysis?run=<runId>&domain=<domain>. A query string, not /analysis/[domain]: the site is a static export, which
// cannot pre-render a page per unknown domain.
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalysisView } from '@/components/analysis-view'
import { SiteHeader } from '@/components/ui/site-header'
import { BUTTON_PRIMARY, CARD } from '@/components/ui/styles'

function MissingAnalysis() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 pt-40 pb-24">
        <div className={`${CARD} text-center`}>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">This link is missing its analysis.</h1>
          <p className="mb-6 text-sm text-gray-500">Paste your website on the home page to start one.</p>
          <a href="/" className={BUTTON_PRIMARY}>Start a new analysis</a>
        </div>
      </main>
    </>
  )
}

function AnalysisFromQuery() {
  const params = useSearchParams()
  const runId = params.get('run')
  const domain = params.get('domain')
  if (!runId || !domain) return <MissingAnalysis />
  return <AnalysisView runId={runId} domain={domain} />
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<main className="px-4 pt-32 text-center text-sm text-gray-500">Loading…</main>}>
      <AnalysisFromQuery />
    </Suspense>
  )
}
