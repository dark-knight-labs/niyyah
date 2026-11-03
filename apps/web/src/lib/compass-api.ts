import { api } from "@/lib/api-client";

/** The user's mission and vision. Before the first save every field is "" and `updated_at` is null. */
export interface CompassData {
  mission: string;
  vision: string;
  vision_horizon: string;
  updated_at: string | null;
}

export type CompassChange = Partial<Pick<CompassData, "mission" | "vision" | "vision_horizon">>;

/** A role. `stream` is the slug of the block it works in, or null. */
export interface RoleData {
  id: number;
  name: string;
  color: string;
  stream: string | null;
}

export interface ValueData {
  id: number;
  name: string;
  arabic: string;
}

export const compassApi = {
  get: () => api.get<CompassData>("/compass"),
  put: (change: CompassChange) => api.put<CompassData>("/compass", change),
  values: () => api.get<ValueData[]>("/principles"),
  roles: () => api.get<RoleData[]>("/personas"),
  setRoleStream: (id: number, stream: string | null) => api.patch<RoleData>(`/personas/${id}`, { stream }),
};
