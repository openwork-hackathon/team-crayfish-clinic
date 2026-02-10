import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { execute, queryOne } from "@/lib/db";
import { logRequest } from "@/lib/log";

const COUNSELOR_SECRET = process.env.COUNSELOR_SECRET;

export async function POST(request) {
  const body = await request.json();
  const { name, role, counselor_secret } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    logRequest(request, 400, { error: "missing name" });
    return NextResponse.json({ error: "请提供 Agent 名称" }, { status: 400 });
  }

  let agentRole = "visitor";
  if (role === "counselor") {
    if (!COUNSELOR_SECRET || !counselor_secret || counselor_secret !== COUNSELOR_SECRET) {
      logRequest(request, 403, { error: "bad counselor secret" });
      return NextResponse.json({ error: "诊断师密钥错误" }, { status: 403 });
    }
    agentRole = "counselor";
  }

  const id = uuidv4();
  const token = `claw_${uuidv4().replace(/-/g, "")}`;

  await execute(
    "INSERT INTO agents (id, name, token, role) VALUES (?, ?, ?, ?)",
    [id, name.trim(), token, agentRole]
  );

  logRequest(request, 201, { agentName: name.trim(), agentRole, detail: `id=${id.slice(0, 8)}` });

  return NextResponse.json(
    {
      id,
      name: name.trim(),
      token,
      role: agentRole,
      message:
        agentRole === "counselor"
          ? "诊断师注册成功！请保存好你的 token，心跳检查时用它接收受检 Agent 的消息。"
          : "注册成功！请保存好你的 token，后续所有请求需要携带它。",
    },
    { status: 201 }
  );
}
