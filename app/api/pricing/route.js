import { NextResponse } from "next/server";
import { getPricing } from "@/lib/token";

// GET /api/pricing — public pricing information
export async function GET() {
  return NextResponse.json(getPricing());
}
