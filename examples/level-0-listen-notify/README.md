# Level 0: Postgres's listen/notify

This example demonstrates the basic usage of Postgres's listen/notify, since we will be using that in further solution. 

Listen/notify is basically a pub/sub system. __Producers__ publishes messages to a designated __channel__, and __Consumers__ subscribes to the messages from the same __channel__.
```
Producer: publish message -> channel
Consumer: subscribe channel -> message
```

## Example: psql

We can test out the basic functionality in psql or any postgres client:
```sql
-- Subscribe to channel `sum`.
LISTEN sum;

-- Publish to channel `sum`. Note that the payload must be of type text.
NOTIFY sum, '1';

-- Unsubscribe from the channel `sum`.
UNLISTEN sum;
```

## Example: nodejs

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


## Handling Events

Now that we are listening to events, we will now discuss how to handle them. Note that it is really dependent on the use case, but here's a suggestion on what events should be handled here:

Do's:
- accuracy does not matter, e.g. update/invalidate cache
- fire-and-forget operations, e.g. publish to websocket

Dont's:
- when at-least-once-delivery is required, e.g. sending email, publishing to message queue/background task
- when state needs to be accurate, e.g. keeping track of balances etc
- when events needs to be processed in order


We can borrow a few concepts from CQRS/event sourcing here:
- `EventHandler` receives events defined by NewEvent and handles them with its Handle method.
- `EventProcessor` determines which `EventHandler` should handle event received from event bus.

Our handler can be as simple as this:
```js
const eventProcessor = {
  sum: handleSum,
  avg: handleAvg
}

function handleSum(sum) {
  console.log('processing sum', sum)
}

function handleAvg(avg) {
  console.log('processing avg', avg)
}

function handleEvent(event, payload) {
  return eventProcessor[event]?.(payload) || null
}
```

Or more elaborate like this:
```js


class EventProcessor {
  constructor() {
    this.handlers = new Map()
    this.handlers.set('sum', new SumEventHandler().handle)
    this.handlers.set('avg', new AvgEventHandler().handle)
    this.handlers.set('noop', (event) => {
      return (args) => console.log('not implemented: %s', event)
    })
  }
  handle(event, payload) {
    const handler = this.handlers.get(event) || this.handlers.get('noop')(event)
    return handler(payload)
  }
}

class SumEventHandler {
  handle(message) {
    console.log('handle sum:', message)
  }
}
class AvgEventHandler {
  handle(message) {
    console.log('handle avg:', message)
  }
}

const eventProcessor = new EventProcessor()
eventProcessor.handle('sum', 1)
eventProcessor.handle('avg', 1)
eventProcessor.handle('unknown', 1)
```
