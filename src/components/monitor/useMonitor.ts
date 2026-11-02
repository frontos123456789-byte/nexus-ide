"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchOverview, loadSeen, MonitorHttpError, saveSeen } from "@/lib/monitor/client";
import { mergeDeployments, newFailures } from "@/lib/monitor/normalize";
import type { MonitorDeployment, MonitorFilters, MonitorProject } from "@/lib/monitor/types";

export const FAST_MS = 8_000;
export const SLOW_MS = 30_000;
const DAY = 24 * 3600_000;

export const defaultFilters: MonitorFilters = { projectId: "", status: "all", env: "all" };
const isDefault = (f: MonitorFilters) => !f.projectId && f.status === "all" && f.env === "all";

function describe(d: MonitorDeployment): string {
  return `${d.projectName} · ${d.env === "production" ? "Production" : "Preview"}${d.branch ? ` · ${d.branch}` : ""}${d.commitMessage ? ` — ${d.commitMessage}` : ""}`;
}

/**
 * Data layer of the Vercel Monitor: loading, filters, history pagination, auto-refresh (adaptive, paused while the tab is hidden)
 * and failed-deployment notifications. All data is real Vercel data – there is no fallback/demo content.
 */
export function useMonitor(opts: { enabled: boolean; scope: string }) {
  const { enabled, scope } = opts;
  const [filters, setFilters] = useState<MonitorFilters>(defaultFilters);
  const [projects, setProjects] = useState<MonitorProject[]>([]);
  const [deployments, setDeployments] = useState<MonitorDeployment[]>([]);
  const [failures, setFailures] = useState<MonitorDeployment[]>([]);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string; resetAt?: number } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tick, setTick] = useState(0);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const seen = useRef<{ notified: Set<string>; acked: Set<string>; baselined: boolean }>({ notified: new Set(), acked: new Set(), baselined: false });
  const inflight = useRef(0);
  const olderRef = useRef<MonitorDeployment[]>([]);
  const countRef = useRef(0);

  const persist = useCallback(() => saveSeen(scope, { notified: [...seen.current.notified], acked: [...seen.current.acked] }), [scope]);

  useEffect(() => {
    const s = loadSeen(scope);
    seen.current = { notified: new Set(s?.notified), acked: new Set(s?.acked), baselined: Boolean(s) };
    setAcked(new Set(s?.acked));
  }, [scope]);

  const handleFailures = useCallback(
    (list: MonitorDeployment[]) => {
      const recent = list.filter((d) => d.status === "error" && Date.now() - d.createdAt < DAY).slice(0, 30);
      setFailures(recent);
      const s = seen.current;
      if (!s.baselined) {
        // First time on this account/device: existing failures are history, not news.
        for (const d of recent) {
          s.notified.add(d.id);
          s.acked.add(d.id);
        }
        s.baselined = true;
        setAcked(new Set(s.acked));
        persist();
        return;
      }
      const fresh = newFailures(recent, s.notified);
      if (fresh.length === 0) return;
      for (const d of fresh) s.notified.add(d.id);
      persist();
      for (const d of fresh.slice(0, 3)) {
        toast.error(`Деплой не удался: ${d.projectName}`, { description: describe(d), duration: 12_000, action: d.inspectorUrl ? { label: "Логи", onClick: () => window.open(d.inspectorUrl!, "_blank", "noopener,noreferrer") } : undefined });
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(`Деплой не удался: ${d.projectName}`, { body: describe(d), tag: d.id });
          } catch {
            /* some mobile browsers only allow notifications through a service worker */
          }
        }
      }
      if (fresh.length > 3) toast.error(`И ещё ${fresh.length - 3} неудачных деплоев`);
    },
    [persist],
  );

  const load = useCallback(
    async (mode: "initial" | "manual" | "auto") => {
      if (!enabled) return;
      const f = filtersRef.current;
      const id = ++inflight.current;
      if (mode === "manual") setRefreshing(true);
      try {
        // Re-read everything that is already on screen (up to Vercel's page limit of 100) so statuses of older loaded rows stay fresh.
        const main = await fetchOverview({ filters: f, limit: Math.min(100, Math.max(50, countRef.current)) });
        // Failures must be watched across ALL projects even while the list is filtered.
        const errs = isDefault(f) ? null : await fetchOverview({ filters: { status: "error" }, limit: 30, projects: false });
        if (id !== inflight.current) return; // a newer request (e.g. other filters) superseded this one
        setProjects(main.projects);
        const first = main.deployments;
        const oldestFirst = first.length ? Math.min(...first.map((d) => d.createdAt)) : 0;
        // keep already loaded older pages (history), refresh the head
        // (rows beyond the refreshed window that are still queued/building would be stale – they come back via "load more")
        const keep = olderRef.current.filter((d) => d.createdAt < oldestFirst && d.status !== "queued" && d.status !== "building" && (!f.projectId || d.projectId === f.projectId));
        olderRef.current = keep;
        setDeployments(mergeDeployments(keep, first));
        setCursor(keep.length ? (olderRef.current.at(-1)?.createdAt ?? main.nextCursor) : main.nextCursor);
        setUpdatedAt(main.fetchedAt);
        setError(null);
        handleFailures(errs ? errs.deployments : first);
      } catch (e) {
        if (id !== inflight.current) return;
        const err = e instanceof MonitorHttpError ? { message: e.message, code: e.code, resetAt: e.resetAt } : { message: "Нет связи с сервером Nexus" };
        setError(err);
        if (mode === "manual") toast.error(err.message);
      } finally {
        if (id === inflight.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled, handleFailures],
  );

  // (re)load whenever the filters change
  useEffect(() => {
    if (!enabled) return;
    olderRef.current = [];
    setLoading(true);
    void load("initial");
  }, [enabled, filters, load]);

  countRef.current = deployments.length;
  const hasActive = useMemo(() => deployments.some((d) => d.status === "queued" || d.status === "building"), [deployments]);
  const loadRef = useRef(load);
  loadRef.current = load;

  // adaptive auto-refresh: fast while something is queued/building, paused while the tab is hidden
  useEffect(() => {
    if (!enabled || !autoRefresh) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await loadRef.current("auto");
        schedule();
      }, hasActive ? FAST_MS : SLOW_MS);
    };
    const onVisible = () => {
      if (!document.hidden) void loadRef.current("auto");
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, autoRefresh, hasActive]);

  // relative timestamps
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await fetchOverview({ filters: filtersRef.current, until: cursor, limit: 50, projects: false });
      olderRef.current = mergeDeployments(olderRef.current, more.deployments);
      setDeployments((cur) => mergeDeployments(cur, more.deployments));
      setCursor(more.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить историю");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  const acknowledgeAll = useCallback(() => {
    for (const d of failures) seen.current.acked.add(d.id);
    setAcked(new Set(seen.current.acked));
    persist();
  }, [failures, persist]);

  const unread = useMemo(() => failures.filter((d) => !acked.has(d.id)).length, [failures, acked]);

  return {
    filters,
    setFilters,
    projects,
    deployments,
    failures,
    unread,
    cursor,
    loading,
    refreshing,
    loadingMore,
    error,
    updatedAt,
    autoRefresh,
    setAutoRefresh,
    hasActive,
    refresh: () => load("manual"),
    loadMore,
    acknowledgeAll,
    tick,
  };
}
