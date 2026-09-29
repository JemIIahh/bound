/**
 * Runs jobs one at a time in FIFO order and tracks which ids are queued or running.
 * A job that throws is logged and the queue moves on; nothing escapes as an unhandled rejection.
 */
export class SerialJobQueue {
  private readonly pending: Array<{ id: string; run: () => Promise<void> }> = []
  private readonly ids = new Set<string>()
  private running = false

  /** True while `id` is queued or running. */
  has(id: string): boolean {
    return this.ids.has(id)
  }

  /** Enqueues `run` under `id`. Returns false (and does nothing) when `id` is already queued or running. */
  add(id: string, run: () => Promise<void>): boolean {
    if (this.ids.has(id)) return false
    this.ids.add(id)
    this.pending.push({ id, run })
    void this.pump()
    return true
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (let job = this.pending.shift(); job; job = this.pending.shift()) {
        try {
          await job.run()
        } catch (e) {
          console.error('[job-queue]', job.id, e)
        } finally {
          this.ids.delete(job.id)
        }
      }
    } finally {
      this.running = false
    }
  }
}

/** Process-wide: at most one TIP-1022 salt search runs at a time (it saturates every core). */
export const processMiningQueue = new SerialJobQueue()
