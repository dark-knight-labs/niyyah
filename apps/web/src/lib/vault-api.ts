import { api } from "@/lib/api-client";
import { VaultScheduleData } from "@/lib/routine";
import {
  VaultBlocksSeriesData,
  VaultDayData,
  GoogleStatusData,
  NewEvent,
  VaultEvent,
  VaultEventsData,
  VaultLogEntry,
  VaultObjectivesData,
  Lane,
  MonthKey,
  PipelineItemData,
  PipelinesData,
  QuarterData,
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
  addTask: (day: string, text: string) => api.post<VaultEditData>(`/vault/day/${day}/tasks`, { text }),
  setTask: (task: VaultTaskData, done: boolean) => api.put<VaultEditData>("/vault/tasks", { path: task.path, line: task.line, hash: task.hash, done }),
  editTask: (task: VaultTaskData, text: string) => api.put<VaultEditData>("/vault/tasks/text", { path: task.path, line: task.line, hash: task.hash, text }),
  removeTask: (task: VaultTaskData) => api.post<VaultEditData>("/vault/tasks/remove", { path: task.path, line: task.line, hash: task.hash }),
  events: (day: string) => api.get<VaultEventsData>(`/vault/day/${day}/events`),
  googleStatus: () => api.get<GoogleStatusData>("/vault/calendar/google/status"),
  googleConnect: () => api.get<{ url: string }>("/vault/calendar/google/connect"),
  addEvent: (day: string, event: NewEvent) => api.post<VaultEvent>(`/vault/day/${day}/events`, event),
  log: (day: string) => api.get<VaultLogEntry[]>(`/vault/day/${day}/log`),
  editLog: (day: string, entry: VaultLogEntry, text: string) => api.put<VaultEditData>(`/vault/day/${day}/log`, { index: entry.index, hash: entry.hash, text }),
  removeLog: (day: string, entry: VaultLogEntry) => api.post<VaultEditData>(`/vault/day/${day}/log/remove`, { index: entry.index, hash: entry.hash }),
  objectives: () => api.get<VaultObjectivesData>("/vault/objectives"),
  setObjective: (stream: string, change: { text?: string; done?: boolean; checkpoint?: MonthKey | "" }) =>
    api.put<VaultObjectivesData>("/vault/objectives", { stream, ...change }),
  quarter: () => api.get<QuarterData>("/vault/quarter"),
  pipelines: () => api.get<PipelinesData>("/vault/pipelines"),
  addPipelineItems: (stream: string, texts: string[], lane: Lane = "backlog") =>
    api.post<VaultEditData>(`/vault/pipeline/${stream}/items`, { texts, lane }),
  movePipelineItem: (stream: string, item: PipelineItemData, lane: Lane) =>
    api.put<VaultEditData>("/vault/pipeline/move", { stream, line: item.line, hash: item.hash, lane }),
  tagPipelineItem: (stream: string, item: PipelineItemData, checkpoint: MonthKey | "") =>
    api.put<VaultEditData>("/vault/pipeline/checkpoint", { stream, line: item.line, hash: item.hash, checkpoint }),
  removePipelineItem: (stream: string, item: PipelineItemData) =>
    api.post<VaultEditData>("/vault/pipeline/remove", { stream, line: item.line, hash: item.hash }),
  sync: () => api.post<VaultSyncData>("/vault/sync", {}),
};
