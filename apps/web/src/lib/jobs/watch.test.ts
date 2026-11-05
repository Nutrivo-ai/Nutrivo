import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_POLL_MS,
  QUIET_RECHECK_MS,
  SETTLE_READS_MS,
  STALLED_AFTER_MS,
  watchJob,
  type ChannelStatus,
  type JobRow,
  type JobSource,
  type WatchState,
} from "./watch";

const row = (over: Partial<JobRow> = {}): JobRow => ({ id: "job-1", status: "queued", progress: {}, last_error: null, attempts: 0, ...over });

/** A fake Supabase: a row the test changes, a read counter and a channel the test drives. */
function fakeSource(initial: JobRow | null) {
  let current = initial;
  const channel: {
    onUpdate?: (r: Partial<JobRow>) => void;
    onStatus?: (s: ChannelStatus, e?: Error) => void;
    subscribed: number;
    closed: number;
  } = { subscribed: 0, closed: 0 };
  const source: JobSource & { reads: number; failNext: boolean } = {
    reads: 0,
    failNext: false,
    async read() {
      source.reads += 1;
      if (source.failNext) {
        source.failNext = false;
        throw new Error("network");
      }
      return current;
    },
    subscribe(_id, onUpdate, onStatus) {
      channel.subscribed += 1;
      channel.onUpdate = onUpdate;
      channel.onStatus = onStatus;
      return () => {
        channel.closed += 1;
      };
    },
  };
  return { source, channel, set: (r: JobRow | null) => (current = r) };
}

function start(source: JobSource, onChannelProblem?: (s: ChannelStatus) => void) {
  const states: WatchState[] = [];
  const stop = watchJob(source, (s) => states.push(s), { onChannelProblem });
  return { states, last: () => states[states.length - 1], stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("[T-305] a job kept current over Realtime, with no steady re-read", () => {
  it("[T-305][D01.main] reads once, subscribes by id, re-reads once when live, then follows Realtime to the end", async () => {
    const { source, channel } = fakeSource(row());
    const w = start(source);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.reads).toBe(1);
    expect(channel.subscribed).toBe(1);

    channel.onStatus!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    expect(source.reads).toBe(2); // closes the gap between the first read and the subscription
    expect(w.last()).toMatchObject({ live: true });

    // Two settle reads cover a Realtime server that is still starting its replication; then no 2 s re-read any more.
    await vi.advanceTimersByTimeAsync(SETTLE_READS_MS[SETTLE_READS_MS.length - 1]);
    expect(source.reads).toBe(2 + SETTLE_READS_MS.length);
    await vi.advanceTimersByTimeAsync(QUIET_RECHECK_MS - 1_000);
    expect(source.reads).toBe(2 + SETTLE_READS_MS.length);

    channel.onUpdate!({ status: "running", progress: { stage: "extracting" } });
    expect(w.last().row).toMatchObject({ status: "running", progress: { stage: "extracting" } });
    channel.onUpdate!({ status: "succeeded", progress: { status: "succeeded", panels: 3 } });
    expect(w.last().row?.status).toBe("succeeded");
    expect(channel.closed).toBe(1); // terminal: the channel is removed

    const reads = source.reads;
    await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS * 2);
    expect(source.reads).toBe(reads);
    expect(w.last().stalled).toBe(false);
  });

  it("[T-305] a job that is already terminal on the first read never subscribes", async () => {
    const { source, channel } = fakeSource(row({ status: "failed", last_error: "x" }));
    const w = start(source);
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.subscribed).toBe(0);
    expect(w.last().row?.status).toBe("failed");
  });
});

describe("[T-305] fallbacks: never a spinner forever (docs/18)", () => {
  it("[T-305] a channel that fails falls back to a re-read every 15 s until it is live again, and Sentry hears of it", async () => {
    const { source, channel } = fakeSource(row());
    const problems: ChannelStatus[] = [];
    const w = start(source, (s) => problems.push(s));
    await vi.advanceTimersByTimeAsync(0);
    channel.onStatus!("CHANNEL_ERROR", new Error("denied"));
    expect(problems).toEqual(["CHANNEL_ERROR"]);
    expect(w.last().live).toBe(false);

    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    expect(source.reads).toBe(2);
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    expect(source.reads).toBe(3);

    channel.onStatus!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(SETTLE_READS_MS[SETTLE_READS_MS.length - 1]);
    const afterLive = source.reads;
    await vi.advanceTimersByTimeAsync(QUIET_RECHECK_MS - SETTLE_READS_MS[SETTLE_READS_MS.length - 1] - 1_000);
    expect(source.reads).toBe(afterLive); // live again: the fallback stops
  });

  it("[T-305] the fallback reaches a terminal state that Realtime never delivered", async () => {
    const helper = fakeSource(row());
    const w = start(helper.source);
    await vi.advanceTimersByTimeAsync(0);
    helper.channel.onStatus!("TIMED_OUT");
    helper.set(row({ status: "failed", last_error: "x" }));
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    expect(w.last().row?.status).toBe("failed");
    const reads = helper.source.reads;
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS * 4);
    expect(helper.source.reads).toBe(reads); // terminal: polling stops
  });

  it("[T-305] a change Realtime missed while it was starting is found by a settle read", async () => {
    const helper = fakeSource(row());
    const w = start(helper.source);
    await vi.advanceTimersByTimeAsync(0);
    helper.channel.onStatus!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    helper.set(row({ status: "succeeded", progress: { status: "succeeded" } }));
    await vi.advanceTimersByTimeAsync(SETTLE_READS_MS[0]);
    expect(w.last().row?.status).toBe("succeeded");
  });

  it("[T-305] a live channel that goes quiet is re-read every 30 s, in case a change was missed", async () => {
    const helper = fakeSource(row());
    const w = start(helper.source);
    await vi.advanceTimersByTimeAsync(0);
    helper.channel.onStatus!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(SETTLE_READS_MS[SETTLE_READS_MS.length - 1]);
    helper.set(row({ status: "succeeded", progress: { status: "succeeded" } }));
    await vi.advanceTimersByTimeAsync(QUIET_RECHECK_MS);
    expect(w.last().row?.status).toBe("succeeded");
  });

  it("[T-305] a failed read is shown as an error and read again, never a silent spinner", async () => {
    const helper = fakeSource(row());
    helper.source.failNext = true;
    const w = start(helper.source);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.last()).toMatchObject({ error: true, row: null });
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    expect(w.last()).toMatchObject({ error: false, row: { status: "queued" } });
  });

  it("[T-305] a job still not finished after the worker's lease is shown as stalled, and the watch goes on", async () => {
    const helper = fakeSource(row());
    const w = start(helper.source);
    await vi.advanceTimersByTimeAsync(0);
    helper.channel.onStatus!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS);
    expect(w.last().stalled).toBe(true);
    helper.channel.onUpdate!({ status: "succeeded" });
    expect(w.last()).toMatchObject({ stalled: false, row: { status: "succeeded" } });
  });

  it("[T-305] stopping removes the channel and every timer", async () => {
    const helper = fakeSource(row());
    const w = start(helper.source);
    await vi.advanceTimersByTimeAsync(0);
    w.stop();
    expect(helper.channel.closed).toBe(1);
    const n = w.states.length;
    await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS * 2);
    expect(w.states.length).toBe(n);
  });
});
