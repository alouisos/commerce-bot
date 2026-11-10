"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setMessage(null);
    if (token) {
      const { error } = await authClient.resetPassword({
        newPassword: String(form.get("password")),
        token,
      });
      setPending(false);
      if (error) return setError(error.message ?? "Could not reset password");
      setMessage("Your password has been changed. You can now sign in.");
    } else {
      const { error } = await authClient.requestPasswordReset({
        email: String(form.get("email")),
        redirectTo: "/reset-password",
      });
      setPending(false);
      if (error) return setError(error.message ?? "Could not send reset email");
      setMessage("If an account exists for that email, a reset link is on its way.");
    }
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-5 text-3xl">{token ? "Choose a new password" : "Reset your password"}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {token ? (
          <label className="flex flex-col gap-1">
            New password (at least 10 characters)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
             
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button type="submit" disabled={pending} className="btn-primary">
          {token ? "Set new password" : "Send reset link"}
        </button>
      </form>
      <p className="mt-4">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
