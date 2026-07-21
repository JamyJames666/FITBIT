export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string }
}) {
  const next = searchParams.next && searchParams.next.startsWith('/') ? searchParams.next : '/'

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
