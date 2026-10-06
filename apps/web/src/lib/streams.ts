import { BedDouble, Clapperboard, Dumbbell, Landmark, Moon, Server, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import { MonthKey } from "@/lib/vault-types";

export type StreamId = "soul" | "body" | "kahf" | "alisha" | "distribution" | "fnf" | "finance" | "sleep";

export interface StreamMeta {
  id: StreamId;
  label: string;
  /** Where the stream's time goes. */
  slot: string;
  /** CSS colour (a token, so it follows the theme). */
  color: string;
  icon: LucideIcon;
  /** Has a quarter goal and a pipeline. */
  goal: boolean;
  /** Has a one-line weekly objective. */
  weekly: boolean;
}

export const PLANNER_TZ = "Asia/Dhaka";

const c = (id: string) => `var(--stream-${id})`;

/** Order matches the vault notes (quarter note, pipeline notes, weekly objectives). */
export const STREAMS: StreamMeta[] = [
  { id: "soul", label: "Soul", slot: "Soul · every day", color: c("soul"), icon: Moon, goal: true, weekly: true },
  { id: "body", label: "Body", slot: "Body · Fajr and Maghrib", color: c("body"), icon: Dumbbell, goal: true, weekly: true },
  { id: "kahf", label: "Kahf", slot: "OT · Sun to Thu", color: c("kahf"), icon: Server, goal: true, weekly: true },
  { id: "alisha", label: "Alisha Noor", slot: "OT · Fri and Sat", color: c("alisha"), icon: ShoppingBag, goal: true, weekly: true },
  { id: "distribution", label: "Distribution", slot: "Asr to Maghrib", color: c("distribution"), icon: Clapperboard, goal: true, weekly: true },
  { id: "fnf", label: "FnF", slot: "Family and friends", color: c("fnf"), icon: Users, goal: true, weekly: true },
  { id: "finance", label: "Finance", slot: "Passive", color: c("finance"), icon: Landmark, goal: true, weekly: false },
  { id: "sleep", label: "Sleep", slot: "After Isha", color: c("sleep"), icon: BedDouble, goal: false, weekly: true },
];

export const GOAL_STREAMS = STREAMS.filter((s) => s.goal);
export const WEEKLY_STREAMS = STREAMS.filter((s) => s.weekly);
export const streamMeta = (id: string): StreamMeta => STREAMS.find((s) => s.id === id) ?? STREAMS[0];

export const MONTH_LABEL: Record<MonthKey, string> = {
  jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", may: "May", jun: "Jun",
  jul: "Jul", aug: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec",
};

/** Fri and Sat are the weekend: the OT slot belongs to Alisha Noor, otherwise to Kahf. */
export function otStreamFor(date: Date, tz: string): StreamMeta {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return streamMeta(weekday === "Fri" || weekday === "Sat" ? "alisha" : "kahf");
}

/** The question the ONE Thing method asks at every level of the chain. */
export function focusingQuestion(stream: StreamMeta): string {
  return `What's the ONE thing I can do for ${stream.label} such that by doing it everything else becomes easier or unnecessary?`;
}
