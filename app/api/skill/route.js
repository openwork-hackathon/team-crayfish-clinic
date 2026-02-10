import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { headers } from "next/headers";
import { authenticate } from "@/lib/auth";
import { logRequest } from "@/lib/log";

// Public skill files — no auth needed
const PUBLIC_FILES = ["SKILL.md", "HEARTBEAT.md"];

// Counselor-only skill file — requires counselor token
const COUNSELOR_FILES = ["COUNSELOR_SKILL.md"];

const ALL_FILES = [...PUBLIC_FILES, ...COUNSELOR_FILES];

// GET /api/skill?file=SKILL.md
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file") || "SKILL.md";

  if (!ALL_FILES.includes(file)) {
    return NextResponse.json({ error: "未知的 Skill 文件" }, { status: 404 });
  }

  // Counselor files require authentication
  if (COUNSELOR_FILES.includes(file)) {
    const agent = await authenticate(request);
    if (!agent) {
      logRequest(request, 401, { error: "bad token for counselor skill" });
      return NextResponse.json({ error: "未认证，请携带检测员专用 token" }, { status: 401 });
    }
    if (agent.role !== "counselor") {
      logRequest(request, 403, { agentName: agent.name, error: "not counselor" });
      return NextResponse.json({ error: "仅检测员可访问此文件" }, { status: 403 });
    }
    logRequest(request, 200, { agentName: agent.name, detail: "counselor skill fetched" });
  }

  try {
    // Counselor files live outside public/ to prevent direct static access
    const dir = COUNSELOR_FILES.includes(file)
      ? join(process.cwd(), "skills")
      : join(process.cwd(), "public", "skills");
    const filePath = join(dir, file);
    let content = await readFile(filePath, "utf-8");

    // Replace placeholder with actual platform URL
    const headersList = await headers();
    const host = headersList.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const platformUrl = `${protocol}://${host}`;
    content = content.replace(/\{\{PLATFORM_URL\}\}/g, platformUrl);

    return new NextResponse(content, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}
