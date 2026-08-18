import { NextResponse } from "next/server";

export const OWNER_COOKIE = "clari_device_id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getOwnerId(currentValue?: string) {
  return currentValue && UUID_PATTERN.test(currentValue) ? currentValue : crypto.randomUUID();
}

export function attachOwnerCookie(response: NextResponse, ownerId: string, hadCookie: boolean) {
  if (!hadCookie) {
    response.cookies.set(OWNER_COOKIE, ownerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365 * 2,
      path: "/",
    });
  }
  return response;
}
