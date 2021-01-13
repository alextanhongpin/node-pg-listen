## Outbox Pattern


In the previous example, we have taken a look at the basic listen/notify operations. This example demonstrates the [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html). We will take a look into the different aspects of implementing it, such as:

1. __persistence__. We store events in the database in an atomic transaction alongside the original entity
2. __publishing__. We query events, and publish them to a message queue. There a few strategy for querying events, namely pooling or pulling events. Pooling can be done with a cron job/scheduler (or at worst a loop), and pulling can be done through listen/notify or WAL.
3. __recovery__. In the scenario where the publishing failed, we need to be able to retry the publishing.
4. __processing__. Once we query the events, we can do actual processing, such as sending emails etc.
5. __cleaning__: Events that has been published should be removed from the database, to avoid unbounded growth.

## The Assignment

Let's say you are tasked to write a service that handles user registration. Upon registration, two emails will be send out - one welcome email, and another for confirming the email. How would you design it?

## Dissecting the Problem

Surely it's not difficult. All we need is just one `register` function that persists the user, and sends email right? You might be tempted to do so:

```js
// Sends emails immediately after creating the user.
function register(name, email, password) {
  const user = await createUser(name, email, password)

  // BAD
  await sendWelcomeEmail(user)
  await sendConfirmationEmail(user)

  return user
}
```

While the solution is straightforward, it lacks the following:

- __reliability__: If the first email fails to send, how do we retry it? If the second fails, how do we retry it without double-sending the first?
- __extensibility__: What if we have additional requirements after the user is created? Adding new lines of code means more room for failure in between.

In short, we want to be able to repeat the delivery of the email, but at the same time deliver it only once.


## Investigating Alternatives

### Create the user, and then publish the event

Here's another variation, but in the context of event-driven design where an event is published to consumers:

```js
async function register(name, email, password) {
  const user = await createUser(name, email, password)
  const event = new UserRegisteredEvent(user.id, user.name, user.email)

  // BAD
  await publish(event)

  return user
}
```

However, many things can still go wrong here:
1. The server crashed or restarted.
2. The message broker may not be available, crashed or restarted.
3. The code that publishes the event failed due to an error.

All of this lead to the fact that a user may be created, but the message could not be delivered and is lost.

### Publish the event first, then create the user

Reversing the steps (publishing the event, and then creating the user) would not help either:

```js
async function register(name, email, password) {
  // BAD
  const userId = uuid.v4()
  const event = new UserRegisteredEvent(userId, name, email)
  await publish(event)

  const user = await createUser(userId, name, email, password)
  return user
}
```

Now we need to deal with the following problems:

1. Incomplete information like user id. We can generate one on the client side, but there's no guarantee it is unique in the database.
2. Publishing the event might be successful, but the creation of user in the database might failed, leaving the system in an incomplete state. The published event would not be able to query the user later.

### Create the user and publish it in a transaction

Putting the operation in a transaction, hoping that if the message queue fails, the whole operation is reverted does not help either:

```js
async function register(name, email, password) {
  try {
    await db.query('START')

    const user = await createUser(name, email, password)

    // BAD
    const event = new UserRegisteredEvent(user.id, user.name, user.email)
    await publish(event) // Event is published

    await db.query('COMMIT')

    return user
   } catch (error) {
    await db.query('ROLLBACK')
    throw error
   }
}
```

It is easy to imagine that the operation above is executed serially, but it is not. This is always a trap especially when dealing with external infrastructure.
1. If the event is published successfully, and is picked up by a worker before the transaction is commited, the worker might not be able to query the user for processing. Sure, we can retry them, but at the cost of false positive errors.
2. If the publish takes a long time, the transaction will be open for a long time, slowing performance.
3. Complexity increases in the scenario where there are more intermediate steps and multiple events to be published.


## The Outbox Pattern

The Outbox Pattern solves the problem above by persisting the event in the same transaction:

```js
async function register(name, email, password) {
  try {
    await db.query('START')

    const user = await createUser(name, email, password)

    // Event is persisted in another table.
    const event = new UserRegisteredEvent(user.id, user.name, user.email)
    await createEvent(event)

    await db.query('COMMIT')

    return user
   } catch (error) {
    await db.query('ROLLBACK')
    throw error
   }
}
```

