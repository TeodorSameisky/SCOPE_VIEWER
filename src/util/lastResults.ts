/**
 * For results that arrive later (measurements and spectra computed in a worker): `keep` takes the key of
 * what is shown (a channel, a spectrum) and the result there is now, and gives back that result, or while
 * it is not there yet the last one seen for the key, with `pending` set. A table or a plot thus keeps its
 * values (dimmed) while the worker computes the next ones, instead of flickering. `fits` says whether the
 * last result still belongs to what is asked for (the spectrum of another channel or window does not).
 */
export class LastResults<T> {
  private readonly last = new Map<string, T>()

  keep = (key: string, current: T | undefined, fits?: (last: T) => boolean): { value: T | undefined; pending: boolean } => {
    if (current !== undefined) {
      this.last.set(key, current)
      return { value: current, pending: false }
    }
    const previous = this.last.get(key)
    return { value: previous !== undefined && (!fits || fits(previous)) ? previous : undefined, pending: true }
  }
}
