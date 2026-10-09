import {
  BedDouble, BookOpen, Briefcase, CircleDot, Car, Clapperboard, Dumbbell, GraduationCap, Heart, House, Landmark, Moon,
  Plane, Server, ShoppingBag, ShoppingCart, Target, Users, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import type { MonthKey } from "@/lib/vault-types";

/** What the API says about a stream: it is defined by its section in the quarter note. */
export interface StreamInfo {
  stream: string;
  name: string;
  color: string;
  icon: string;
  slot: string;
  weekly: boolean;
  status: string;
}

export interface StreamMeta {
  id: string;
  label: string;
  /** Where the stream's time goes. */
  slot: string;
  /** CSS colour (a token, so it follows the theme). */
  color: string;
  icon: LucideIcon;
  /** Has a one-line weekly objective. */
  weekly: boolean;
  status: string;
}

export const PLANNER_TZ = "Asia/Dhaka";

export const ICONS: Record<string, LucideIcon> = {
  moon: Moon, dumbbell: Dumbbell, server: Server, "shopping-bag": ShoppingBag, clapperboard: Clapperboard, users: Users,
  landmark: Landmark, bed: BedDouble, briefcase: Briefcase, "book-open": BookOpen, heart: Heart, home: House, car: Car,
  wrench: Wrench, plane: Plane, "shopping-cart": ShoppingCart, "graduation-cap": GraduationCap, wallet: Wallet, target: Target,
  "circle-dot": CircleDot,
};

/** A colour key from the quarter note ("violet") as a theme token. */
export const colorVar = (key: string) => `var(--stream-${key || "slate"})`;

export function toMeta(info: Pick<StreamInfo, "name" | "color" | "icon" | "slot" | "weekly" | "status"> & { stream: string }): StreamMeta {
  return {
    id: info.stream, label: info.name, slot: info.slot, color: colorVar(info.color), icon: ICONS[info.icon] ?? CircleDot,
    weekly: info.weekly, status: info.status,
  };
}

export const MONTH_LABEL: Record<MonthKey, string> = {
  jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", may: "May", jun: "Jun",
  jul: "Jul", aug: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec",
};

/** The question the ONE Thing method asks at every level of the chain. */
export function focusingQuestion(stream: StreamMeta): string {
  return `What's the ONE thing I can do for ${stream.label} such that by doing it everything else becomes easier or unnecessary?`;
}
