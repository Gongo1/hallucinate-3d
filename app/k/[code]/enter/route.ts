import { NextResponse, type NextRequest } from "next/server";
import { KEY_CODE_RE, KEY_COOKIE, KEY_MAX_AGE } from "@/lib/members/auth";
import { keyInfo } from "@/lib/members/store";

// Leave the key at the door (a short-lived httpOnly cookie the door reads), then
// go to the bar. The key is only spent on the knock. A bad or used code just
// lands on the normal door: never an error page.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const res = NextResponse.redirect(new URL("/", req.url));
  if (KEY_CODE_RE.test(code) && (await keyInfo(code).catch(() => null))) {
    res.cookies.set(KEY_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: KEY_MAX_AGE,
    });
  }
  return res;
}
