/** Draft text -> items: a line starts an item, indented lines under it are its description. */
export function parseDraft(draft: string): { text: string; description: string }[] {
  const items: { text: string; description: string[] }[] = [];
  let pendingBlank = false;
  for (const raw of draft.split("\n")) {
    if (!raw.trim()) { pendingBlank = true; continue; }
    const last = items[items.length - 1];
    if (last && /^(\s{2,}|\t)/.test(raw)) {
      if (pendingBlank && last.description.length) last.description.push("");
      last.description.push(raw.replace(/^(\s{2}|\t)/, "").trimEnd());
    } else {
      items.push({ text: raw.trim(), description: [] });
    }
    pendingBlank = false;
  }
  return items.map((i) => ({ text: i.text, description: i.description.join("\n") }));
}
