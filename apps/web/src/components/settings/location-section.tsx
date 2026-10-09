"use client";

import { ScheduleMetaIn } from "@/lib/vault-types";
import { CHIP, FIELD, MICRO, SettingsSection } from "@/components/settings/section";

export const METHODS: [string, string][] = [
  ["karachi", "University of Islamic Sciences, Karachi"], ["mwl", "Muslim World League"], ["isna", "ISNA (North America)"],
  ["egyptian", "Egyptian General Authority"], ["ummalqura", "Umm al-Qura, Makkah"], ["dubai", "Dubai"], ["qatar", "Qatar"],
  ["kuwait", "Kuwait"], ["singapore", "Singapore"], ["turkey", "Turkey (Diyanet)"], ["tehran", "Tehran"],
  ["moonsighting", "Moonsighting Committee"],
];
const DAYS: [string, string][] = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

interface Props {
  meta: ScheduleMetaIn;
  onChange: (meta: ScheduleMetaIn) => void;
}

/** Where you are and how prayer times are worked out; the weekend days pick which schedule a day uses. */
export function LocationSection({ meta, onChange }: Props) {
  const set = (patch: Partial<ScheduleMetaIn>) => onChange({ ...meta, ...patch });
  const num = (v: string) => (v === "" ? null : Number(v));
  const toggle = (day: string) =>
    set({ weekend_days: meta.weekend_days.includes(day) ? meta.weekend_days.filter((d) => d !== day) : [...meta.weekend_days, day] });
  return (
    <SettingsSection id="location" title="Location and prayers" aside="Prayer times anchor the clock">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11.5rem,1fr))] gap-x-3.5 gap-y-2.5">
        <Field label="City"><input className={FIELD} value={meta.city ?? ""} onChange={(e) => set({ city: e.target.value || null })} /></Field>
        <Field label="Latitude"><input className={`${FIELD} font-mono`} type="number" step="any" value={meta.lat ?? ""} onChange={(e) => set({ lat: num(e.target.value) })} /></Field>
        <Field label="Longitude"><input className={`${FIELD} font-mono`} type="number" step="any" value={meta.lon ?? ""} onChange={(e) => set({ lon: num(e.target.value) })} /></Field>
        <Field label="Time zone"><input className={`${FIELD} font-mono`} value={meta.tz} onChange={(e) => set({ tz: e.target.value })} placeholder="Asia/Dhaka" /></Field>
        <Field label="Calculation method">
          <select className={FIELD} value={meta.method} onChange={(e) => set({ method: e.target.value })}>
            {METHODS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </Field>
        <Field label="Madhab (Asr)">
          <select className={FIELD} value={meta.madhab} onChange={(e) => set({ madhab: e.target.value })}>
            <option value="hanafi">Hanafi</option>
            <option value="shafi">Shafi</option>
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <p className={`${MICRO} mb-1.5`}>Weekend days</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekend days">
          {DAYS.map(([key, label]) => (
            <button key={key} type="button" className={CHIP} aria-pressed={meta.weekend_days.includes(key)} onClick={() => toggle(key)}>{label}</button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">These days use the weekend schedule below.</p>
      </div>
    </SettingsSection>
  );
}
