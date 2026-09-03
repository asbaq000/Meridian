'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Button, Card, Field, Input, Notice, SelectField } from '@/components/ui';
import { browserTimezone, offsetLabel, timezoneOptions, zoneCity } from '@/lib/time';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    // Starts at UTC on both runtimes so the server HTML and the first client
    // render agree; the browser's real zone is detected on mount, below.
    timezone: 'UTC',
  });

  // Detected, not assumed: pre-filled but editable, because a wrong timezone
  // here is the one setting that quietly ruins everything.
  useEffect(() => {
    setForm((f) => ({ ...f, timezone: browserTimezone() }));
  }, []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      router.push('/');
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <p className="label mb-3">Takes a minute</p>
      <h1 className="display mb-8 text-[40px]">
        Create your
        <br />
        <strong>account.</strong>
      </h1>

      <Card className="settle p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name">
            <Input required value={form.name} onChange={set('name')} placeholder="Sam Rivera" />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={set('email')}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          <Field
            label="Your timezone"
            hint="Every time you see is converted into this. Change it any time."
          >
            <SelectField value={form.timezone} onChange={set('timezone')}>
              {timezoneOptions([form.timezone]).map((tz) => (
                <option key={tz} value={tz}>
                  {zoneCity(tz)} · {offsetLabel(tz)}
                </option>
              ))}
            </SelectField>
          </Field>
          {error ? (
            <Notice tone="error" title="Could not create the account">
              {error}
            </Notice>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-sm text-ash">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
