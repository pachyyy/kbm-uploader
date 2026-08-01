import { createHmac, timingSafeEqual } from "crypto";

export const AUTH_COOKIE = "kbm_auth";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Token proves the holder knew APP_PASSWORD at issuance time, without storing the password itself in the cookie. */
export function issueAuthToken(): string {
  const secret = process.env.APP_PASSWORD;
  if (!secret) throw new Error("APP_PASSWORD is not configured.");
  return sign("kbm-uploader", secret);
}

export function verifyAuthToken(token: string | undefined): boolean {
  const secret = process.env.APP_PASSWORD;
  if (!secret || !token) return false;
  const expected = sign("kbm-uploader", secret);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
