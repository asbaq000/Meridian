'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Button, Card, Field, Input, Notice } from '@/components/ui';

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-2 mb-8 text-3xl">Sign in</h1>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? (
            <Notice tone="error" title="Could not sign in">
              {error}
            </Notice>
          ) : null}
          <Button type="submit" variant="brass" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-sm text-slate">
        No account?{' '}
        <Link href="/register" className="font-medium text-ink underline underline-offset-4">
          Create one
        </Link>
      </p>

      <div className="mt-8 border-t border-rule pt-6">
        <p className="eyebrow mb-2">Seeded demo accounts</p>
        <ul className="tabular space-y-1 text-[12px] text-slate">
          <li>admin@booking.test — admin, Berlin</li>
          <li>nadia@booking.test — provider, Berlin</li>
          <li>sam@booking.test — customer, Los Angeles</li>
        </ul>
        <p className="mt-2 text-xs text-slate-soft">Password for all: password123</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
