import { Section } from "@/components/routine/section";

/** Reserved for the calendar integration: today's events will list here and on the ring's inner lane. */
export function CalendarCard() {
  return (
    <Section title="Calendar" aside="not connected yet">
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
        Today&apos;s events will appear here once a calendar is connected.
      </p>
    </Section>
  );
}
