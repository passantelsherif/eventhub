// Run with: mongosh eventhub_bookings db-seed/mongo-seed.js
// Seeds bookings (spread over last 7 days) and reviews with sentiment data
// so the analytics dashboard has real data on first run.
//
// The MongoDB volume outlives a container teardown, so this script removes its
// own documents before inserting: re-running run-all.sh must not stack another
// copy of the seed on top of the previous one.

const now = new Date();
const daysAgo = (n) => new Date(now - n * 86400000).toISOString();

const bookings = [
  { id: "seed-1", userId: "demo-user",    eventId: 1, status: "confirmed", createdAt: daysAgo(6) },
  { id: "seed-2", userId: "demo-user",    eventId: 2, status: "confirmed", createdAt: daysAgo(5) },
  { id: "seed-3", userId: "another-user", eventId: 3, status: "confirmed", createdAt: daysAgo(4) },
  { id: "seed-4", userId: "another-user", eventId: 1, status: "confirmed", createdAt: daysAgo(3) },
  { id: "seed-5", userId: "demo-user",    eventId: 4, status: "confirmed", createdAt: daysAgo(2) },
  { id: "seed-6", userId: "another-user", eventId: 2, status: "confirmed", createdAt: daysAgo(1) },
  { id: "seed-7", userId: "demo-user",    eventId: 3, status: "confirmed", createdAt: daysAgo(0) },
];

const reviews = [
  { id: "rev-1", bookingId: "seed-1", eventId: 1, text: "Amazing event, loved it!",         sentiment: "positive", summary: "Very positive experience", createdAt: daysAgo(5) },
  { id: "rev-2", bookingId: "seed-2", eventId: 2, text: "It was alright, nothing special.", sentiment: "neutral",  summary: "Average experience",       createdAt: daysAgo(4) },
  { id: "rev-3", bookingId: "seed-3", eventId: 3, text: "Loved every moment of it!",        sentiment: "positive", summary: "Highly positive",          createdAt: daysAgo(3) },
  { id: "rev-4", bookingId: "seed-4", eventId: 1, text: "Not what I expected at all.",      sentiment: "negative", summary: "Disappointing",            createdAt: daysAgo(2) },
  { id: "rev-5", bookingId: "seed-5", eventId: 4, text: "Great concert, would go again!",   sentiment: "positive", summary: "Excellent experience",     createdAt: daysAgo(1) },
];

// Only seed documents are removed — bookings and reviews created through the
// API are left untouched.
db.bookings.deleteMany({ id: { $in: bookings.map((b) => b.id) } });
db.reviews.deleteMany({ id: { $in: reviews.map((r) => r.id) } });

db.bookings.insertMany(bookings);
db.reviews.insertMany(reviews);

print(
  `seeded ${bookings.length} bookings and ${reviews.length} reviews ` +
  `(collections now hold ${db.bookings.countDocuments({})} / ${db.reviews.countDocuments({})})`
);
