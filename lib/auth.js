import { queryOne } from "./db";

/**
 * Authenticate a request by Bearer token.
 * Returns the agent row or null.
 */
export async function authenticate(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  const agent = await queryOne("SELECT * FROM agents WHERE token = ?", [token]);
  return agent || null;
}
