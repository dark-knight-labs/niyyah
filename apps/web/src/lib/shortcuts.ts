/**
 * Every keyboard shortcut outside the Map, in one list. The "?" sheet reads its rows from here, and the test next to it
 * checks the rules that keep the bindings from shadowing each other. The Map has its own list (lib/map/commands.ts) and its own "?" sheet.
 *
 * `via` is how the page binds the key: "hotkeys" = the capture-phase `useHotkeys` hook (chords, Overview, Progress),
 * "bubble" = a bubble-phase document listener (Plan), which runs after the layout's chords have claimed their second key.
 */
export type ShortcutScope = "Everywhere" | "Overview" | "Plan" | "Progress";

export interface Shortcut {
  scope: ShortcutScope;
  /** What is pressed, as `useHotkeys` writes it: "d", "shift+d", "mod+b", "g o". Alternatives are separate entries. */
  combo: string;
  /** How the key is shown in the sheet. */
  show: string;
  label: string;
  via: "hotkeys" | "bubble";
}

export const SHORTCUTS: Shortcut[] = [
  { scope: "Everywhere", combo: "g o", show: "G then O", label: "Go to Overview", via: "hotkeys" },
  { scope: "Everywhere", combo: "g p", show: "G then P", label: "Go to Plan", via: "hotkeys" },
  { scope: "Everywhere", combo: "g h", show: "G then H", label: "Go to Habits", via: "hotkeys" },
  { scope: "Everywhere", combo: "g m", show: "G then M", label: "Go to Map", via: "hotkeys" },
  { scope: "Everywhere", combo: "g r", show: "G then R", label: "Go to Progress", via: "hotkeys" },
  { scope: "Everywhere", combo: "g s", show: "G then S", label: "Go to Settings", via: "hotkeys" },
  { scope: "Everywhere", combo: "?", show: "?", label: "Show this list", via: "hotkeys" },

  { scope: "Overview", combo: "d", show: "D", label: "Day view", via: "hotkeys" },
  { scope: "Overview", combo: "w", show: "W", label: "Week view", via: "hotkeys" },
  { scope: "Overview", combo: "shift+d", show: "Shift+D", label: "Show or hide done tasks", via: "hotkeys" },
  { scope: "Overview", combo: "v", show: "V", label: "Next view style", via: "hotkeys" },
  { scope: "Overview", combo: "shift+v", show: "Shift+V", label: "Previous view style", via: "hotkeys" },
  { scope: "Overview", combo: "[", show: "[", label: "Previous day or week", via: "hotkeys" },
  { scope: "Overview", combo: "]", show: "]", label: "Next day or week", via: "hotkeys" },
  { scope: "Overview", combo: "t", show: "T", label: "Back to today", via: "hotkeys" },
  { scope: "Overview", combo: "n", show: "N", label: "New item", via: "hotkeys" },
  { scope: "Overview", combo: "/", show: "/", label: "New item", via: "hotkeys" },
  { scope: "Overview", combo: "mod+b", show: "Ctrl+B", label: "Show or hide the sidebar", via: "hotkeys" },
  { scope: "Overview", combo: "Escape", show: "Esc", label: "Close the picked item", via: "hotkeys" },

  { scope: "Plan", combo: "1", show: "1", label: "Pick the first task in Now", via: "bubble" },
  { scope: "Plan", combo: "2", show: "2", label: "Pick the first task in Next", via: "bubble" },
  { scope: "Plan", combo: "3", show: "3", label: "Pick the first task in Someday", via: "bubble" },
  { scope: "Plan", combo: "n", show: "N", label: "New task in the column last picked (Someday at first)", via: "bubble" },
  { scope: "Plan", combo: "/", show: "/", label: "Go to the capture line", via: "bubble" },
  { scope: "Plan", combo: "j", show: "J", label: "Pick the next task", via: "bubble" },
  { scope: "Plan", combo: "k", show: "K", label: "Pick the previous task", via: "bubble" },
  { scope: "Plan", combo: "x", show: "X", label: "Tick the picked task", via: "bubble" },
  { scope: "Plan", combo: "s", show: "S", label: "Make the picked task the small domino", via: "bubble" },

  { scope: "Progress", combo: "[", show: "[", label: "Previous week", via: "hotkeys" },
  { scope: "Progress", combo: "]", show: "]", label: "Next week", via: "hotkeys" },
  { scope: "Progress", combo: "t", show: "T", label: "This week", via: "hotkeys" },
];

/** The scope a page contributes to the sheet (next to Everywhere), from its path. */
export function scopeOfPath(pathname: string): ShortcutScope | null {
  if (pathname === "/") return "Overview";
  if (pathname === "/plan") return "Plan";
  if (pathname === "/progress") return "Progress";
  return null;
}

/** The rows the sheet shows on a page: Everywhere first, then the page's own. */
export function shortcutsFor(pathname: string): Shortcut[] {
  const scope = scopeOfPath(pathname);
  return SHORTCUTS.filter((s) => s.scope === "Everywhere" || s.scope === scope);
}
