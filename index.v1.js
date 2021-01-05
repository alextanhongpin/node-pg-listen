// This example demonstrates the basics of pg listen/notify.
import client from "./db.js";

console.log("Listen for all pg_notify channel messages");
client.on("notification", ({ channel, payload }) => {
  const message = JSON.parse(payload);
  console.log("received notification:", channel);
  console.log("message:", message);
});

console.log("Subscribe to notification");
await client.query("LISTEN user_created");

console.log("Performing query");
await client.query(`
  WITH sum AS (
    SELECT 1 + 1 AS total
  )
  SELECT pg_notify('user_created', (SELECT total FROM sum)::text)
`);

setTimeout(() => {
  client.end();
}, 10_000);
