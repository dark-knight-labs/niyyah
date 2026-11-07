/** Links on thoughts are http(s) only: an imported or old row may carry anything (javascript:, data:), so every place that renders one goes through here. */
export const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim());
export const safeUrl = (u: unknown): string => (isHttpUrl(u) ? u.trim() : "");

/** A style without a non-http(s) link: an old or imported row may hold one, and the API refuses to store it, so every write drops it instead of failing. */
export function cleanStyle<T extends object>(style: T): T {
  const url = (style as Record<string, unknown>).url;
  if (url === undefined || url === null || isHttpUrl(url)) return style;
  const { url: _drop, ...rest } = style as Record<string, unknown>; void _drop;
  return rest as T;
}
