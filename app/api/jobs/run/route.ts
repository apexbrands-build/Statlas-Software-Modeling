import { after, NextResponse } from "next/server";
import { kickRunner, processNextChunk, verifyJobSignature } from "@/lib/jobs";
import { getServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

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
    const { more } = await processNextChunk(jobId);
    if (more) await kickRunner(jobId);
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
