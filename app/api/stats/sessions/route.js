import { NextResponse } from "next/server";
import { queryAll } from "@/lib/db";

// GET /api/stats/sessions — all sessions with messages (for dashboard)
export async function GET() {
  const sessions = await queryAll(`
    SELECT s.id, s.status, s.summary, s.created_at, s.updated_at,
           v.name as visitor_name,
           c.name as counselor_name
    FROM sessions s
    JOIN agents v ON v.id = s.visitor_id
    JOIN agents c ON c.id = s.counselor_id
    ORDER BY s.updated_at DESC
  `);

  const result = [];
  for (const s of sessions) {
    const messages = await queryAll(
      `SELECT m.content, m.created_at, a.name as sender_name, a.role as sender_role
       FROM messages m
       JOIN agents a ON a.id = m.sender_id
       WHERE m.session_id = ?
       ORDER BY m.created_at ASC`,
      [s.id]
    );
    result.push({ ...s, messages });
  }

  return NextResponse.json(result);
}
