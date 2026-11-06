import { Check, Loader2, X } from 'lucide-react'
import type { ConnectionState, RunView, StepView } from '@/types'
import { CARD } from './ui/styles'

function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : ` · ${(ms / 1000).toFixed(1)} s`
}

// RigaChat's progress checklist (IndexingProgressCard): green when done, violet gradient while working, red on failure.
function StepMark({ state }: { state: StepView['state'] }) {
  const base = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white'
  if (state === 'completed') return <span className={`${base} bg-success`} aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
  if (state === 'failed') return <span className={`${base} bg-danger`} aria-hidden="true"><X size={14} strokeWidth={3} /></span>
  return <span className={`${base} bg-linear-to-br from-primary to-primary-container`} aria-hidden="true"><Loader2 size={14} className="animate-spin" /></span>
}

export function StepTimeline({ run, connection }: { run: RunView; connection: ConnectionState }) {
  return (
    <section className={CARD} aria-label="Progress">
      {/* Polite live region: screen readers announce each new step and the connection status as they arrive. */}
      <div role="status" aria-live="polite">
        <ol className="space-y-3">
          {run.steps.map((step) => (
            <li key={step.step} className={`step step-${step.state} flex items-center gap-3 text-sm`}>
              <StepMark state={step.state} />
              <span className={step.state === 'started' ? 'font-display font-semibold text-gray-900' : 'text-gray-700'}>{step.label}</span>
              <span className="text-gray-400">{seconds(step.durationMs)}</span>
            </li>
          ))}
        </ol>
        {run.notes.length > 0 ? (
          <ul className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-xs text-gray-500">{run.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
        ) : null}
        {connection === 'reconnecting' && !run.end ? <p className="mt-4 text-sm text-amber-600">Connection lost, reconnecting…</p> : null}
        {connection === 'unavailable' ? (
          <p className="mt-4 text-sm text-red-600">We couldn&apos;t load this analysis. The link may have expired. <a href="/" className="font-semibold underline">Start a new analysis</a></p>
        ) : null}
      </div>
      {run.end?.status === 'failed' ? <p className="mt-4 text-sm text-red-600">{run.end.error?.message ?? 'The analysis failed.'}</p> : null}
    </section>
  )
}
