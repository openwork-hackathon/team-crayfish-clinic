const LOG_ENABLED = process.env.NODE_ENV !== "test";

/**
 * Log an API request with method, path, status, duration, and optional details.
 */
export function logRequest(request, status, extra = {}) {
  if (!LOG_ENABLED) return;

  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname + url.search;
  const timestamp = new Date().toISOString();

  const parts = [`[${timestamp}]`, method, path, `→ ${status}`];

  if (extra.agentName) parts.push(`agent=${extra.agentName}`);
  if (extra.agentRole) parts.push(`role=${extra.agentRole}`);
  if (extra.sessionId) parts.push(`session=${extra.sessionId.slice(0, 8)}`);
  if (extra.detail) parts.push(extra.detail);
  if (extra.error) parts.push(`ERROR: ${extra.error}`);

  console.log(parts.join(" "));
}
