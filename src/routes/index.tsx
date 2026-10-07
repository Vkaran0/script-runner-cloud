import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  runJobNow,
  saveJob,
  deleteJob,
  setJobPaused,
} from "@/lib/jobs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Run = Database["public"]["Tables"]["runs"]["Row"];

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Script Scheduler — Cloud Console Runner" },
      {
        name: "description",
        content:
          "Schedule JavaScript snippets to run against any URL from the cloud. Live console logs, per-job history, pause/resume, run-now.",
      },
      { property: "og:title", content: "Script Scheduler" },
      {
        property: "og:description",
        content: "Run scripts on a schedule in the cloud with live logs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Dashboard() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);
  const [creating, setCreating] = useState(false);

  const jobsQ = useQuery({
    queryKey: ["jobs"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Job[];
    },
  });

  const runsQ = useQuery({
    queryKey: ["runs", selectedId],
    enabled: !!selectedId,
    refetchInterval: 10000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("runs")
        .select("*")
        .eq("job_id", selectedId!)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Run[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("jobs-dash")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        () => qc.invalidateQueries({ queryKey: ["jobs"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs" },
        () => {
          qc.invalidateQueries({ queryKey: ["runs"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  useEffect(() => {
    if (!selectedId && jobsQ.data && jobsQ.data.length > 0) {
      setSelectedId(jobsQ.data[0]!.id);
    }
  }, [jobsQ.data, selectedId]);

  const selected = useMemo(
    () => jobsQ.data?.find((j) => j.id === selectedId) ?? null,
    [jobsQ.data, selectedId],
  );

  const runNow = useServerFn(runJobNow);
  const togglePause = useServerFn(setJobPaused);
  const removeJob = useServerFn(deleteJob);
  const persistJob = useServerFn(saveJob);

  // ticking clock so the countdown stays live
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const handleRun = async (id: string) => {
    toast.info("Running...");
    try {
      await runNow({ data: { jobId: id } });
      toast.success("Run complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster />
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Script Scheduler
          </h1>
          <p className="text-xs text-muted-foreground">
            Cloud-hosted runner · schedules fire every minute · open access
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>+ New Job</Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0 h-[calc(100vh-73px)]">
        <aside className="border-r border-border overflow-y-auto">
          {jobsQ.isLoading && (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          )}
          {jobsQ.data?.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No jobs yet. Create one.
            </div>
          )}
          <ul>
            {jobsQ.data?.map((j) => (
              <li key={j.id}>
                <button
                  onClick={() => setSelectedId(j.id)}
                  className={`w-full text-left p-3 border-b border-border hover:bg-accent transition ${
                    selectedId === j.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{j.name}</span>
                    {j.paused ? (
                      <Badge variant="secondary">paused</Badge>
                    ) : (
                      <Badge>every {j.interval_minutes}m</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {j.url}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    next: {j.next_run_at ? new Date(j.next_run_at).toLocaleTimeString() : "—"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="overflow-y-auto">
          {!selected && (
            <div className="p-8 text-muted-foreground">Select a job.</div>
          )}
          {selected && (
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold truncate">{selected.name}</h2>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground hover:underline break-all"
                  >
                    {selected.url}
                  </a>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!selected.paused}
                      onCheckedChange={async (v) => {
                        await togglePause({ data: { id: selected.id, paused: !v } });
                      }}
                    />
                    <span className="text-sm">
                      {selected.paused ? "Paused" : "Active"}
                    </span>
                  </div>
                  <Button onClick={() => handleRun(selected.id)}>▶ Run Now</Button>
                  <Button variant="outline" onClick={() => setEditing(selected)}>
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (!confirm(`Delete "${selected.name}"?`)) return;
                      await removeJob({ data: { id: selected.id } });
                      setSelectedId(null);
                      toast.success("Deleted");
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div
                className={`rounded-md border p-3 flex flex-wrap items-center gap-3 ${
                  selected.paused
                    ? "border-border bg-muted/40"
                    : "border-green-500/40 bg-green-500/10"
                }`}
              >
                <span
                  className={`inline-flex items-center gap-2 text-sm font-medium ${
                    selected.paused ? "text-muted-foreground" : "text-green-600"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      selected.paused ? "bg-muted-foreground" : "bg-green-500 animate-pulse"
                    }`}
                  />
                  {selected.paused ? "Paused — schedule stopped" : "Active — running in the cloud"}
                </span>
                {!selected.paused && selected.next_run_at && (
                  <span className="text-sm">
                    Next run at{" "}
                    <strong>{new Date(selected.next_run_at).toLocaleString()}</strong>{" "}
                    <span className="text-muted-foreground">
                      (in {formatCountdown(new Date(selected.next_run_at).getTime() - now)})
                    </span>
                  </span>
                )}
              </div>

              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  Interval — currently every {selected.interval_minutes} min
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {INTERVAL_PRESETS.map((p) => (
                    <Button
                      key={p.minutes}
                      size="sm"
                      variant={selected.interval_minutes === p.minutes ? "default" : "outline"}
                      onClick={async () => {
                        await persistJob({
                          data: {
                            id: selected.id,
                            name: selected.name,
                            url: selected.url,
                            script: selected.script,
                            interval_minutes: p.minutes,
                          },
                        });
                        qc.invalidateQueries({ queryKey: ["jobs"] });
                        toast.success(`Interval set to ${p.label}`);
                      }}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <CustomInterval
                    current={selected.interval_minutes}
                    onApply={async (m) => {
                      await persistJob({
                        data: {
                          id: selected.id,
                          name: selected.name,
                          url: selected.url,
                          script: selected.script,
                          interval_minutes: m,
                        },
                      });
                      qc.invalidateQueries({ queryKey: ["jobs"] });
                      toast.success(`Interval set to ${m} min`);
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label="Interval" value={`${selected.interval_minutes} min`} />
                <Stat
                  label="Last run"
                  value={
                    selected.last_run_at
                      ? new Date(selected.last_run_at).toLocaleString()
                      : "—"
                  }
                />
                <Stat
                  label="Next run"
                  value={
                    selected.paused
                      ? "paused"
                      : selected.next_run_at
                        ? new Date(selected.next_run_at).toLocaleString()
                        : "—"
                  }
                />
                <Stat label="Status" value={selected.paused ? "Paused" : "Scheduled"} />
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-2">Live Console · Recent Runs</h3>
                {runsQ.isLoading && <div className="text-muted-foreground">Loading…</div>}
                <div className="space-y-3">
                  {runsQ.data?.map((run) => (
                    <RunCard key={run.id} run={run} />
                  ))}
                  {runsQ.data?.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                      No runs yet. Hit Run Now.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <JobDialog
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        job={editing}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}

function RunCard({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const color =
    run.status === "success"
      ? "bg-green-500/10 text-green-600 border-green-500/30"
      : run.status === "error"
        ? "bg-red-500/10 text-red-600 border-red-500/30"
        : "bg-yellow-500/10 text-yellow-600 border-yellow-500/30";
  return (
    <div className="rounded-md border border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-accent/50"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded border ${color}`}>
            {run.status}
          </span>
          <span className="text-sm">
            {new Date(run.started_at).toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">
            {run.trigger} · {run.duration_ms != null ? `${run.duration_ms}ms` : "…"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "hide" : "show"} logs
        </span>
      </button>
      {open && (
        <ScrollArea className="h-72 border-t border-border">
          <pre className="text-xs font-mono p-3 whitespace-pre-wrap bg-black/90 text-green-300 min-h-full">
            {run.logs || "(no output)"}
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}

function JobDialog({
  open,
  onClose,
  job,
}: {
  open: boolean;
  onClose: () => void;
  job: Job | null;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [script, setScript] = useState("");
  const [interval, setInterval] = useState(10);
  const persist = useServerFn(saveJob);

  useEffect(() => {
    if (open) {
      setName(job?.name ?? "New Job");
      setUrl(job?.url ?? "https://");
      setScript(job?.script ?? "// write your script here\nconsole.log('hello');");
      setInterval(job?.interval_minutes ?? 10);
    }
  }, [open, job]);

  const submit = async () => {
    try {
      const payload: {
        id?: string;
        name: string;
        url: string;
        script: string;
        interval_minutes: number;
      } = {
        name,
        url,
        script,
        interval_minutes: Math.max(1, Math.floor(interval)),
      };
      if (job?.id) payload.id = job.id;
      await persist({ data: payload });
      toast.success(job ? "Updated" : "Created");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{job ? "Edit Job" : "New Job"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Target URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              Informational — script runs server-side with <code>fetch</code> available.
            </p>
          </div>
          <div>
            <Label>Interval (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Script</Label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="font-mono text-xs min-h-[300px]"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Runs as async. <code>console.log/warn/error</code> captured. No DOM. 60s timeout.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>{job ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// avoid unused import warning if tree-shaking misses it
void DialogTrigger;
