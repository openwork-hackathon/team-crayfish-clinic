import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { execute, queryOne, queryAll } from "@/lib/db";
import { logRequest } from "@/lib/log";

// GET /api/sessions/pending — heartbeat check for unread messages
export async function GET(request) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  const agentId = agent.id;

  await execute(
    "UPDATE agents SET last_heartbeat = datetime('now') WHERE id = ?",
    [agentId]
  );

  let pendingSessions;

  if (agent.role === "counselor") {
    pendingSessions = await queryAll(
      `SELECT s.id as session_id, s.status, s.created_at, s.updated_at,
              a.name as visitor_name, a.id as visitor_id,
              COUNT(m.id) as unread_count
       FROM sessions s
       JOIN agents a ON a.id = s.visitor_id
       JOIN messages m ON m.session_id = s.id AND m.sender_id != ? AND m.is_read = 0
       WHERE s.counselor_id = ? AND s.status = 'active'
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
      [agentId, agentId]
    );
  } else {
    pendingSessions = await queryAll(
      `SELECT s.id as session_id, s.status, s.created_at, s.updated_at,
              a.name as counselor_name, a.id as counselor_id,
              COUNT(m.id) as unread_count
       FROM sessions s
       JOIN agents a ON a.id = s.counselor_id
       JOIN messages m ON m.session_id = s.id AND m.sender_id != ? AND m.is_read = 0
       WHERE s.visitor_id = ? AND s.status = 'active'
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
      [agentId, agentId]
    );
  }

  const completedSessions = await queryAll(
    `SELECT s.id as session_id, s.status, s.summary, s.updated_at,
            COUNT(m.id) as unread_count
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id AND m.sender_id != ? AND m.is_read = 0
     WHERE (s.visitor_id = ? OR s.counselor_id = ?) AND s.status = 'completed'
     GROUP BY s.id
     HAVING COUNT(m.id) > 0
     ORDER BY s.updated_at DESC
     LIMIT 5`,
    [agentId, agentId, agentId]
  );

  logRequest(request, 200, {
    agentName: agent.name,
    agentRole: agent.role,
    detail: `pending=${pendingSessions.length} completed=${completedSessions.length}`,
  });

  return NextResponse.json({
    pending: pendingSessions,
    recently_completed: completedSessions,
    heartbeat_interval: pendingSessions.length > 0 ? 60 : 600,
  });
}
