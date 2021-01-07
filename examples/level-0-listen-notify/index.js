// This example demonstrates the basics of pg listen/notify.

import db from "../../db.js";

// Subscribe to pg_notify notifications.
db.on("notification", ({ channel, payload }) => {
  const message = JSON.parse(payload);
  console.log("Received:", { channel, message });
});

// Subscribe to the channel. To subscribe to multiple channels, add another
// line with channel name.
await db.query("LISTEN sum");

// Use CTE to first perform the query operation, and then sending the result
// through pg_notify.
await db.query(`
  WITH sum AS (
    SELECT 1 + 1 AS total
  )
  SELECT pg_notify('sum', (SELECT total FROM sum)::text)
`);

setTimeout(() => {
  db.end();
}, 10_000);
