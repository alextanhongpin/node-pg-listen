# Level 0: Postgres's listen/notify

This example demonstrates the basic usage of Postgres's listen/notify, since we will be using that in further solution. 

Listen/notify is basically a pub/sub system. __Producers__ publishes messages to a designated __channel__, and __Consumers__ subscribes to the messages from the same __channel__.
```
Producer: publish message -> channel
Consumer: subscribe channel -> message
```

The example below is done with `node.js`, but just treat it as a pseudo-code that can be applied in other languages.


__Consumer__ listening to new messages:
```js
// Consumer
db.on("notification", ({ channel, payload }) => {
  const message = JSON.parse(payload);
  console.log("Received:", { channel, message });
});
```

In order to receive messages, the __Consumer__ has to explicitly subscribe to the __channel__ they are interested in. The __Consumer__ can subscribe to multiple channels.
```js
// Subscribe to Channel `sum`.
await db.query("LISTEN sum");

// Subscribe to additional channels.
await db.query("LISTEN channel1");
await db.query("LISTEN channel2");
```

__Producer__ publish the message through `pg_notify`. The [WITH queries](https://www.postgresql.org/docs/current/queries-with.html) enables us to first store the result of the our query, and then sending the results to `pg_notify` with the second query, which happens in a single transaction.
```js
// Producer
await db.query(`
  WITH sum AS (
    SELECT 1 + 1 AS total
  )
  SELECT pg_notify('sum', (SELECT total FROM sum)::text) -- This will send the result to the channel `sum`.
`);
```
