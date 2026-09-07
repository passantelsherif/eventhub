import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from './api';

const SENTIMENT_COLORS = { positive: '#1D9E75', neutral: '#888780', negative: '#D85A30' };

const s = {
  error:    { background: '#fdecea', color: '#c62828', padding: '0.75rem 1rem', borderRadius: '8px' },
  loading:  { color: '#888', textAlign: 'center', padding: '3rem' },
  meta:     { color: '#999', fontSize: '0.8rem', marginBottom: '1.25rem' },
  statsRow: { display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' },
  statCard: (color) => ({
    flex: '1 1 140px', background: '#fff', borderRadius: '12px', padding: '1rem 1.25rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color}`,
  }),
  statVal:   { fontSize: '1.6rem', fontWeight: 700, color: '#1a1f36', margin: '0 0 0.2rem' },
  statLabel: { fontSize: '0.75rem', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  chartsRow: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' },
  chartCard: { flex: '1 1 320px', background: '#fff', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' },
  chartTitle:{ fontWeight: 700, color: '#1a1f36', margin: '0 0 1rem', fontSize: '0.95rem' },
  tableCard: { background: '#fff', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' },
  tableTitle:{ fontWeight: 700, color: '#1a1f36', margin: '0 0 0.75rem', fontSize: '0.95rem' },
  search:    { padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '0.75rem', width: '220px', fontSize: '0.85rem' },
  table:     { borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' },
  th:        (active) => ({
    padding: '0.6rem 0.75rem', cursor: 'pointer', textAlign: 'left', userSelect: 'none',
    borderBottom: '2px solid #e8e8e8', color: active ? '#2d3561' : '#666',
    fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
  }),
  td:        { padding: '0.65rem 0.75rem', borderBottom: '1px solid #f0f0f0', color: '#333' },
  sentBadge: (s) => ({
    display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
    background: s > 0.2 ? '#e8f5e9' : s < -0.2 ? '#fdecea' : '#f5f5f5',
    color:      s > 0.2 ? '#2e7d32' : s < -0.2 ? '#c62828' : '#666',
  }),
  emptyRow:  { color: '#aaa', padding: '1.5rem 0.75rem', fontStyle: 'italic', fontSize: '0.875rem' },
};

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [sortKey, setSortKey]   = useState('bookingsCount');
  const [sortDir, setSortDir]   = useState('desc');

  useEffect(() => {
    api.analyticsSummary().then(setSnapshot).catch((err) => setError(err.message));
  }, []);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    const filtered = snapshot.eventsTable.filter((r) =>
      r.title.toLowerCase().includes(search.toLowerCase())
    );
    return [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      return a[sortKey] > b[sortKey] ? dir : a[sortKey] < b[sortKey] ? -dir : 0;
    });
  }, [snapshot, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  if (error)    return <div style={s.error}>⚠️ Failed to load analytics: {error}</div>;
  if (!snapshot) return <p style={s.loading}>⏳ Loading analytics...</p>;

  const sentimentData = Object.entries(snapshot.sentimentTotals)
    .map(([name, value]) => ({ name, value }))
    .filter(d => d.value > 0);

  const totalBookings = snapshot.eventsTable.reduce((sum, r) => sum + r.bookingsCount, 0);
  const totalRevenue  = snapshot.eventsTable.reduce((sum, r) => sum + r.revenue, 0);
  const totalReviews  = snapshot.eventsTable.reduce((sum, r) => sum + r.reviewCount, 0);

  const columns = [
    { key: 'title',            label: 'Event'        },
    { key: 'bookingsCount',    label: 'Bookings'     },
    { key: 'revenue',          label: 'Revenue'      },
    { key: 'reviewCount',      label: 'Reviews'      },
    { key: 'avgSentimentScore',label: 'Sentiment'    },
  ];

  return (
    <div>
      <p style={s.meta}>Last generated: {new Date(snapshot.generatedAt).toLocaleString()}</p>

      {/* ── Stat summary cards ── */}
      <div style={s.statsRow}>
        <div style={s.statCard('#4f8ef7')}>
          <div style={s.statVal}>{snapshot.eventsTable.length}</div>
          <div style={s.statLabel}>Events</div>
        </div>
        <div style={s.statCard('#1D9E75')}>
          <div style={s.statVal}>{totalBookings}</div>
          <div style={s.statLabel}>Total Bookings</div>
        </div>
        <div style={s.statCard('#f7a44f')}>
          <div style={s.statVal}>${totalRevenue.toFixed(2)}</div>
          <div style={s.statLabel}>Total Revenue</div>
        </div>
        <div style={s.statCard('#9c6ef7')}>
          <div style={s.statVal}>{totalReviews}</div>
          <div style={s.statLabel}>Reviews</div>
        </div>
      </div>

      {/* ── Charts ── */}
      <div style={s.chartsRow}>
        <div style={s.chartCard}>
          <h3 style={s.chartTitle}>📈 Bookings over time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={snapshot.bookingsTimeseries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="bookings" stroke="#4f8ef7" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ ...s.chartCard, flex: '0 1 280px' }}>
          <h3 style={s.chartTitle}>🧠 Review sentiment</h3>
          {sentimentData.length === 0
            ? <p style={{ color: '#aaa', textAlign: 'center', paddingTop: '3rem' }}>No reviews yet</p>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={sentimentData} dataKey="value" nameKey="name" outerRadius={75} innerRadius={35}>
                    {sentimentData.map((entry) => (
                      <Cell key={entry.name} fill={SENTIMENT_COLORS[entry.name] || '#888'} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={10} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )
          }
        </div>
      </div>

      {/* ── Events table ── */}
      <div style={s.tableCard}>
        <h3 style={s.tableTitle}>📋 Events</h3>
        <input
          placeholder="🔍 Filter by event title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.search}
        />
        <table style={s.table}>
          <thead>
            <tr>
              {columns.map(({ key, label }) => (
                <th key={key} style={s.th(sortKey === key)} onClick={() => toggleSort(key)}>
                  {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={s.emptyRow}>No events match your filter.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.eventId}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbff'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={s.td}>{row.title}</td>
                <td style={s.td}>{row.bookingsCount}</td>
                <td style={s.td}>${row.revenue.toFixed(2)}</td>
                <td style={s.td}>{row.reviewCount}</td>
                <td style={s.td}>
                  <span style={s.sentBadge(row.avgSentimentScore)}>
                    {row.avgSentimentScore > 0.2 ? '😊 Positive' : row.avgSentimentScore < -0.2 ? '😞 Negative' : '😐 Neutral'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