With this, both operations are atomic - they succeed together, or fail as a whole. To publish the event, we have another function running in the background that will periodically pull the unprocessed events from the database:


```js
// NOTE: We should only have one of these running at a time.
// In a multi-node environment, only the leader should execute this function to avoid data race.

async function pool() {
  try {
    await db.query('START')
    let lastId = 0 // Using serial id.
    const {rows: events} = await db.query('SELECT * FROM event ORDER BY id LIMIT 1000 FOR UPDATE')

    for await (let event of events) {
      try {
        // Publish to message queue/background worker.
	// Or handle(event)
        await publish(event)
        lastId = event.id
      } catch (error) {
        // Break on error, so that it can be retried later.
	// We can also apply exponential backoff to avoid hammering the server.
        break
      }
    }
    await db.query('DELETE FROM event WHERE id <= $1', [lastId])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

setInterval(pool, 5_000) // Naive pooling, use cron or apply timeout/exponential backoff before the execution of the next pooling.
```

Basically the `pool` does the following:
1. query unpublished events
2. publish those event
3. delete the events from the table
4. repeat at every interval


## How about database trigger?

Basically, this step can be further simplified by creating a trigger than will be executed on `INSERT`, `UPDATE` or `DELETE`. Assuming we have the following tables:

```sql
CREATE TABLE person (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Basically the Outbox table.
CREATE TABLE event (
    id bigint PRIMARY KEY,
    event text NOT NULL,
    object text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

We can create a trigger that persist the event upon creation (the `notify` is a bonus implementation):
```sql
CREATE OR REPLACE FUNCTION send_to_outbox() RETURNS TRIGGER AS $$
DECLARE
	_channel text;
	_object text;
	_action text;
	_event event;
BEGIN
	_channel = TG_ARGV[0];
	IF NULLIF(_channel, '') IS NULL THEN
		RAISE EXCEPTION 'channel cannot be empty';
	END IF;

	_object = TG_TABLE_NAME;
	_action = TG_OP; -- INSERT/UPDATE/DELETE.

	-- Uncomment to debug.
	-- RAISE NOTICE 'got % % %', _channel, _object, _action;

	IF (TG_OP = 'DELETE') THEN
		INSERT INTO event(event, object, data)
		VALUES (_action, _object, row_to_json(OLD.*))
		RETURNING * INTO _event;
	ELSIF ((TG_OP = 'UPDATE') OR (TG_OP = 'INSERT')) THEN
		INSERT INTO event(event, object, data)
		VALUES (_action, _object, row_to_json(NEW.*))
		RETURNING * INTO _event;
	END IF;

	PERFORM pg_notify(_channel, row_to_json(_event)::text);

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

For each table that we want to attach the trigger to:
```sql
DROP TRIGGER send_to_outbox ON person;
CREATE TRIGGER send_to_outbox
AFTER INSERT OR UPDATE OR DELETE ON person
FOR EACH ROW
EXECUTE FUNCTION send_to_outbox('person');
```

Testing it out:
```sql
LISTEN person;

-- Insert.
INSERT INTO person(name) VALUES ('john');

-- Update.
UPDATE person SET name = 'alice';

-- Delete.
DELETE FROM person;

UNLISTEN person;
```


