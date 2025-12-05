/**
 * Debounce utility for rate-limiting function calls.
 *
 * @module utils/debounce
 */

/**
 * Creates a debounced version of a function that delays execution until
 * after a specified wait time has elapsed since the last call.
 *
 * @param fn - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the function with a cancel method
 *
 * @example
 * ```typescript
 * const debouncedSave = debounce(() => saveData(), 300);
 *
 * // Called multiple times rapidly, but only executes once after 300ms
 * debouncedSave();
 * debouncedSave();
 * debouncedSave();
 *
 * // Cancel pending execution
 * debouncedSave.cancel();
 * ```
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (this: unknown, ...args: Parameters<T>): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, wait);
  } as T & { cancel: () => void };

  debounced.cancel = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}
