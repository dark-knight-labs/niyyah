import { formatMinutes } from "@/lib/routine";
import { formatDuration } from "@/lib/ring";
import { VaultEventsData } from "@/lib/vault-types";
import { Section } from "@/components/routine/section";

/** Today's events from the calendars set up in Obsidian (Day Planner's iCal feeds). Read-only: edit them in Google Calendar. */
export function CalendarCard({ data }: { data: VaultEventsData | null }) {
  if (!data) return null;
  return (
    <Section title="Calendar" aside={`${data.events.length} today · read-only`}>
      {data.errors.length > 0 && <p className="mb-2 text-xs text-[var(--destructive)]">Could not read: {data.errors.join(", ")}</p>}
      {data.events.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted-foreground)]">No events today.</p>
      ) : (
        <ul>
          {data.events.map((e, i) => (
            <li key={`${e.calendar}-${e.title}-${i}`} className="flex gap-3 border-b border-[var(--border)] py-2.5 text-sm" style={{ borderLeft: `3px solid ${e.color ?? "var(--border)"}`, paddingLeft: 10 }}>
              <span className="w-[104px] shrink-0 tabular-nums text-[var(--muted-foreground)]">
                {e.all_day || e.start_min === null || e.end_min === null ? "All day" : `${formatMinutes(e.start_min)}–${formatMinutes(e.end_min)}`}
              </span>
              <span className="min-w-0 flex-1">
                <span className="break-words">{e.title}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {e.calendar}
                  {e.start_min !== null && e.end_min !== null && e.end_min > e.start_min ? ` · ${formatDuration(e.end_min - e.start_min)}` : ""}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
