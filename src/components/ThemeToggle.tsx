'use client'

import { useEffect, useState } from 'react'
import Icon from './Icon'

type Theme = 'dark' | 'light'

// Dark leads, so an unset preference resolves to dark and the toggle only ever
// writes an explicit override. The inline script in the layout applies a stored
// value before first paint, and this component catches up after hydration.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark' || attr === 'light') {
      setTheme(attr)
      return
    }
    setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  }, [])

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('pe-theme', next)
    } catch {
      // Private browsing blocks writes. The toggle still works for this visit.
    }
  }

  return (
    <button
      type="button"
      className="chip"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 9px' }}
    >
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
    </button>
  )
}
