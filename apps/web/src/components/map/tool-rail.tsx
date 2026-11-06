"use client";

export type Tool = "select" | "hand" | "mind" | "sticky" | "text" | "shape" | "frame" | "link";

const ICONS: Record<string, string> = {
  select: "M6 3l12 9-5.5 1.2L10 19z",
  hand: "M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-.5a6 6 0 01-5-2.7L4 13.5a1.5 1.5 0 012.5-1.6L8 14",
  mind: "M2 10h7v4H2zM9 12h3M12 6v12M12 6h3M12 18h3M15 4h7v4h-7zM15 16h7v4h-7z",
  sticky: "M4 4h16v10l-6 6H4zM14 20v-6h6",
  text: "M5 7V4h14v3M12 4v16M9 20h6",
  shape: "M4 6h16v12H4z",
  frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
  link: "M5 19L19 5M12 5h7v7",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
};

export const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "select", label: "Select", key: "V" }, { id: "hand", label: "Hand", key: "H" }, { id: "mind", label: "Mind map", key: "M" },
  { id: "sticky", label: "Sticky note", key: "N" }, { id: "text", label: "Text", key: "T" }, { id: "shape", label: "Shape", key: "S" },
  { id: "frame", label: "Frame", key: "F" }, { id: "link", label: "Connector", key: "L" },
];

export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

export function ToolRail({ tool, onTool, canUndo, canRedo, onUndo, onRedo }: {
  tool: Tool; onTool: (t: Tool) => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  return (
    <div className="nm-ui nm-tools" role="toolbar" aria-label="Board tools" aria-orientation="vertical">
      {TOOLS.map((t) => (
        <button key={t.id} type="button" data-tool={t.id} title={`${t.label} (${t.key})`} aria-label={t.label} aria-keyshortcuts={t.key} aria-pressed={tool === t.id} onClick={() => onTool(t.id)}>
          <Icon name={t.id} />
        </button>
      ))}
      <hr />
      <button type="button" data-tool="undo" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
      <button type="button" data-tool="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>
    </div>
  );
}