However, it is not as flexible as performing the creation of event in the transaction due to the following reasons:
1. (Primary reason) We can't be granular with the event type, and representing event as CRUD (`UserCreated`, `UserUpdated`, `UserDeleted`) makes it hard when it comes to handling the event processing later. Update, see [here](#trigger-revisited).
2. Triggers are less visible, compared to writing application code. Not all developers have access to write triggers too in certain environment.
3. We now need to maintain triggers (adding, deleting etc) for multiple table (it's not maintainable).
4. The trigger assumes the event created is tied to the existing table, but it might not always be true. Say if we created an `Order` and wanted to send a user an email, but the event requires data from multiple table, then we will have to query it later, at the risk of data changes. If would be safer to persist all those information as an event to be processed in the first place.
5. We might one to publish multiple events in a single transaction, if there are more operations involved.


## Granularity of events

Back to the problem statement above - when the user registers for a new account, we want to perform the following:

1. Send welcome email
2. Send confirmation email

In other words, we have two event handlers for a single event `UserRegisteredEvent`. Keeping them idempotent and ensuring one-time delivery is tricky in this situation. In this case, we should actually split it into two events, `WelcomeEmailRequestedEvent`, `ConfirmationEmailRequestedEvent` respectively. This will ensure that there is only 1:1 mapping of event to event handler which simplify the processing.

This idea is similar to having a queue of tasks, and processing them individually:

```python
# PSEUDOCODE
queue = [WelcomeEmailRequestedEvent, ConfirmationEmailRequestedEvent]

event = queue.peek() # Get the head.
process(event) # If this fails, retry.
queue.remove() # Remove head upon completion.
```

As opposed to this:
```python
# PSEUDOCODE
queue = [UserRegisteredEvent]

event = queue.peek()
sendConfirmationEmail(event) # Will this repeat if the task below failed?
sendWelcomeEmail(event) # Prone to failure.

queue.remove() # Two tasks needs to completed for removal. What if we have more?
```

Of course we can cache the steps in between, but caching introduce a few problems:

- how long to cache the intermediate steps?
- in-memory cache does not persist if server restart
- distributed cache adds another dependency, as well as complexity

By creating more granular events, we can also parallelize the processing further.

In other words, the proposed solution would be:

```js
async function register(name, email, password) {
  try {
    await db.query('START')

    const user = await createUser(name, email, password)

    // Event is persisted in another table.
    await createEvent(WelcomeEmailRequestedEvent.fromUser(user))
    await createEvent(ConfirmationEmailRequestedEvent.fromUser(user))

    await db.query('COMMIT')

    return user
   } catch (error) {
    await db.query('ROLLBACK')
    throw error
   }
}
```

## Update

Above, we mentioned that creating granular events are the way to go. But we are actually mixing the messages responsibility - commands and events. The email delivery are actually `commands`, and they can be derived from `events` too. Let's try to be more specific with the example. Here the `register` method now produce an event:

```js
async function register(name, email, password) {
  try {
    await db.query('START')

    const user = await createUser(name, email, password)
    await createEvent(UserRegisteredEvent(user.id, user.name, user.email))

    await db.query('COMMIT')

    return user
   } catch (error) {
    await db.query('ROLLBACK')
    throw error
   }
}
```

Then we have a `pool` method that will continuously query the `event` table:

```js
async function poolEvents() {
  try {
    await db.query('BEGIN')
    const events = await db.query(`
		SELECT * 
		FROM event
		ORDER BY id
		LIMIT 100
		FOR UPDATE`
    }
    let lastId = -1
    for (let event of events) {
      switch (event.type) {
        lastId = event.id
        case 'USER_REGISTERED':
          await db.query(`
				INSERT INTO command (object, action, payload)
				VALUES 
					($1, $3, $2),
					($1, $4, $2)
			`, [event.object, event.payload, 'SEND_WELCOME_EMAIL', 'SEND_REGISTRATION_EMAIL'])
          break
        default:
          throw new Error(`not implemented: ${event.type}`)
      }
    }
    await db.query('DELETE FROM event WHERE id <= $1', [lastId])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
  }
}
```

Now the events will be processed by creating two commands in the same transaction, guaranteeing atomicity! We can then create another background task to pool the commands, similar to what we have done with the events.

```js
async function poolCommands() {
  try {
    await db.query('BEGIN')
    const commands = await db.query(`
		SELECT * 
		FROM command
		ORDER BY id
		LIMIT 100
		FOR UPDATE`
    }
    let lastId = -1
    for (let command of commands) {
      switch (command.type) {
        lastId = command.id
        case 'SEND_WELCOME_EMAIL':
          // Send email...
          break
        case 'SEND_REGISTRATION_EMAIL':
          // Send email...
          break
        default:
          throw new Error(`not implemented: ${command.type}`)
      }
    }
    await db.query('DELETE FROM command WHERE id <= $1', [lastId])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
  }
}
```

The delivery is then guaranteed.

## Non-pooling approach

In the examples above, we pool the `event` table to check for events to be processed. At times, we want to directly process them in the handler itself, and avoid duplicate jobs when the event is handled successfully. This pattern also works if the method is triggered by another client that wishes for the payload, but upon triggering, the event will also be sent to the same client to process the same task, which is redundant. That is the case with Saga Orchestration. E.g.

1. Saga Orchestrator fires a HTTP Post to Payment Service's `/payments` to create payment
2. Saga Orchestrator receives the response and mark it as done
3. Payment Service however sends the event to the Saga Orchestrator's queue.
4. Saga Orchestrator receives the same event

If we know that the event does not need to be persisted after the call is done, we can just delete it immediately after the transaction ends. In case that fails, it will always be picked up by the pooler and send to the service that needs it as Event Notification.
```js
async function createPayment(params) {
  let payment, event
  try {
    await db.query('BEGIN')
    payment = await createPayment(db, params)
    event = await createEvent(db, new PaymentCreatedEvent(payment))
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
  }
  
  try {
    await db.query('BEGIN')
    // Potentially use something like NATS request/reply.
    await publish(event)
    await db.query('DELETE FROM event WHERE id = $1', [event.id])
  	await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
  }
  
  return payment
}
```

## Batch vs Stream Processing

Above we demonstrated how to perform batch operations by pooling. Alternatively, we can also perform stream processing, by using listen/notify.

The differences are as follow:
- batch: we perform the operations in bulk. This is usually for processes that does not require real-time delivery.
- stream: we perform the operation close to real-time, on individual events.

The `pool` function is essentially a `batch` operation:
```js
async function batch() {
  try {
    await db.query('START')
    let lastId = 0 // Using serial id.
    const {rows: events} = await db.query('SELECT * FROM event ORDER BY id LIMIT 1000 FOR UPDATE')

    for await (let event of events) {
      try {
        // Handle the events.
        await handle(event)
        lastId = event.id
      } catch (error) {
        // Break on error, so that it can be retried later.
	// We can also apply exponential backoff to avoid hammering the server.
        break
      }
    }
    await db.query('DELETE FROM event WHERE id <= $1', [lastId])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}
```

By processing the  listen/notify, we can stream the event:

```js
db.on('notification', ({channel, payload}) => {
  const event = JSON.parse(payload)
  stream(event)
})
```

Our `stream` function handle only a single event at a time, and removing them from the database once completed:
```js
// If an event is specified, process that event by id, else select a row from
// the database that is not yet selected by another transaction.
async function stream(event) {
  try {
    await db.query('BEGIN')

    const rows = await db.query(
      event?.id
      ? 'SELECT * FROM event WHERE id = $1 LIMIT 1 FOR UPDATE NOWAIT' // Only one transaction should operate on the event. Fail when another transaction pick this event.
      : 'SELECT * FROM event LIMIT 1 FOR UPDATE SKIP LOCKED', // In case we want to parellelize the stream operation, this will only select an event that is not selected by another transaction.
      event?.id
      ? [event?.id]
      : [])

    const storedEvent = rows[0]
    if (!storedEvent) {
      await db.query('COMMIT')
      return
    }

    await handle(storedEvent)

    await db.query('DELETE FROM event WHERE id = $1', [storedEvent.id])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}
```

In case the server restarts, we can always retry it by running the `stream` periodically to pick up on old events:

```js
setInterval(stream, 5_000)
```

Parellelizing it is easy:

```js
async function batchStream(n = 10) {
  for await (let i = 0; i < n; i++) {
    await stream()
  }
}
```

## Trigger Revisited

Earlier I mentioned that granularity of the event name is the reason why we are not using trigger. We can easily make it granular, by adding the event name into the entity that we are updating. So a `person` table will look like this:

```sql
CREATE TABLE IF NOT EXIST person (
	id uuid DEFAULT gen_random_uuid(),
	-- REDACTED
	event text NOT NULL DEFAULT 'PERSON_CREATED',
	
	PRIMARY KEY (id)
)
```

The `event` column can can be an `enum` too. In other words, for every operation on the `person` row, we update the event name. With this, the trigger is able to pick up the event name.

## Outbox Table

In the above example, we name our table `event`. We can also stick with the convention `outbox` if needed, or adapt to the structure of the domain event table:

```sql
CREATE TABLE IF NOT EXISTS event (
	id bigint GENERATED ALWAYS AS IDENTITY,
	
	aggregate_id uuid NOT NULL,
	aggregate_type text NOT NULL,
	action text NOT NULL,
	data jsonb NOT NULL DEFAULT '{}',
	
	PRIMARY KEY (id)
);
```
