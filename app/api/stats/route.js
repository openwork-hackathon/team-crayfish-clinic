import { NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db";

// GET /api/stats
export async function GET() {
  const agentCount = (await queryOne("SELECT COUNT(*) as count FROM agents"))?.count || 0;
  const sessionCount = (await queryOne("SELECT COUNT(*) as count FROM sessions"))?.count || 0;
  const completedCount = (await queryOne("SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'"))?.count || 0;
  const activeCount = (await queryOne("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'"))?.count || 0;
  const messageCount = (await queryOne("SELECT COUNT(*) as count FROM messages"))?.count || 0;

  const recentAgents = await queryAll(
    "SELECT name, role, created_at FROM agents ORDER BY created_at DESC LIMIT 10"
  );

  return NextResponse.json({
    agents: agentCount,
    sessions: { total: sessionCount, active: activeCount, completed: completedCount },
    messages: messageCount,
    recent_agents: recentAgents,
  });
}
