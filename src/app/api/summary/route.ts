import { generateDiscussionSummary } from "@/lib/services/summaryService";

export async function POST(request: Request) {
  const body = await request.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    const summary = await generateDiscussionSummary(sessionId);
    return Response.json({ summary });
  } catch (error) {
    console.error("[summary API error]", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
