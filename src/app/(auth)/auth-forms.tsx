"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { loginAction, registerAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert } from "@/components/ui/misc";
import { brand } from "@/config/brand";

// The inputs are "controlled" (kept in state), so nothing you typed is cleared when the
// server sends back an error – you can check it with the eye button and fix it in place.

export function LoginForm({ redirectTo, demo }: { redirectTo?: string; demo: boolean }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="grid gap-4 w-full max-w-sm">
      <div className="mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo.full} alt={brand.name} height={40} className="h-10 w-auto lg:hidden mb-6" />
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back to {brand.name}.</p>
      </div>
      {state?.error && <Alert variant="danger">{state.error}</Alert>}
      <input type="hidden" name="redirectTo" value={redirectTo ?? "/dashboard"} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput id="password" name="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant="brand" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      {demo && (
        <Alert variant="info" title="Your sign-in">
          Email <code>demo@upvance.local</code>, password <code>demo12345</code>.
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link className="text-primary underline-offset-4 hover:underline" href="/register">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, undefined);
  const [tz, setTz] = useState("UTC");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  // Show the mismatch while typing once both boxes have text, or after a submit attempt.
  const showMismatch = mismatch || (tried && !confirm && !!password);
  const field = state?.field;

  return (
    <form
      action={action}
      onSubmit={(e) => {
        setTried(true);
        if (password !== confirm || password.length < 8) e.preventDefault(); // nothing is cleared
      }}
      className="grid gap-4 w-full max-w-sm"
      noValidate
    >
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-sm text-muted-foreground">Stored only in your local database.</p>
      </div>
      {state?.error && <Alert variant="danger">{state.error}</Alert>}
      <input type="hidden" name="timezone" value={tz} />
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={field === "name" || undefined} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={field === "email" || undefined} />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={tooShort && tried ? true : field === "password" || undefined} aria-describedby="password-msg" />
        {tooShort && tried && (
          <p id="password-msg" className="text-xs text-destructive" role="alert">
            Use at least 8 characters.
          </p>
        )}
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword">
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={showMismatch || field === "confirmPassword" || undefined} aria-describedby="confirm-msg" />
        {showMismatch && (
          <p id="confirm-msg" className="text-xs text-destructive" role="alert">
            {confirm ? "The passwords don't match – check them with the eye button and fix either one." : "Type the same password again to confirm it."}
          </p>
        )}
        {!mismatch && confirm.length > 0 && password.length >= 8 && <p className="text-xs text-emerald-600 dark:text-emerald-400">Passwords match.</p>}
      </Field>
      <Button type="submit" variant="brand" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="text-primary underline-offset-4 hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
