import { BlockConfig, ScheduleMetaIn, ScheduleRowIn } from "@/lib/vault-types";

/** What the Settings page edits before Save: the location, the blocks and both schedules. */
export interface Draft {
  meta: ScheduleMetaIn;
  blocks: BlockConfig[];
  weekday: ScheduleRowIn[];
  weekend: ScheduleRowIn[];
}
