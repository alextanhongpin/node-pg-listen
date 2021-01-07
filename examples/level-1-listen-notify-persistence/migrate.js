export default async function migrate(db) {
  const result = await db.query(`
  DROP TABLE IF EXISTS person;
  CREATE TABLE IF NOT EXISTS person (
    id uuid DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    
    PRIMARY KEY (id)
  );

  DROP TABLE IF EXISTS event;
  CREATE TABLE IF NOT EXISTS event (
    id bigint GENERATED ALWAYS AS IDENTITY,
    event text NOT NULL,
    object text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (id)
  );
`);
  return result.length;
}
