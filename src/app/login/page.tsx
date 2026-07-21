import { isAuthConfigured } from '@/lib/auth'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string }
}) {
  const next = searchParams.next && searchParams.next.startsWith('/') ? searchParams.next : '/'

  if (!isAuthConfigured()) {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1 className="login-title">Health Tracker</h1>
          <p className="muted">
            Site password isn&apos;t configured yet. Set <code>APP_PASSWORD</code> and{' '}
            <code>SESSION_SECRET</code> in the environment, then redeploy.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="login-page">
      <form className="login-card" action="/api/auth/login" method="POST">
        <h1 className="login-title">Health Tracker</h1>
        <p className="muted">Enter the site password to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          className="login-input"
        />
        {searchParams.error && <p className="login-error">Incorrect password.</p>}
        <button type="submit" className="btn login-submit">
          Continue
        </button>
      </form>
    </main>
  )
}
