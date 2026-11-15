// Business rules shared by the backend apps.
// lemmido_frontend keeps its own copy of the ones it needs (src/lib/booking-dates.ts).

// Services have to be booked at least this long before they start
export const MIN_NOTICE_HOURS = 48;

// A day with this many open bookings is full and can't be booked
export const MAX_BOOKINGS_PER_DAY = 5;

// Booking days are counted in India time, whatever the server's timezone
export const BUSINESS_TIMEZONE = "Asia/Kolkata";
