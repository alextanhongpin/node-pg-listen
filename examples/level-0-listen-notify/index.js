// This example demonstrates the basics of pg listen/notify.

import db from "../../db.js";

const eventProcessor = {
  sum: handleSum,
  avg: handleAvg
};

function handleSum(sum) {
  console.log("sum:", sum);
}

function handleAvg(avg) {
  console.log("avg:", avg);
}

// Subscribe to pg_notify notifications.
db.on("notification", ({ channel, payload }) => {
  const message = JSON.parse(payload);
  eventProcessor[channel]?.(message);
});

// Subscribe to the channel. To subscribe to multiple channels, add another
// line with channel name.
await db.query("LISTEN sum");
await db.query("LISTEN avg");

// Use CTE to first perform the query operation, and then sending the result
// through pg_notify.
await db.query(`
  WITH sum AS (
    SELECT 1 + 1 AS total
  )
  SELECT pg_notify('sum', (SELECT total FROM sum)::text)
`);
await db.query(`SELECT pg_notify('avg', '1');`);

setTimeout(() => {
  db.end();
}, 10_000);
