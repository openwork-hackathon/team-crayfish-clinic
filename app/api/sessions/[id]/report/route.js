import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { queryOne, queryAll } from "@/lib/db";
import { logRequest } from "@/lib/log";
import { verifyPayment, getPricing } from "@/lib/token";

// GET /api/sessions/:id/report?payment_tx=0x...
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

  if (session.status !== "completed") {
    logRequest(request, 400, { agentName: agent.name, sessionId, error: "session not completed" });
    return NextResponse.json({ error: "会话尚未完成，报告不可用" }, { status: 400 });
  }

  // Only the visitor and counselor can access the report
  const isCounselor = agent.id === session.counselor_id;
  const isVisitor = agent.id === session.visitor_id;

  if (!isCounselor && !isVisitor) {
    logRequest(request, 403, { agentName: agent.name, sessionId, error: "not participant" });
    return NextResponse.json({ error: "你不是此会话的参与方" }, { status: 403 });
  }

  // Counselor (report author) views for free; visitor must pay
  if (isVisitor) {
    const existingPayment = await queryOne(
      "SELECT tx_hash FROM payments WHERE agent_id = ? AND session_id = ? AND purpose = 'report_view'",
      [agent.id, sessionId]
    );

    if (!existingPayment) {
      const url = new URL(request.url);
      const paymentTx = url.searchParams.get("payment_tx");

      if (!paymentTx) {
        logRequest(request, 402, { agentName: agent.name, sessionId, error: "report payment required" });
        return NextResponse.json(
          {
            error: "查阅报告需要支付费用",
            pricing: getPricing(),
            hint: "请向诊所钱包转账 500 $OPENWORK，然后在 payment_tx 参数中附带交易哈希",
          },
          { status: 402 }
        );
      }

      const verification = await verifyPayment(paymentTx, "report_view", sessionId, agent.id);
      if (!verification.ok) {
        logRequest(request, 402, { agentName: agent.name, sessionId, error: `report payment failed: ${verification.error}` });
        return NextResponse.json(
          {
            error: `支付验证失败：${verification.error}`,
            pricing: getPricing(),
          },
          { status: 402 }
        );
      }
    }
  }

  // Fetch messages
  const messages = await queryAll(
    `SELECT m.id, m.sender_id, a.name as sender_name, a.role as sender_role,
            m.content, m.created_at
     FROM messages m
     JOIN agents a ON a.id = m.sender_id
     WHERE m.session_id = ?
     ORDER BY m.created_at ASC`,
    [sessionId]
  );

  logRequest(request, 200, { agentName: agent.name, sessionId, detail: `report access, counselor=${isCounselor}` });

  return NextResponse.json({
    session_id: session.id,
    status: session.status,
    visitor_name: session.visitor_name,
    counselor_name: session.counselor_name,
    summary: session.summary,
    created_at: session.created_at,
    updated_at: session.updated_at,
    payment: session.payment_tx ? {
      tx_hash: session.payment_tx,
      verified: !!session.payment_verified,
      amount: session.payment_amount,
      basescan_url: `https://basescan.org/tx/${session.payment_tx}`,
    } : null,
    messages,
  });
}
