"use client";

import { useCallback, useEffect, useState } from "react";
import { boardsApi } from "@/lib/map/boards-api";
import type { Board } from "@/lib/map/types";

/** The owner's boards. The API creates the Life board on the first list. */
export function useBoards() {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await boardsApi.list();
      setBoards(list);
      setError(null);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load boards");
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async (title: string) => {
    const b = await boardsApi.create({ title });
    setBoards((cur) => (cur ? [...cur, b] : [b]));
    return b;
  }, []);

  const remove = useCallback(async (id: string) => {
    await boardsApi.remove(id);
    setBoards((cur) => (cur ? cur.filter((b) => b.id !== id) : cur));
  }, []);

  const retitle = useCallback((id: string, title: string) => {
    setBoards((cur) => (cur ? cur.map((b) => (b.id === id ? { ...b, title } : b)) : cur));
  }, []);

  return { boards, error, refresh, create, remove, retitle };
}
