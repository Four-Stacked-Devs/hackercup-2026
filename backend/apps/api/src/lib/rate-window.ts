/**
 * A sliding one-minute window of requests and tokens, for pacing calls to an
 * API with per-minute limits.
 *
 * A caller reserves room before it calls; when the window is full it waits for
 * the oldest call to age out rather than sending a request the provider would
 * refuse. `share` lets background work fill only part of the window, so a
 * student's request is never stuck behind a bulk job.
 */
export class RateWindow {
  private readonly calls: { at: number; tokens: number }[] = [];

  constructor(
    private readonly limits: { rpm?: number | undefined; tpm?: number | undefined },
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000,
  ) {}

  /**
   * Record a call of `tokens` if it fits within `share` of the limits and
   * return 0; otherwise return how long to wait before asking again.
   */
  tryReserve(tokens: number, share = 1): number {
    const { rpm, tpm } = this.limits;
    if (!rpm && !tpm) return 0;

    const now = this.now();
    while (this.calls.length > 0 && now - this.calls[0]!.at >= this.windowMs) this.calls.shift();

    const rpmCap = rpm ? Math.max(1, Math.floor(rpm * share)) : undefined;
    const tpmCap = tpm ? tpm * share : undefined;
    const used = this.calls.reduce((sum, call) => sum + call.tokens, 0);

    const requestsFit = !rpmCap || this.calls.length < rpmCap;
    // A call bigger than the whole window can never fit; send it alone rather
    // than waiting forever, and let the provider have the final word.
    const tokensFit = !tpmCap || used + tokens <= tpmCap || this.calls.length === 0;

    if (requestsFit && tokensFit) {
      this.calls.push({ at: now, tokens });
      return 0;
    }

    return Math.max(50, this.windowMs - (now - this.calls[0]!.at) + 50);
  }

  async reserve(tokens: number, share = 1): Promise<void> {
    for (;;) {
      const wait = this.tryReserve(tokens, share);
      if (wait === 0) return;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
