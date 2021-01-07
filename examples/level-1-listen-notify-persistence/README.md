## Outbox Pattern


In the previous example, we have taken a look at the basic listen/notify operations. Now we are looking into building a more robust system for handling events, which includes

1. persisting. We store events in the database in an atomic transaction alongside the original entity (See `Outbox Pattern` in microservice) 
2. publishing. We query events, and publish them to a message queue. There a few strategy for querying events, namely pooling or pulling events. Pooling can be done with a cron job/scheduler (or at worst a loop), and pulling can be done through listen/notify or WAL.
3. recovering. In the scenario where the publishing failed, we need to be able to retry the publishing.
4. processing. Once we query the events, we can do actual processing, such as sending emails etc.
5. cleaning: Events that has been published should be removed from the database, to avoid unbounded growth.

Before that, let's see why publishing event is hard, in the context of user registration. We have a function to register User, and upon success, we need to publish the `UserRegisteredEvent`:

```js
async function register(name, email, password) {
  const user = await createUser(name, email, password)
  const event = new UserRegisteredEvent(user.id, user.name, user.email)
  
  // BAD
  await publish(event) 
  
  return user
}
```

However, many things can go wrong here:
1. The server failed - through restart/exceptions before the event is being published, and the message is lost.
2. The message broker failed - it may not be available, crashed or restarted.
3. There's error in the code that publishes the event

All of this lead to the fact that a user may be created, but the message could not be delivered and is lost.

Reversing the steps (publishing the event, and then creating the user) would not help either:

```js
async function register(name, email, password) {
  // BAD
  const event = new UserRegisteredEvent(user?.id, user.name, user.email)
  await publish(event)
  
  const user = await createUser(name, email, password)
  return user
}
```

Now we need to deal with the following problems:

1. Incomplete information like user id. We can generate one on the client side, but there's no guarantee it is unique in the database.
2. Publishing the event might be successful, but the creation of user in the database might failed, leaving the system in an incomplete state. The published event would not be able to query the user later.

Putting the operation in a transaction, hoping that if the message queue fails, the whole operation is reverted does not help either:

```js
async function register(name, email, password) {
  // BAD
  try {
    await db.query('START')
     
    const user = await createUser(name, email, password)
    
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

Why?
1. If the event is published successfully, and executes slightly faster before the transaction is commited, then the user might not exists in the database still, causing error.
2. If the publish takes a long time, the transaction will be open for a long time, slowing performance.


## The Outbox Pattern

The Outbox Pattern solves the problem above by persisting the event in the same transaction:

```js
async function register(name, email, password) {
  // BAD
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

With this, both operations are atomic - they succeed together, or fail as a whole. To publish the event:


```js
// NOTE: We should only have one of these running at a time.
async function pool() {
  try {
    await db.query('START')
    let lastId = 0 // Using serial id.
    const {rows: events} = await db.query('SELECT * FROM event ORDER BY id LIMIT 1000 FOR UPDATE')
    
    for await (let event of events) {
      try {
        // Publish to message queue/background worker.
        await publish(event)
        lastId = event.id
      } catch (error) {
        // Break on error, so that it can be retried later. We can apply exponential backoff to avoid hammering the server.
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

Basically:
1. query unpublished events
2. publish those event
3. delete the events from the table
4. repeat at every interval


## Creating event in transaction

Basically, this step can be further simplified by creating a trigger than will be executed on `INSERT`, `UPDATE` or `DELETE`. Assuming we have the following tables:
```sql
CREATE TABLE person (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE event (
    id bigint PRIMARY KEY,
    event text NOT NULL,
    object text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Here's an example on how to do so.
```sql
CREATE OR REPLACE FUNCTION send_to_outbox() RETURNS TRIGGER AS $$
DECLARE
	_channel text;
	_object text;
	_event text;
BEGIN
	_channel = TG_ARGV[0];
	IF NULLIF(_channel, '') IS NULL THEN
		RAISE EXCEPTION 'channel cannot be empty';
	END IF;
	
	_object = TG_TABLE_NAME;
	_event = TG_OP; -- INSERT/UPDATE/DELETE.
	
	-- Uncomment to debug.
	-- RAISE NOTICE 'got % % %', _channel, _object, _event;

	IF (TG_OP = 'DELETE') THEN 
		INSERT INTO event(event, object, data)
		VALUES (_event, _object, row_to_json(OLD.*));
		
		PERFORM pg_notify(_channel, row_to_json(OLD.*)::text);
	ELSIF ((TG_OP = 'UPDATE') OR (TG_OP = 'INSERT')) THEN
		INSERT INTO event(event, object, data)
		VALUES (_event, _object, row_to_json(NEW.*));
		
		PERFORM pg_notify(_channel, row_to_json(NEW.*)::text);
	END IF;

	RETURN NULL; 
END;
$$ LANGUAGE plpgsql;
```

Attach the trigger:
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
UNLISTEN person;
INSERT INTO person(name) VALUES ('john');
UPDATE person SET name = 'alice';
DELETE FROM person;
```


However, it is not as flexible as performing the creation of event in the transaction due to the following reasons:
1. (Primary reason) We can't be granular with the event type, and representing event as CRUD (`UserCreated`, `UserUpdated`, `UserDeleted`) makes it hard when it comes to handling the event processing later.
2. Triggers are not visible, compared to writing application code.
3. We now need to maintain triggers (adding, deleting etc) for multiple table
4. The trigger assumes the event created is tied to the existing table, but it might not always be true. Say if we created an `Order` and wanted to send a user an email, but the event requires data from multiple table, then we will have to query it later, at the risk of data changes. If would be safer to persist all those information as an event to be processed in the first place.
