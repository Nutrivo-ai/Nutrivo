// One app.jobs row kept current in the browser (docs/04 "Realtime and storage", T-305).
//
// app.jobs is in the supabase_realtime publication and Realtime authorizes every change with the table's own RLS
// (read_member), so a member receives only their workspace's jobs. The watcher reads the row once, then subscribes
// to its UPDATEs by id and re-reads once when the subscription is live, which closes the gap between the first read
// and the subscription, then twice more shortly after (SETTLE_READS_MS): a Realtime server whose replication is
// still starting can report SUBSCRIBED before it streams, and a change in that window would be lost. After that there
// is no steady re-read. What keeps a spinner from running forever (docs/18, visible
// terminal states):
//   - the channel fails (CHANNEL_ERROR, TIMED_OUT, CLOSED): the row is re-read every FALLBACK_POLL_MS until the
//     job is terminal or the channel is live again;
//   - nothing arrives for QUIET_RECHECK_MS: one re-read, in case a change was missed;
//   - the job is still not terminal after STALLED_AFTER_MS (the worker's lease): `stalled` turns true, so the screen
//     says so instead of spinning. The watcher keeps watching.
// It stops on a terminal state (succeeded, failed, cancelled) and when stopped.

export const FALLBACK_POLL_MS = 15_000;
export const QUIET_RECHECK_MS = 30_000;
export const SETTLE_READS_MS = [2_000, 6_000];
export const STALLED_AFTER_MS = 15 * 60_000;

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobRow = {
  id: string;
  status: JobStatus;
  progress: Record<string, unknown>;
  last_error: string | null;
  attempts: number;
};

export const TERMINAL = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);

export const JOB_COLUMNS = "id, status, progress, last_error, attempts";

export type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

/** What the watcher needs from Supabase, so tests can drive it without a network. */
export type JobSource = {
  read: () => Promise<JobRow | null>;
  subscribe: (
    jobId: string,
    onUpdate: (row: Partial<JobRow>) => void,
    onStatus: (status: ChannelStatus, error?: Error) => void,
  ) => () => void;
};

export type WatchState = {
  row: JobRow | null;
  /** The last read failed; the row shown may be old. */
  error: boolean;
  /** Changes arrive over Realtime; false while the watcher falls back to re-reading. */
  live: boolean;
  /** Not terminal after STALLED_AFTER_MS. */
  stalled: boolean;
};

export type WatchHooks = {
  /** A channel failure, for Sentry; never carries row content. */
  onChannelProblem?: (status: ChannelStatus, error?: Error) => void;
  now?: () => number;
};

export function watchJob(source: JobSource, emit: (state: WatchState) => void, hooks: WatchHooks = {}): () => void {
  const now = hooks.now ?? Date.now;
  const startedAt = now();
  let state: WatchState = { row: null, error: false, live: false, stalled: false };
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout>[] = [];

  const terminal = () => !!state.row && TERMINAL.has(state.row.status);

  const set = (next: Partial<WatchState>) => {
    if (stopped) return;
    state = { ...state, ...next };
    emit(state);
  };

  const clearTimers = () => {
    if (fallback) clearTimeout(fallback);
    if (quiet) clearTimeout(quiet);
    if (stall) clearTimeout(stall);
    settle.forEach(clearTimeout);
    settle = [];
    fallback = quiet = stall = undefined;
  };

  const finish = () => {
    clearTimers();
    if (unsubscribe) unsubscribe();
    unsubscribe = undefined;
  };

  const armQuiet = () => {
    if (quiet) clearTimeout(quiet);
    if (stopped || terminal()) return;
    quiet = setTimeout(() => void read(), QUIET_RECHECK_MS);
  };

  const armFallback = () => {
    if (fallback || stopped || terminal() || state.live) return;
    fallback = setTimeout(() => {
      fallback = undefined;
      void read().then(armFallback);
    }, FALLBACK_POLL_MS);
  };

  const accept = (row: JobRow | null) => {
    set({ row, error: false });
    if (terminal()) {
      if (state.stalled) set({ stalled: false });
      finish();
      return;
    }
    if (row && !unsubscribe) connect(row.id);
    armQuiet();
  };

  async function read(): Promise<void> {
    if (stopped) return;
    try {
      accept(await source.read());
    } catch {
      set({ error: true });
      armQuiet();
    }
    // A job that is not visible yet (or a read that failed) is looked for again until it is.
    if (!stopped && !terminal() && (!state.row || !state.live)) armFallback();
  }

  function connect(jobId: string) {
    unsubscribe = source.subscribe(
      jobId,
      (change) => {
        if (stopped || !state.row) return;
        accept({ ...state.row, ...change });
      },
      (status, error) => {
        if (stopped) return;
        if (status === "SUBSCRIBED") {
          if (fallback) clearTimeout(fallback);
          fallback = undefined;
          set({ live: true });
          void read();
          settle.forEach(clearTimeout);
          settle = SETTLE_READS_MS.map((ms) => setTimeout(() => void read(), ms));
          return;
        }
        hooks.onChannelProblem?.(status, error);
        set({ live: false });
        armFallback();
      },
    );
  }

  stall = setTimeout(() => {
    if (!terminal()) set({ stalled: true });
  }, Math.max(0, STALLED_AFTER_MS - (now() - startedAt)));

  void read();

  return () => {
    stopped = true;
    finish();
  };
}

export const EMPTY_WATCH: WatchState = { row: null, error: false, live: false, stalled: false };

/** A state read for another job, or for the same job before a retry, never shows for this one. */
export function visibleFor(
  state: WatchState & { ref: string | null; generation: number },
  ref: string | null,
  generation: number,
): WatchState {
  if (state.ref !== ref || state.generation !== generation) return EMPTY_WATCH;
  return { row: state.row, error: state.error, live: state.live, stalled: state.stalled };
}
