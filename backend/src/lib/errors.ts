// Thrown by a pipeline step for an expected failure the user should see (e.g. site unreachable).
export class PipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PipelineError'
  }
}

// Writing a run event failed. This is infrastructure, not a step failure, so the job is retried.
export class EventWriteError extends Error {
  constructor(cause: unknown) {
    super(`Could not write run event: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'EventWriteError'
  }
}
