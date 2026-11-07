/** Links on thoughts are http(s) only: an imported or old row may carry anything (javascript:, data:), so every place that renders one goes through here. */
export const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim());
export const safeUrl = (u: unknown): string => (isHttpUrl(u) ? u.trim() : "");
