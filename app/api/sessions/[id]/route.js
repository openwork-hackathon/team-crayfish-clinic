import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { execute, queryOne, queryAll } from "@/lib/db";
import { logRequest } from "@/lib/log";

// POST /api/sessions/:id/messages — send message in existing session
export async function POST(request, { params }) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const body = await request.json();
  const { message } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    logRequest(request, 400, { agentName: agent.name, sessionId, error: "missing message" });
    return NextResponse.json({ error: "请提供消息内容" }, { status: 400 });
  }

  const session = await queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
  if (!session) {
    logRequest(request, 404, { agentName: agent.name, sessionId, error: "session not found" });
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  if (session.status === "completed") {
    logRequest(request, 400, { agentName: agent.name, sessionId, error: "session completed" });
    return NextResponse.json({ error: "该会话已结束" }, { status: 400 });
  }

  if (agent.id !== session.visitor_id && agent.id !== session.counselor_id) {
    logRequest(request, 403, { agentName: agent.name, sessionId, error: "not participant" });
    return NextResponse.json({ error: "你不是此会话的参与方" }, { status: 403 });
  }

  await execute(
    "INSERT INTO messages (session_id, sender_id, content) VALUES (?, ?, ?)",
    [sessionId, agent.id, message.trim()]
  );
  await execute(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
    [sessionId]
  );

  logRequest(request, 201, { agentName: agent.name, agentRole: agent.role, sessionId, detail: `msg_len=${message.trim().length}` });
  return NextResponse.json({ success: true, message: "消息已发送" }, { status: 201 });
}

// GET /api/sessions/:id — session detail with all messages
export async function GET(request, { params }) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  const { id: sessionId } = await params;

  const session = await queryOne(
    `SELECT s.*, v.name as visitor_name, c.name as counselor_name
     FROM sessions s
     JOIN agents v ON v.id = s.visitor_id
     JOIN agents c ON c.id = s.counselor_id
     WHERE s.id = ?`,
    [sessionId]
  );

  if (!session) {
    logRequest(request, 404, { agentName: agent.name, sessionId, error: "session not found" });
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  if (agent.id !== session.visitor_id && agent.id !== session.counselor_id) {
    logRequest(request, 403, { agentName: agent.name, sessionId, error: "not participant" });
    return NextResponse.json({ error: "你不是此会话的参与方" }, { status: 403 });
  }

  const messages = await queryAll(
    `SELECT m.id, m.sender_id, a.name as sender_name, a.role as sender_role,
            m.content, m.created_at
     FROM messages m
     JOIN agents a ON a.id = m.sender_id
     WHERE m.session_id = ?
     ORDER BY m.created_at ASC`,
    [sessionId]
  );

  logRequest(request, 200, { agentName: agent.name, sessionId, detail: `msgs=${messages.length} status=${session.status}` });

  const response = {
    session_id: session.id,
    status: session.status,
    visitor_name: session.visitor_name,
    counselor_name: session.counselor_name,
    created_at: session.created_at,
    updated_at: session.updated_at,
    messages,
  };

  // Summary/report is only available through the /report endpoint
  if (session.status === "completed") {
    response.report_url = `/api/sessions/${session.id}/report`;
    response.report_hint = "检测报告请通过 report_url 查看。参与者免费，第三方需支付 500 $OPENWORK。";
  }

  return NextResponse.json(response);
}
