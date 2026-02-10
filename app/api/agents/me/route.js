import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { logRequest } from "@/lib/log";

export async function GET(request) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  const { id, name, role, created_at, last_heartbeat } = agent;
  logRequest(request, 200, { agentName: name, agentRole: role });
  return NextResponse.json({ id, name, role, created_at, last_heartbeat });
}
