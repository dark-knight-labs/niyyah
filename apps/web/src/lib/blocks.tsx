"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { colorVar } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { BlockConfig } from "@/lib/vault-types";

export interface Blocks {
  list: BlockConfig[];
  ready: boolean;
  get: (key: string) => BlockConfig | undefined;
  label: (key: string) => string;
  ring: (key: string) => string;
  /** A CSS colour (a theme token) for the block; neutral for a key nobody defined. */
  color: (key: string) => string;
  /** The blocks a day shows: the ones it has votes for, in the user's order (unknown keys last); with no votes, the active counted blocks. */
  forDay: (votes: Record<string, number> | undefined) => BlockConfig[];
  reload: () => Promise<void>;
}

const NEUTRAL = "var(--muted-foreground)";
const Ctx = createContext<Blocks | null>(null);

export function BlocksProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<BlockConfig[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      setList((await vaultApi.blocksConfig()).blocks);
    } catch {
      setList([]); // not signed in, or the API is down: pages fall back to the key as a name
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<Blocks>(() => {
    const byKey = new Map(list.map((b) => [b.key, b]));
    const get = (key: string) => byKey.get(key);
    return {
      list, ready, get, reload,
      label: (key) => get(key)?.label ?? key,
      ring: (key) => get(key)?.ring_name ?? key.slice(0, 6).toUpperCase(),
      color: (key) => (get(key) ? colorVar(get(key)!.color) : NEUTRAL),
      forDay: (votes) => {
        if (!votes || Object.keys(votes).length === 0) return list.filter((b) => b.counts_for_stars && !b.archived);
        const known = list.filter((b) => b.key in votes);
        const unknown = Object.keys(votes).filter((k) => !byKey.has(k)).map((key): BlockConfig =>
          ({ key, label: key, ring_name: key.slice(0, 6).toUpperCase(), color: "slate", counts_for_stars: true, archived: true }));
        return [...known, ...unknown];
      },
    };
  }, [list, ready, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBlocks(): Blocks {
  const value = useContext(Ctx);
  if (!value) throw new Error("useBlocks needs a BlocksProvider above it");
  return value;
}
