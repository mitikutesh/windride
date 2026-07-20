/**
 * Auth adapter types (WR-039). WindRide talks to Amazon Cognito directly from the browser via the
 * Cognito IDP JSON API (USER_PASSWORD_AUTH) — no AWS SDK, no server proxy. The pool id + public
 * client id are app config (VITE_ env), not secrets. Wrapped behind this interface so the app never
 * depends on Cognito directly and an alternative provider (Supabase/Clerk, DEC-041) could slot in.
 */

export interface Session {
  idToken: string;
  accessToken: string;
  /** Refresh token — long-lived; used to mint fresh access/id tokens without re-entering a password. */
  refreshToken: string;
  /** Epoch ms when the access/id tokens expire. */
  expiresAt: number;
  email: string;
}

export interface AuthClient {
  /** Register a new user; Cognito emails a verification code. */
  signUp(email: string, password: string): Promise<void>;
  /** Confirm a registration with the emailed code. */
  confirmSignUp(email: string, code: string): Promise<void>;
  /** Re-send the sign-up confirmation code. */
  resendConfirmationCode(email: string): Promise<void>;
  /** Sign in with email + password, returning a fresh session. */
  signIn(email: string, password: string): Promise<Session>;
  /** Exchange a refresh token for fresh access/id tokens (the refresh token is reused). */
  refresh(refreshToken: string, email: string): Promise<Session>;
  /** Start a password reset — Cognito emails a code. */
  forgotPassword(email: string): Promise<void>;
  /** Complete a password reset with the emailed code + a new password. */
  confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void>;
}
