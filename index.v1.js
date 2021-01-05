// This example demonstrates the basics of pg listen/notify.
import db from "./db.js";

console.log("Listen for all pg_notify channel messages");
db.on("notification", ({ channel, payload }) => {
  const message = JSON.parse(payload);
  console.log("received notification:", channel);
  console.log("message:", message);
});

console.log("Subscribe to notification");
await db.query("LISTEN user_created");

console.log("Performing query");
await db.query(`
  WITH sum AS (
    SELECT 1 + 1 AS total
  )
  SELECT pg_notify('user_created', (SELECT total FROM sum)::text)
`);

setTimeout(() => {
  db.end();
}, 10_000);
