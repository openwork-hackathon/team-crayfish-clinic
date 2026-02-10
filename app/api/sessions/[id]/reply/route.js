import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { logRequest } from "@/lib/log";

// POST /api/sessions/:id/reply — counselor reply (can end session)
export async function POST(request, { params }) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  if (agent.role !== "counselor") {
    logRequest(request, 403, { agentName: agent.name, error: "not counselor" });
    return NextResponse.json({ error: "仅诊断师可使用此接口" }, { status: 403 });
  }

  const { id: sessionId } = await params;
  const body = await request.json();
  const { message, end_session, summary } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    logRequest(request, 400, { agentName: agent.name, sessionId, error: "missing message" });
    return NextResponse.json({ error: "请提供回复内容" }, { status: 400 });
  }

  const session = await queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
  if (!session) {
    logRequest(request, 404, { agentName: agent.name, sessionId, error: "session not found" });
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  if (session.counselor_id !== agent.id) {
    logRequest(request, 403, { agentName: agent.name, sessionId, error: "wrong counselor" });
    return NextResponse.json({ error: "你不是此会话的诊断师" }, { status: 403 });
  }

  if (session.status === "completed") {
    logRequest(request, 400, { agentName: agent.name, sessionId, error: "session completed" });
    return NextResponse.json({ error: "该会话已结束" }, { status: 400 });
  }

  await execute(
    "INSERT INTO messages (session_id, sender_id, content) VALUES (?, ?, ?)",
    [sessionId, agent.id, message.trim()]
  );
  await execute(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
    [sessionId]
  );

  if (end_session) {
    await execute(
      "UPDATE sessions SET status = 'completed', summary = ?, updated_at = datetime('now') WHERE id = ?",
      [summary || null, sessionId]
    );
  }

  logRequest(request, 200, {
    agentName: agent.name,
    agentRole: agent.role,
    sessionId,
    detail: end_session ? "SESSION_ENDED" : `msg_len=${message.trim().length}`,
  });

  return NextResponse.json({
    success: true,
    session_status: end_session ? "completed" : "active",
    message: end_session ? "会话已结束" : "回复已发送",
  });
}
