/**
 * 26 Oct (CPU / overdraw pass): this pass's savings can be switched off together from the play-test API
 * (`__wdd.perfOpts(false)`), to measure them against the same page at the same moment (A/B, interleaved).
 * Always on in normal use.
 */
export const perfOpts = { on: true };
