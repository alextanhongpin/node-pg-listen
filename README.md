# node-pg-listen

## Problem Statement

- __What__: Handling background tasks in the most robust, reliable way, and how to recover when the application crashes. 
- __Where__: Systems that are driven by consumers that subscribes to the changes in the data source and perform actions such as sending emails, background tasks, invalidating cache, sending events to websockets etc.
- __Who__: For developers that wants to explore different variation of the solution to the problems...
- __When__: ...when the developers realized that not all solution is perfect, and should be tailored to their use case.
- __Why__: An understanding on the basic concepts will help build a tailored-made solution to fit your use case.
- __How__: By exploring Postgres's feature such as listen/notify, `skip update`, and building a queue from the database first and then evolve the solution using Redis Stream

## How this is structured

Check the `examples/` folder, starting from level 0, to the highest level.

# References

## Basic commands for Postgres listen/notify
```sql
LISTEN user_created;
NOTIFY user_created, 'your payload';
UNLISTEN user_created;
```

## Why not notify using trigger?

When using trigger to notify, passing arguments can be hard, and the events would not be granular enough.
We will only get CRUD events, but we want granular events such as `UserAddressUpdated`, `UserRegistered` etc.

By using Postgres's CTE (`with` statement), it will act as a transaction and we
can customize the events that would be published in the database. The disadvantage is that each query must conform to this format.
