"use client";

import {
  Accessibility,
  Circle,
  LayoutTemplate,
  Route,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import type { Finding, Mission } from "@/lib/app-types";
import { MissionCard } from "./mission-card";
import { findingFor, tileState, type TileState } from "./tile-state";

const BASE_ORDER = ["Flow", "UI", "Abuse", "Access", "Safety"];
const OTHER = "Other";

// Problems first.
const RANK: Record<TileState, number> = {
  bug: 0,
  needs_you: 1,
  possible: 2,
  failed: 3,
  blocked: 4,
  running: 5,
  queued: 6,
  passed: 7,
};

const LENS_ICON: Record<string, LucideIcon> = {
  Flow: Route,
  UI: LayoutTemplate,
  Abuse: ShieldAlert,
  Access: Accessibility,
  Safety: ShieldCheck,
};

interface Entry {
  mission: Mission;
  finding?: Finding;
  rank: number;
}

interface Group {
  lens: string;
  order: number;
  best: number;
  entries: Entry[];
}

function buildGroups(missions: Mission[], findings: Finding[]): Group[] {
  const byLens = new Map<string, Group>();
  let extra = 0;

  for (const mission of missions) {
    if (mission.kind !== "preview") continue;
    const lens = mission.lens?.trim() || OTHER;
    let group = byLens.get(lens);
    if (!group) {
      const base = BASE_ORDER.indexOf(lens);
      // Known lenses first, then other lenses in first-seen order, then Other.
      const order =
        lens === OTHER
          ? Number.MAX_SAFE_INTEGER
          : base >= 0
            ? base
            : BASE_ORDER.length + extra++;
      group = { lens, order, best: Infinity, entries: [] };
      byLens.set(lens, group);
    }
    const finding = findingFor(mission, findings);
    const rank = RANK[tileState(mission, finding)];
    group.entries.push({ mission, finding, rank });
    group.best = Math.min(group.best, rank);
  }

  const groups = [...byLens.values()];
  for (const g of groups) g.entries.sort((a, b) => a.rank - b.rank);
  groups.sort((a, b) => a.best - b.best || a.order - b.order);
  return groups;
}

export function MissionGroups({
  missions,
  findings,
  selectedId,
  onOpen,
}: {
  missions: Mission[];
  findings: Finding[];
  selectedId: string | null;
  onOpen: (missionId: string) => void;
}) {
  const idPrefix = useId();
  const groups = buildGroups(missions, findings);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-8" data-testid="mission-groups">
      {groups.map((group) => {
        const Icon = LENS_ICON[group.lens] ?? Circle;
        const headingId = `${idPrefix}-lens-${group.lens.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
        const count = group.entries.length;
        return (
          <section key={group.lens} aria-labelledby={headingId}>
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-accent">
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              <h3 id={headingId} className="font-semibold text-fg">
                {group.lens}
              </h3>
              <span className="text-sm text-muted">
                {count} {count === 1 ? "user" : "users"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.entries.map(({ mission, finding }) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  finding={finding}
                  selected={mission.id === selectedId}
                  onOpen={() => onOpen(mission.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
