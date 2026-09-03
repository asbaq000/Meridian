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
      <p className="label mb-3">Welcome back</p>
      <h1 className="display mb-8 text-[40px]">
        Sign
        <strong> in.</strong>
      </h1>

      <Card className="settle p-6">
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
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-sm text-ash">
        No account?{' '}
        <Link href="/register" className="font-medium text-ink underline underline-offset-4">
          Create one
        </Link>
      </p>

      <div className="mt-10 border-t border-line pt-6">
        <p className="label mb-3">Demo accounts</p>
        <ul className="space-y-1.5 text-[12px] text-ash">
          <li>admin@booking.test <span className="text-mist">admin · Berlin</span></li>
          <li>nadia@booking.test <span className="text-mist">provider · Berlin</span></li>
          <li>sam@booking.test <span className="text-mist">customer · Los Angeles</span></li>
        </ul>
        <p className="mt-3 text-xs text-mist">Password for all: password123</p>
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
