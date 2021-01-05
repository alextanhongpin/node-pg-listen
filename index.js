import client from "./db.js";

// NOTE: Perform migrations. Don't do this in production.
const result = await client.query(`
  CREATE TABLE IF NOT EXISTS person (
    id uuid DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    
    PRIMARY KEY (id)
  );

  CREATE TABLE IF NOT EXISTS event (
    id bigint GENERATED ALWAYS AS IDENTITY,
    name text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (id)
  );
`);
console.log(result.length);

client.on("notification", ({ channel, payload }) => {
  const message = JSON.parse(payload);
  console.log("received notification:", channel);
  console.log("message:", message);
});

await client.query("LISTEN user_created");

await client.query(`
  WITH user_created AS (
    INSERT INTO person(name) VALUES ('john') RETURNING *
  ),
  event_created AS (
    INSERT INTO event (name, data) VALUES ('user_created', (SELECT row_to_json(user_created.*) FROM user_created))
    RETURNING *
  )
  SELECT pg_notify('user_created', (SELECT row_to_json(event_created.*) FROM event_created)::text);
`);

setTimeout(() => {
  client.end();
}, 10_000);
