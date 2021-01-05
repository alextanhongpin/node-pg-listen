# node-pg-listen

Use cases for pg listen/notify:
- maintaining cache (cache can be invalidated whenever the database rows changed)
- event driven system, notify consumers on the changes they are interested in and trigger actions such as background tasks/sending emails etc.


## Basic commands
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
