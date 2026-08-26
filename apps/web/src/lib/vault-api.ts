import { api } from "@/lib/api-client";
import {
  VaultBlocksSeriesData,
  VaultDayData,
  VaultMonthData,
  VaultStreaksData,
  VaultSyncData,
  VaultWeekData,
} from "@/lib/vault-types";

export const vaultApi = {
  today: () => api.get<VaultDayData>("/vault/today"),
  week: () => api.get<VaultWeekData>("/vault/week"),
  month: (month: string) => api.get<VaultMonthData>(`/vault/month?month=${month}`),
  blocks: (days: number = 30) => api.get<VaultBlocksSeriesData>(`/vault/blocks?days=${days}`),
  streaks: () => api.get<VaultStreaksData>("/vault/streaks"),
  sync: () => api.post<VaultSyncData>("/vault/sync", {}),
};
