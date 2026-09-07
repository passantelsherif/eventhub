import { useEffect, useState } from 'react';
import { api } from './api';

const SENTIMENT_STYLE = {
  positive: { background: '#e8f5e9', color: '#2e7d32', label: '😊 Positive' },
  neutral:  { background: '#f5f5f5', color: '#666',    label: '😐 Neutral'  },
  negative: { background: '#fdecea', color: '#c62828', label: '😞 Negative' },
};

const s = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' },
  card: {
    background: '#fff', borderRadius: '12px', padding: '1.25rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)', transition: 'transform 0.15s, box-shadow 0.15s',
    display: 'flex', flexDirection: 'column', gap: '0.75rem',
  },
  cardTitle: { fontWeight: 600, fontSize: '1rem', margin: 0, color: '#1a1f36' },
  cardFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
  priceBadge: (free) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
    background: free ? '#e8f5e9' : '#e8f0fe', color: free ? '#2e7d32' : '#1a73e8',
  }),
  bookBtn: (enabled) => ({
    padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '0.82rem',
    cursor: enabled ? 'pointer' : 'not-allowed',
    background: enabled ? '#2d3561' : '#e8eaf2',
    color: enabled ? '#fff' : '#9aa',
  }),
  sectionTitle: { fontWeight: 700, color: '#1a1f36', margin: '2rem 0 0.25rem', fontSize: '1rem' },
  hint: { color: '#888', fontSize: '0.82rem', margin: '0 0 1rem' },
  bookingCard: {
    background: '#fff', borderRadius: '12px', padding: '1.1rem 1.25rem', marginBottom: '0.85rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  },
  bookingHead: { display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' },
  bookingTitle: { fontWeight: 600, color: '#1a1f36', fontSize: '0.95rem' },
  confirmed: {
    background: '#e8f5e9', color: '#2e7d32', fontSize: '0.7rem', fontWeight: 700,
    padding: '2px 8px', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  bookingId: { color: '#aaa', fontSize: '0.75rem', fontFamily: 'monospace' },
  reviewRow: { display: 'flex', gap: '0.6rem', marginTop: '0.75rem', flexWrap: 'wrap' },
  reviewInput: {
    flex: '1 1 320px', padding: '0.5rem 0.75rem', borderRadius: '8px',
    border: '1px solid #ddd', fontSize: '0.85rem', fontFamily: 'inherit',
  },
  reviewBtn: {
    padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontWeight: 600, fontSize: '0.82rem', background: '#4f8ef7', color: '#fff',
  },
  result: (sentiment) => ({
    marginTop: '0.75rem', padding: '0.7rem 0.9rem', borderRadius: '8px', fontSize: '0.85rem',
    background: (SENTIMENT_STYLE[sentiment] || SENTIMENT_STYLE.neutral).background,
    color: (SENTIMENT_STYLE[sentiment] || SENTIMENT_STYLE.neutral).color,
  }),
  error: { background: '#fdecea', color: '#c62828', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' },
  loading: { color: '#888', padding: '2rem', textAlign: 'center' },
};

export default function Catalog({ user }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    api.catalog()
      .then(setCatalog)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function updateBooking(id, changes) {
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...changes } : b)));
  }

  async function book(event) {
    setError(null);
    try {
      const booking = await api.book(user.id, event.id);
      setBookings((prev) => [
        { id: booking.id, title: event.title, text: '', review: null, busy: false, error: null },
        ...prev,
      ]);
    } catch (err) {
      setError(`Booking failed: ${err.message}`);
    }
  }

  async function submitReview(booking) {
    if (!booking.text.trim()) return;
    updateBooking(booking.id, { busy: true, error: null });
    try {
      const review = await api.review(booking.id, booking.text);
      updateBooking(booking.id, { review, busy: false });
    } catch (err) {
      updateBooking(booking.id, { busy: false, error: err.message });
    }
  }

  const isFree = (price) => price === 0 || price === '0.00';

  return (
    <>
      {error && <div style={s.error}>⚠️ {error}</div>}
      {loading && <p style={s.loading}>Loading events...</p>}

      <div style={s.grid}>
        {catalog.map((event) => (
          <div key={event.id} style={s.card}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)'; }}
          >
            <p style={s.cardTitle}>{event.title}</p>
            <div style={s.cardFoot}>
              <span style={s.priceBadge(isFree(event.price))}>
                {isFree(event.price) ? 'Free' : `$${event.price}`}
              </span>
              <button
                style={s.bookBtn(Boolean(user))}
                disabled={!user}
                title={user ? '' : 'Sign in first'}
                onClick={() => book(event)}
              >
                {user ? 'Book' : 'Sign in to book'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {bookings.length > 0 && (
        <>
          <h3 style={s.sectionTitle}>🎫 Your bookings this session</h3>
          <p style={s.hint}>
            Each booking published a message the notification worker consumed. Leave a review and the
            AI Insight service scores it — then re-run the analytics job to see it on the dashboard.
          </p>
          {bookings.map((booking) => (
            <div key={booking.id} style={s.bookingCard}>
              <div style={s.bookingHead}>
                <span style={s.bookingTitle}>{booking.title}</span>
                <span style={s.confirmed}>Confirmed</span>
                <span style={s.bookingId}>{booking.id}</span>
              </div>

              {booking.review ? (
                <div style={s.result(booking.review.sentiment)}>
                  <strong>{(SENTIMENT_STYLE[booking.review.sentiment] || SENTIMENT_STYLE.neutral).label}</strong>
                  {' — '}{booking.review.summary}
                </div>
              ) : (
                <div style={s.reviewRow}>
                  <input
                    style={s.reviewInput}
                    placeholder="How was it? Write a review..."
                    value={booking.text}
                    onChange={(e) => updateBooking(booking.id, { text: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && submitReview(booking)}
                  />
                  <button style={s.reviewBtn} disabled={booking.busy} onClick={() => submitReview(booking)}>
                    {booking.busy ? 'Analyzing...' : 'Submit review'}
                  </button>
                </div>
              )}

              {booking.error && <div style={s.result('negative')}>⚠️ {booking.error}</div>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
