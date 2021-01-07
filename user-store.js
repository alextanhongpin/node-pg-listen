export default function createUsers(db) {
  "abcdefghijklmnopqrstuvwxyz".split("").forEach(name => {
    // This works as a transaction, if one of the WITH step fails, all of them
    // fails.
    // Perform the insertion of person, event and subsequently returning the
    // person's data and notifying the event.
    db.query(
      `WITH person_created AS (
      INSERT INTO person(name) VALUES ($1) RETURNING *
    ),
    event_created AS (
      INSERT INTO event (object, event, data) VALUES ('person', 'person_created', (SELECT row_to_json(person_created.*) FROM person_created))
      RETURNING *
    )
    SELECT * FROM person_created, pg_notify('person_created', (SELECT row_to_json(event_created.*) FROM event_created)::text);`,
      [name]
    );
  });
}
