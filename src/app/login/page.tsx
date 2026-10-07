import { isAuthConfigured } from '@/lib/auth'
import Icon from '@/components/Icon'

const ERROR_COPY: Record<string, string> = {
  '1': 'That password is not right.',
  rate: 'Too many attempts. Wait a minute and try again.',
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string }
}) {
  const next = searchParams.next?.startsWith('/') ? searchParams.next : '/'
  const error = searchParams.error ? (ERROR_COPY[searchParams.error] ?? 'Sign in failed.') : null

  if (!isAuthConfigured()) {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1 className="login-title">Pulse Engine</h1>
          <p className="login-note">
            No site password is set, so nothing will load. Set <code>APP_PASSWORD</code> and{' '}
            <code>SESSION_SECRET</code> in the environment, then redeploy.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="login-page">
      <form className="login-card" action="/api/auth/login" method="POST">
        <h1 className="login-title">Pulse Engine</h1>
        <p className="login-note">Enter the site password to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          className="field"
          placeholder="Password"
          aria-label="Site password"
          autoFocus
          required
        />
        {error && (
          <p className="login-error">
            <Icon name="alert" size={14} />
            {error}
          </p>
        )}
        <button type="submit" className="btn" style={{ width: '100%' }}>
          Continue
        </button>
      </form>
    </main>
  )
}
