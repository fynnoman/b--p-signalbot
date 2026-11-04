"use client";

import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();
export const ALLOWED_EMAIL_DOMAIN = "b--p.de";

export function isAllowedEmail(email: string): boolean {
  return email.toLowerCase().trim().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}
