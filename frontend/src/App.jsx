import { useState } from 'react';
import { api, setAuthToken } from './api';
import Catalog from './Catalog';
import Dashboard from './Dashboard';

const styles = {
  root: { fontFamily: "'Segoe UI', system-ui, sans-serif", minHeight: '100vh', background: '#f4f6f9', margin: 0 },
  header: {
    background: 'linear-gradient(135deg, #1a1f36 0%, #2d3561 100%)',
    color: '#fff', padding: '1rem 2rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  },
  logo: { fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.5px', margin: 0 },
  badge: {
    background: '#4f8ef7', color: '#fff', fontSize: '0.65rem', fontWeight: 700,
    padding: '2px 8px', borderRadius: '999px', letterSpacing: '1px', textTransform: 'uppercase',
  },
  headerRight: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' },
  who: { opacity: 0.85 },
  nav: { display: 'flex', gap: '0.5rem', padding: '1.25rem 2rem 0' },
  tab: (active) => ({
    padding: '0.5rem 1.4rem', borderRadius: '999px', border: 'none', cursor: 'pointer',
    fontWeight: 600, fontSize: '0.9rem', transition: 'all 0.2s',
    background: active ? '#2d3561' : '#fff',
    color: active ? '#fff' : '#555',
    boxShadow: active ? '0 2px 8px rgba(45,53,97,0.3)' : '0 1px 3px rgba(0,0,0,0.1)',
  }),
  content: { padding: '1.5rem 2rem' },
  authCard: {
    background: '#fff', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  },
  authTitle: { fontWeight: 700, color: '#1a1f36', margin: '0 0 0.75rem', fontSize: '0.95rem' },
  authRow: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' },
  input: {
    padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #ddd',
    fontSize: '0.875rem', minWidth: '220px',
  },
  button: (variant) => ({
    padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontWeight: 600, fontSize: '0.85rem',
    background: variant === 'primary' ? '#2d3561' : '#e8eaf2',
    color: variant === 'primary' ? '#fff' : '#2d3561',
  }),
  ghostButton: {
    padding: '0.35rem 0.9rem', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.4)',
    background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
  },
  error: { background: '#fdecea', color: '#c62828', padding: '0.6rem 0.9rem', borderRadius: '8px', marginTop: '0.75rem', fontSize: '0.85rem' },
  note: { background: '#e8f5e9', color: '#2e7d32', padding: '0.6rem 0.9rem', borderRadius: '8px', marginTop: '0.75rem', fontSize: '0.85rem' },
};

// The user id the booking service stores comes from the token's `sub` claim,
// so the booking is tied to the account that was actually signed in.
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export default function App() {
  const [tab, setTab] = useState('catalog');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authNote, setAuthNote] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    setAuthError(null);
    setAuthNote(null);
    try {
      await action();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const handleRegister = () => run(async () => {
    const created = await api.register(email, password);
    setAuthNote(`Registered ${created.email}. Now sign in with the same details.`);
  });

  const handleLogin = () => run(async () => {
    const { token } = await api.login(email, password);
    setAuthToken(token);
    const payload = decodeJwt(token);
    setUser({ id: String(payload?.sub ?? ''), email: payload?.email ?? email });
    setPassword('');
  });

  function handleLogout() {
    setAuthToken(null);
    setUser(null);
    setPassword('');
    setAuthNote(null);
    setAuthError(null);
  }

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.logo}>🎟 EventHub</h1>
        <span style={styles.badge}>Live</span>
        {user && (
          <div style={styles.headerRight}>
            <span style={styles.who}>Signed in as {user.email}</span>
            <button style={styles.ghostButton} onClick={handleLogout}>Sign out</button>
          </div>
        )}
      </header>

      <nav style={styles.nav}>
        <button style={styles.tab(tab === 'catalog')} onClick={() => setTab('catalog')}>Catalog</button>
        <button style={styles.tab(tab === 'dashboard')} onClick={() => setTab('dashboard')}>Dashboard</button>
      </nav>

      <div style={styles.content}>
        {tab === 'catalog' && (
          <>
            {!user && (
              <div style={styles.authCard}>
                <h3 style={styles.authTitle}>👤 Register or sign in to book</h3>
                <div style={styles.authRow}>
                  <input
                    style={styles.input}
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                  <button style={styles.button()} disabled={busy} onClick={handleRegister}>Register</button>
                  <button style={styles.button('primary')} disabled={busy} onClick={handleLogin}>Sign in</button>
                </div>
                {authError && <div style={styles.error}>⚠️ {authError}</div>}
                {authNote && <div style={styles.note}>✅ {authNote}</div>}
              </div>
            )}

            <Catalog user={user} />
          </>
        )}

        {tab === 'dashboard' && <Dashboard />}
      </div>
    </div>
  );
}
