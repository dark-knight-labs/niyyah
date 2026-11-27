import { describe, expect, it } from "vitest";
import { LANE_FOR } from "@/lib/plan-model";

describe("column -> lane", () => {
  it("sends Now and Next to their own lanes and Someday to the backlog lane the API knows", () => {
    expect(LANE_FOR.now).toBe("now");
    expect(LANE_FOR.next).toBe("next");
    expect(LANE_FOR.someday).toBe("backlog");
  });
});
