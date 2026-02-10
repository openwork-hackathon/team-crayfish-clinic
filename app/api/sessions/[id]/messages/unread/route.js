import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { execute, queryOne, queryAll } from "@/lib/db";
import { logRequest } from "@/lib/log";

// GET /api/sessions/:id/messages/unread — fetch and mark-read unread messages
export async function GET(request, { params }) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const agentId = agent.id;

  const session = await queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
  if (!session) {
    logRequest(request, 404, { agentName: agent.name, sessionId, error: "session not found" });
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  if (agentId !== session.visitor_id && agentId !== session.counselor_id) {
    logRequest(request, 403, { agentName: agent.name, sessionId, error: "not participant" });
    return NextResponse.json({ error: "你不是此会话的参与方" }, { status: 403 });
  }

  const unreadMessages = await queryAll(
    `SELECT id, sender_id, content, created_at
     FROM messages
     WHERE session_id = ? AND sender_id != ? AND is_read = 0
     ORDER BY created_at ASC`,
    [sessionId, agentId]
  );

  if (unreadMessages.length > 0) {
    await execute(
      "UPDATE messages SET is_read = 1 WHERE session_id = ? AND sender_id != ? AND is_read = 0",
      [sessionId, agentId]
    );
  }

  logRequest(request, 200, {
    agentName: agent.name,
    agentRole: agent.role,
    sessionId,
    detail: `unread=${unreadMessages.length}`,
  });

  return NextResponse.json({
    session_id: sessionId,
    session_status: session.status,
    messages: unreadMessages,
  });
}
