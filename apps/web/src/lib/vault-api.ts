import { api } from "@/lib/api-client";
import { VaultScheduleData } from "@/lib/routine";
import {
  VaultBlocksSeriesData,
  VaultDayData,
  VaultMonthData,
  VaultEditData,
  VaultStreaksData,
  VaultTaskData,
  VaultSyncData,
  VaultWeekData,
} from "@/lib/vault-types";

export const vaultApi = {
  today: () => api.get<VaultDayData>("/vault/today"),
  week: () => api.get<VaultWeekData>("/vault/week"),
  month: (month: string) => api.get<VaultMonthData>(`/vault/month?month=${month}`),
  blocks: (days: number = 30) => api.get<VaultBlocksSeriesData>(`/vault/blocks?days=${days}`),
  streaks: () => api.get<VaultStreaksData>("/vault/streaks"),
  schedule: () => api.get<VaultScheduleData>("/vault/schedule"),
  editAccess: () => api.get<{ allowed: boolean }>("/vault/edit-access"),
  setMode: (day: string, mode: string) => api.put<VaultEditData>(`/vault/day/${day}/mode`, { mode }),
  setVote: (day: string, block: string, stars: number) => api.put<VaultEditData>(`/vault/day/${day}/vote`, { block, stars }),
  addNote: (day: string, section: string, span: string, text: string) => api.post<VaultEditData>(`/vault/day/${day}/notes`, { section, span, text }),
  tasks: (day: string) => api.get<VaultTaskData[]>(`/vault/day/${day}/tasks`),
  setTask: (task: VaultTaskData, done: boolean) => api.put<VaultEditData>("/vault/tasks", { path: task.path, line: task.line, hash: task.hash, done }),
  sync: () => api.post<VaultSyncData>("/vault/sync", {}),
};
