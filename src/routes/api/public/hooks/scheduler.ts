import { createFileRoute } from "@tanstack/react-router";
import { runDueJobs } from "@/lib/jobs.functions";

export const Route = createFileRoute("/api/public/hooks/scheduler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const result = await runDueJobs();
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
