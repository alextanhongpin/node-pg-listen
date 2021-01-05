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
