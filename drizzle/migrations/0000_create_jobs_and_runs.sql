
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Untitled Job',
  url TEXT NOT NULL,
  script TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 10,
  paused BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  logs TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  trigger TEXT NOT NULL DEFAULT 'schedule'
);

CREATE INDEX runs_job_started_idx ON public.runs(job_id, started_at DESC);
CREATE INDEX jobs_next_run_idx ON public.jobs(next_run_at) WHERE paused = false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO anon, authenticated;
GRANT ALL ON public.jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO anon, authenticated;
GRANT ALL ON public.runs TO service_role;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open jobs all" ON public.jobs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open runs all" ON public.runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;

-- Preloaded job
INSERT INTO public.jobs (name, url, script, interval_minutes)
VALUES (
  'Navrang Rate Limit Test',
  'https://navrang-xnwq.onrender.com',
  $JS$(async () => {
  const API = "https://navrang-xnwq.onrender.com";
  console.log("=== RATE LIMITING TEST (10 rapid requests) ===\n");
  let blocked = 0, allowed = 0;
  for (let i = 1; i <= 10; i++) {
    try {
      const res = await fetch(API + "/api/verify-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          passId: `FAKE-${i}`, 
          gate: "Test" 
        })
      });
      if (res.status === 429) {
        blocked++;
        console.log(`Request ${i}: 🛡️  BLOCKED (429)`);
      } else {
        allowed++;
        console.log(`Request ${i}: ✅ ${res.status}`);
      }
    } catch (e) {
      console.log(`Request ${i}: ❌ ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`\nResult: ${allowed} allowed, ${blocked} blocked`);
  if (blocked === 0) {
    console.log("🚨 BUG: No rate limiting! Attacker can brute force.");
  } else {
    console.log("✅ Rate limiting active");
  }
})();$JS$,
  10
);
