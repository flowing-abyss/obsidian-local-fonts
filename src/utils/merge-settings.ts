export function mergeSettings<T extends object>(
  defaults: T,
  saved: Partial<T> | null | undefined,
): T {
  return { ...defaults, ...saved };
}
