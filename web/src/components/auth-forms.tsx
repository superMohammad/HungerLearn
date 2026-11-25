"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { signInAction, signUpAction, type AuthState } from "@/app/actions";
import { useDict } from "@/components/i18n-provider";
import type { AuthErrorKey, DemoAccount } from "@/lib/accounts";
import { branchName } from "@/lib/i18n";
import { BRANCHES, ROLES } from "@/lib/types";

const EMPTY: AuthState = { fieldErrors: {}, form: null, values: {} };

const field =
  "mt-1.5 block min-h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none transition-colors placeholder:text-ink-soft/70 focus:border-brand aria-[invalid=true]:border-ember";

function FieldError({ id, error }: { id: string; error: AuthErrorKey | undefined }) {
  const t = useDict();
  return error === undefined ? null : (
    <p id={id} className="mt-1.5 text-sm font-medium text-ember">
      {t.auth.errors[error]}
    </p>
  );
}

function FormError({ error }: { error: AuthErrorKey | null }) {
  const t = useDict();
  return error === null ? null : (
    <p role="alert" className="rounded-2xl bg-ember-bg p-3 text-sm font-medium text-ember">
      {t.auth.errors[error]}
    </p>
  );
}

function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-12 w-full cursor-pointer rounded-2xl bg-accent px-5 text-lg font-bold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? busy : idle}
    </button>
  );
}

/** Email + password sign-in. Demo accounts fill the form in one tap (password managers and paste still work). */
export function SignInForm({ demoAccounts, demoPassword }: { demoAccounts: DemoAccount[]; demoPassword: string }) {
  const t = useDict();
  const [state, action, pending] = useActionState(signInAction, EMPTY);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  function fill(account: DemoAccount): void {
    if (email.current === null || password.current === null) return;
    email.current.value = account.email;
    password.current.value = demoPassword;
    password.current.focus();
  }

  return (
    <>
      <form action={action} className="grid gap-5" noValidate>
        <label className="block text-sm font-semibold">
          {t.auth.email}
          <input
            ref={email}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            required
            defaultValue={state.values.email}
            aria-invalid={state.fieldErrors.email !== undefined}
            aria-describedby="email-error"
            className={`${field} text-start`}
            placeholder="name@company.sa"
          />
          <FieldError id="email-error" error={state.fieldErrors.email} />
        </label>
        <label className="block text-sm font-semibold">
          {t.auth.password}
          <input
            ref={password}
            name="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            aria-invalid={state.fieldErrors.password !== undefined}
            aria-describedby="password-error"
            className={field}
          />
          <FieldError id="password-error" error={state.fieldErrors.password} />
        </label>
        <FormError error={state.form} />
        <SubmitButton pending={pending} idle={t.common.signIn} busy={t.auth.checking} />
        <p className="text-center text-sm text-ink-soft">
          {t.auth.noAccount}{" "}
          <Link href="/signup" className="font-bold text-brand underline-offset-4 hover:underline">
            {t.auth.createAccountLink}
          </Link>
        </p>
      </form>

      <section aria-labelledby="demo-accounts" className="mt-8 rounded-3xl border border-dashed border-line p-4">
        <h2 id="demo-accounts" className="text-sm font-bold">{t.auth.demoTitle}</h2>
        <p className="mt-1 text-xs text-ink-soft">{t.auth.demoBody}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {demoAccounts.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                onClick={() => fill(a)}
                className="flex min-h-12 w-full cursor-pointer flex-col items-start justify-center rounded-2xl bg-surface-2 px-3 py-2 text-start transition-colors hover:bg-accent/40"
              >
                <span className="text-sm font-semibold" dir="auto">{a.name}</span>
                <span className="text-xs text-ink-soft">
                  {a.role === null ? t.common.admin : `${t.labels.roleShort[a.role]} · ${a.branch === null ? "" : branchName(t, a.branch)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Learner self sign-up. Admin accounts are provisioned by the platform, not created here. */
export function SignUpForm() {
  const t = useDict();
  const [state, action, pending] = useActionState(signUpAction, EMPTY);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <fieldset>
        <legend className="text-sm font-semibold">{t.auth.roleLegend}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {ROLES.map((r) => (
            <label
              key={r}
              className="flex min-h-20 cursor-pointer flex-col justify-center rounded-2xl border-2 border-line bg-surface p-3 transition-colors hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-surface-2 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
            >
              <input type="radio" name="role" value={r} defaultChecked={state.values.role === r} className="sr-only" />
              <span className="font-bold">{t.auth.roleChoice[r].title}</span>
              <span className="mt-0.5 text-xs text-ink-soft">{t.auth.roleChoice[r].body}</span>
            </label>
          ))}
        </div>
        <FieldError id="role-error" error={state.fieldErrors.role} />
      </fieldset>
      <label className="block text-sm font-semibold">
        {t.auth.name}
        <input name="name" dir="auto" autoComplete="name" required defaultValue={state.values.name} aria-invalid={state.fieldErrors.name !== undefined} aria-describedby="name-error" className={field} />
        <FieldError id="name-error" error={state.fieldErrors.name} />
      </label>
      <label className="block text-sm font-semibold">
        {t.auth.branch}
        <select name="branch" required defaultValue={state.values.branch ?? ""} aria-invalid={state.fieldErrors.branch !== undefined} aria-describedby="branch-error" className={`${field} cursor-pointer`}>
          <option value="" disabled>
            {t.auth.chooseBranch}
          </option>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {branchName(t, b)}
            </option>
          ))}
        </select>
        <FieldError id="branch-error" error={state.fieldErrors.branch} />
      </label>
      <label className="block text-sm font-semibold">
        {t.auth.email}
        <input name="email" type="email" autoComplete="email" inputMode="email" dir="ltr" required defaultValue={state.values.email} aria-invalid={state.fieldErrors.email !== undefined} aria-describedby="email-error" className={`${field} text-start`} placeholder="name@company.sa" />
        <FieldError id="email-error" error={state.fieldErrors.email} />
      </label>
      <label className="block text-sm font-semibold">
        {t.auth.password}
        <input name="password" type="password" autoComplete="new-password" dir="ltr" required minLength={8} aria-invalid={state.fieldErrors.password !== undefined} aria-describedby="password-error password-hint" className={field} />
        <span id="password-hint" className="mt-1.5 block text-xs font-normal text-ink-soft">{t.auth.passwordHint}</span>
        <FieldError id="password-error" error={state.fieldErrors.password} />
      </label>
      <FormError error={state.form} />
      <SubmitButton pending={pending} idle={t.auth.createAccount} busy={t.auth.creating} />
      <p className="text-center text-sm text-ink-soft">
        {t.auth.haveAccount}{" "}
        <Link href="/signin" className="font-bold text-brand underline-offset-4 hover:underline">
          {t.auth.signInLink}
        </Link>
      </p>
    </form>
  );
}
