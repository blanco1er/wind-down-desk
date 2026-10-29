/**
 * 29 Oct (long session, found on one page kept open evening after evening): the sorting session was never reset
 * between XR entries, so the stones sorted on previous evenings stayed active in their bowls; at the desk's cap
 * (8 active stones) Unload refused new ones ("The desk is full") — on the 4th evening without a reload, or for a
 * judge who relaunches the demo twice. Pure, unit-tested.
 *
 * A new XR entry starts from a FRESH desk when the previous evening is over:
 * - Good night was reached, or
 * - the person left after placing at least one stone (that evening's sorting is saved in memory already), or
 * - the evening's date changed (the page stayed open until the next evening).
 * Otherwise (a pause before anything was placed) the desk is kept as it was.
 */
export interface EveningSpan {
  /** The evening's date (memory's eveningDate) when this desk session began; null before the first entry. */
  startedOn: string | null;
  /** Good night reached in it. */
  goodnight: boolean;
  /** Stones placed in a bowl by hand or by voice since the last entry. */
  placed: number;
}

export function startFresh(prev: EveningSpan, tonight: string): boolean {
  if (prev.startedOn == null) return false;
  return prev.goodnight || prev.placed > 0 || prev.startedOn !== tonight;
}
