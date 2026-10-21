import { after, NextResponse } from "next/server";
import { healJobs, kickRunner, kickWaitingJobs, processNextChunk, verifyJobSignature } from "@/lib/jobs";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Fluid compute lets a task run up to 5 minutes; a chunk stops fetching at 4 (CHUNK_BUDGET_MS in lib/jobs.ts).
export const maxDuration = 300;

// Processes ONE chunk of a job in the background, then starts the next chunk as a new task.
// Callable by the job itself (signature) or by a signed-in user who has access to the job's client (Resume button).
export async function POST(request: Request) {
  const { jobId } = (await request.json()) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  if (!verifyJobSignature(jobId, request.headers.get("x-job-sig"))) {
    const supabase = await getServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: job } = await supabase.from("sync_jobs").select("id").eq("id", jobId).maybeSingle();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  after(async () => {
    try {
      const { more, nextJobId } = await processNextChunk(jobId);
      if (more) await kickRunner(jobId);
      else await kickWaitingJobs(); // this job is over: start the next waiting one
      if (nextJobId) await kickRunner(nextJobId); // a campaign-level load just ended: its ad-level load starts now
    } catch {
      // An unexpected failure must not leave the job marked running: put it back in the queue (the idle-job check restarts it).
      await getAdminClient().from("sync_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "running");
    }
    // Any chunk also restarts other jobs whose chain broke, so a long load never waits for the hourly check.
    await healJobs().catch(() => {});
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
