// Fleet-wide aggregate health: walk every clone, ping uptime, and roll up
// failure / drift counts over the last 7 days. Used by the /health dashboard.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getCloneHealth, type CloneHealth } from "./clone-health.server";

type SupabaseLike = SupabaseClient<Database>;

export type FleetHealthRow = {
  cloneId: string;
  name: string;
  slug: string;
  syncStatus: Database["public"]["Enums"]["sync_status"];
  commitsBehind: number;
  health: CloneHealth;
};

export type FleetHealth = {
  ok: true;
  rows: FleetHealthRow[];
  totals: {
    total: number;
    up: number;
    down: number;
    unknown: number;
    cascadeFailures7d: number;
    cascades7d: number;
    openDrift: number;
    behind: number;
  };
};

export async function getFleetHealth(
  supabase: SupabaseLike,
  opts: { force?: boolean } = {},
): Promise<FleetHealth> {
  const { data: clones } = await supabase
    .from("clones")
    .select("id, name, slug, sync_status, commits_behind")
    .order("name");

  const list = clones ?? [];
  // Probe in parallel — getCloneHealth honors a 5-min snapshot cache, so the
  // first /health visit is slow (HEAD pings + AI summary) but subsequent
  // visits within the TTL are nearly instant DB reads.
  const healths = await Promise.all(
    list.map((c) => getCloneHealth(supabase, c.id, { skipCache: !!opts.force })),
  );

  const rows: FleetHealthRow[] = list.map((c, i) => ({
    cloneId: c.id,
    name: c.name,
    slug: c.slug,
    syncStatus: c.sync_status,
    commitsBehind: c.commits_behind,
    health: healths[i],
  }));

  const totals = rows.reduce(
    (acc, r) => {
      acc.total++;
      if (r.health.uptime.status === "up") acc.up++;
      else if (r.health.uptime.status === "down") acc.down++;
      else acc.unknown++;
      acc.cascadeFailures7d += r.health.failureCount7d;
      acc.cascades7d += r.health.cascadeCount7d;
      acc.openDrift += r.health.driftSuggestionsOpen;
      if (r.syncStatus === "behind" || r.commitsBehind > 0) acc.behind++;
      return acc;
    },
    {
      total: 0,
      up: 0,
      down: 0,
      unknown: 0,
      cascadeFailures7d: 0,
      cascades7d: 0,
      openDrift: 0,
      behind: 0,
    },
  );

  return { ok: true, rows, totals };
}
