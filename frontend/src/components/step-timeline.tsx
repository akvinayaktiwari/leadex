import type { ConnectionState, RunView, StepView } from '@/types'

const MARK: Record<StepView['state'], string> = { started: '…', completed: '✓', failed: '✕' }

function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : ` · ${(ms / 1000).toFixed(1)} s`
}

export function StepTimeline({ run, connection }: { run: RunView; connection: ConnectionState }) {
  return (
    <section className="panel" aria-label="Progress">
      <ol className="steps">
        {run.steps.map((step) => (
          <li key={step.step} className={`step step-${step.state}`}>
            <span className="mark" aria-hidden="true">{MARK[step.state]}</span> {step.label}{seconds(step.durationMs)}
          </li>
        ))}
      </ol>
      {run.notes.length > 0 ? <ul className="notes">{run.notes.map((note, i) => <li key={i}>{note}</li>)}</ul> : null}
      {connection === 'reconnecting' && !run.end ? <p className="hint">Connection lost, reconnecting…</p> : null}
      {run.end?.status === 'failed' ? <p className="status-bad">{run.end.error?.message ?? 'The analysis failed.'}</p> : null}
    </section>
  )
}
