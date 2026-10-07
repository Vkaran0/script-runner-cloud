import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  const url = process.env["SUPABASE_URL"]!;
  const key =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  return client;
}

async function executeScript(script: string, timeoutMs = 60000): Promise<{
  logs: string;
  status: "success" | "error";
}> {
  const lines: string[] = [];
  const stamp = () => new Date().toISOString().split("T")[1]!.replace("Z", "");
  const fmt = (args: unknown[]) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  const mkConsole = (level: string) => (...args: unknown[]) => {
    lines.push(`[${stamp()}] ${level} ${fmt(args)}`);
  };
  const fakeConsole = {
    log: mkConsole("LOG"),
    info: mkConsole("INFO"),
    warn: mkConsole("WARN"),
    error: mkConsole("ERR"),
    debug: mkConsole("DBG"),
  };

  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

  try {
    // Wrap in eval so top-level IIFE promises (e.g. `(async () => {...})();`)
    // are returned and awaited instead of fire-and-forget.
    const wrapped = `return await eval(${JSON.stringify(script)});`;
    const fn = new AsyncFunction("console", "fetch", wrapped);
    const execPromise = Promise.resolve(fn(fakeConsole, fetch));
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    await Promise.race([execPromise, timeoutPromise]);
    return { logs: lines.join("\n"), status: "success" };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
    lines.push(`[${stamp()}] ERR Script failed: ${msg}`);
    return { logs: lines.join("\n"), status: "error" };
  }
}

export const runJobNow = createServerFn({ method: "POST" })
  .inputValidator((d: { jobId: string }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: job, error } = await sb.from("jobs").select("*").eq("id", data.jobId).single();
    if (error || !job) throw new Error(error?.message ?? "Job not found");

    const { data: runRow } = await sb
      .from("runs")
      .insert({ job_id: job.id, trigger: "manual", status: "running" })
      .select()
      .single();
    const startedAt = Date.now();
    const result = await executeScript(job.script);
    const dur = Date.now() - startedAt;

    if (runRow) {
      await sb
        .from("runs")
        .update({
          finished_at: new Date().toISOString(),
          status: result.status,
          logs: result.logs,
          duration_ms: dur,
        })
        .eq("id", runRow.id);
    }
    const now = new Date();
    await sb
      .from("jobs")
      .update({
        last_run_at: now.toISOString(),
        next_run_at: new Date(now.getTime() + job.interval_minutes * 60_000).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", job.id);
    return { ok: true };
  });

export const saveJob = createServerFn({ method: "POST" })
  .inputValidator((d: {
    id?: string;
    name: string;
    url: string;
    script: string;
    interval_minutes: number;
  }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    if (data.id) {
      await sb
        .from("jobs")
        .update({
          name: data.name,
          url: data.url,
          script: data.script,
          interval_minutes: data.interval_minutes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      return { id: data.id };
    }
    const { data: row, error } = await sb
      .from("jobs")
      .insert({
        name: data.name,
        url: data.url,
        script: data.script,
        interval_minutes: data.interval_minutes,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteJob = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    await sb.from("jobs").delete().eq("id", data.id);
    return { ok: true };
  });

export const setJobPaused = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; paused: boolean }) => d)
  .handler(async ({ data }) => {
    const sb = admin();
    await sb
      .from("jobs")
      .update({ paused: data.paused, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });

export const runDueJobs = createServerFn({ method: "POST" }).handler(async () => {
  const sb = admin();
  const nowIso = new Date().toISOString();
  const { data: dueJobs } = await sb
    .from("jobs")
    .select("*")
    .eq("paused", false)
    .lte("next_run_at", nowIso)
    .limit(20);
  if (!dueJobs || dueJobs.length === 0) return { ran: 0 };

  for (const job of dueJobs) {
    const { data: runRow } = await sb
      .from("runs")
      .insert({ job_id: job.id, trigger: "schedule", status: "running" })
      .select()
      .single();
    const t0 = Date.now();
    const result = await executeScript(job.script);
    const dur = Date.now() - t0;
    if (runRow) {
      await sb
        .from("runs")
        .update({
          finished_at: new Date().toISOString(),
          status: result.status,
          logs: result.logs,
          duration_ms: dur,
        })
        .eq("id", runRow.id);
    }
    const now = new Date();
    await sb
      .from("jobs")
      .update({
        last_run_at: now.toISOString(),
        next_run_at: new Date(now.getTime() + job.interval_minutes * 60_000).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", job.id);
  }
  return { ran: dueJobs.length };
});
