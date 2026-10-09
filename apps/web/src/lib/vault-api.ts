import { api } from "@/lib/api-client";
import { VaultScheduleData } from "@/lib/routine";
import {
  BlockConfig,
  BlocksConfigData,
  FeedData,
  GoalIn,
  ScheduleConfigIn,
  VaultBlocksSeriesData,
  VaultDayData,
  GoogleStatusData,
  NewEvent,
  VaultEvent,
  VaultEventsData,
  VaultLogEntry,
  VaultGoalsData,
  DaysStatusData,
  VaultObjectivesData,
  Lane,
  MonthKey,
  NotebookEntryData,
  NotebookKind,
  NotebooksData,
  PipelineItemData,
  PipelinesData,
  QuarterData,
  StreamChange,
  VaultMonthData,
  VaultEditData,
  VaultStreaksData,
  VaultTaskData,
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
  goals: () => api.get<VaultGoalsData>("/vault/goals"),
  saveGoals: (items: GoalIn[]) => api.put<VaultGoalsData>("/vault/config/goals", { items }),
  objectives: () => api.get<VaultObjectivesData>("/vault/objectives"),
  setObjective: (stream: string, change: { text?: string; done?: boolean; checkpoint?: MonthKey | "" }) =>
    api.put<VaultObjectivesData>("/vault/objectives", { stream, ...change }),
  quarter: () => api.get<QuarterData>("/vault/quarter"),
  setSuperObjective: (text: string, arabic?: string) => api.put<QuarterData>("/vault/quarter", { text, arabic }),
  tickStreamItem: (stream: string, scope: string, id: string, done: boolean) =>
    api.put<QuarterData>("/vault/quarter/stream/item", { stream, scope, id, done }),
  tickGoalItem: (id: string, done: boolean) => api.put<VaultGoalsData>("/vault/goals/item", { id, done }),
  updateStream: (stream: string, change: StreamChange) => api.put<QuarterData>("/vault/quarter/stream", { stream, ...change }),
  addStream: (stream: string, change: StreamChange & { name: string }) => api.post<QuarterData>("/vault/quarter/stream", { stream, ...change }),
  focusPipelineItem: (stream: string, item: PipelineItemData) =>
    api.put<VaultEditData>("/vault/pipeline/focus", { stream, line: item.line, hash: item.hash }),
  renamePipelineItem: (stream: string, item: PipelineItemData, text: string) =>
    api.put<VaultEditData>("/vault/pipeline/text", { stream, line: item.line, hash: item.hash, text }),
  describePipelineItem: (stream: string, item: PipelineItemData, description: string) =>
    api.put<VaultEditData>("/vault/pipeline/description", { stream, line: item.line, hash: item.hash, description }),
  blockPipelineItem: (stream: string, item: PipelineItemData, ids: string[]) =>
    api.put<VaultEditData>("/vault/pipeline/blocked-by", { stream, line: item.line, hash: item.hash, ids }),
  pipelines: () => api.get<PipelinesData>("/vault/pipelines"),
  addPipelineItems: (stream: string, texts: string[], lane: Lane = "backlog", descriptions?: string[]) =>
    api.post<VaultEditData>(`/vault/pipeline/${stream}/items`, { texts, lane, descriptions }),
  movePipelineItem: (stream: string, item: PipelineItemData, lane: Lane) =>
    api.put<VaultEditData>("/vault/pipeline/move", { stream, line: item.line, hash: item.hash, lane }),
  tagPipelineItem: (stream: string, item: PipelineItemData, checkpoint: MonthKey | "") =>
    api.put<VaultEditData>("/vault/pipeline/checkpoint", { stream, line: item.line, hash: item.hash, checkpoint }),
  removePipelineItem: (stream: string, item: PipelineItemData) =>
    api.post<VaultEditData>("/vault/pipeline/remove", { stream, line: item.line, hash: item.hash }),
  notebooks: () => api.get<NotebooksData>("/vault/notebooks"),
  addNotebookEntry: (stream: string, kind: NotebookKind, title: string, body: string) =>
    api.post<VaultEditData>(`/vault/notebook/${stream}/entries`, { kind, title, body }),
  editNotebookEntry: (stream: string, entry: NotebookEntryData, title: string, body: string) =>
    api.put<VaultEditData>("/vault/notebook/entry", { stream, line: entry.line, hash: entry.hash, title, body }),
  setBlocker: (stream: string, entry: NotebookEntryData, open: boolean) =>
    api.put<VaultEditData>("/vault/notebook/blocker", { stream, line: entry.line, hash: entry.hash, open }),
  removeNotebookEntry: (stream: string, entry: NotebookEntryData) =>
    api.post<VaultEditData>("/vault/notebook/remove", { stream, line: entry.line, hash: entry.hash }),
  blocksConfig: () => api.get<BlocksConfigData>("/vault/config/blocks"),
  saveBlocks: (blocks: BlockConfig[]) => api.put<BlocksConfigData>("/vault/config/blocks", { blocks }),
  saveSchedule: (body: ScheduleConfigIn) => api.put<VaultScheduleData>("/vault/config/schedule", body),
  feeds: () => api.get<FeedData[]>("/vault/config/feeds"),
  addFeed: (name: string, url: string) => api.post<FeedData>("/vault/config/feeds", { name, url }),
  removeFeed: (id: number) => api.delete(`/vault/config/feeds/${id}`),
  status: () => api.get<DaysStatusData>("/vault/status"),
};
