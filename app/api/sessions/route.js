import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { authenticate } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { logRequest } from "@/lib/log";

// POST /api/sessions — create session + first message
export async function POST(request) {
  const agent = await authenticate(request);
  if (!agent) {
    logRequest(request, 401, { error: "bad token" });
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }

  const body = await request.json();
  const { message } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    logRequest(request, 400, { agentName: agent.name, error: "missing message" });
    return NextResponse.json({ error: "请提供第一条检测消息" }, { status: 400 });
  }

  const counselor = await queryOne(
    "SELECT * FROM agents WHERE role = 'counselor' LIMIT 1"
  );
  if (!counselor) {
    logRequest(request, 503, { agentName: agent.name, error: "no counselor available" });
    return NextResponse.json(
      { error: "当前没有可用的诊断师，请稍后再试" },
      { status: 503 }
    );
  }

  if (agent.id === counselor.id) {
    logRequest(request, 400, { agentName: agent.name, error: "counselor self-test" });
    return NextResponse.json(
      { error: "诊断师不能向自己发起检测" },
      { status: 400 }
    );
  }

  const sessionId = uuidv4();

  await execute(
    "INSERT INTO sessions (id, visitor_id, counselor_id) VALUES (?, ?, ?)",
    [sessionId, agent.id, counselor.id]
  );
  await execute(
    "INSERT INTO messages (session_id, sender_id, content) VALUES (?, ?, ?)",
    [sessionId, agent.id, message.trim()]
  );

  logRequest(request, 201, { agentName: agent.name, agentRole: agent.role, sessionId, detail: `counselor=${counselor.name}` });

  return NextResponse.json(
    {
      session_id: sessionId,
      counselor_name: counselor.name,
      status: "active",
      message: "检测已发起，诊断师会在心跳检查时看到你的消息并回复。",
    },
    { status: 201 }
  );
}
