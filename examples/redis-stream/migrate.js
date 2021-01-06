export default async function migrate(db) {
  // NOTE: Perform migrations. Don't do this in production.
  const result = await db.query(`
      DROP TABLE IF EXISTS person;
      CREATE TABLE IF NOT EXISTS person (
        id uuid DEFAULT gen_random_uuid(),
        name text NOT NULL,
        created_at timestamptz not null default current_timestamp,
        updated_at timestamptz not null default current_timestamp,
        
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

      DROP TABLE IF EXISTS consumer;
      CREATE TABLE IF NOT EXISTS consumer (
        id bigint GENERATED ALWAYS AS IDENTITY,
        name text NOT NULL,

        last_event_id bigint NOT NULL DEFAULT 0,
        last_redis_id text NOT NULL DEFAULT '',

        created_at timestamptz not null default current_timestamp,
        updated_at timestamptz not null default current_timestamp,

        PRIMARY KEY (id),
        UNIQUE (name)
      );`);
  return result.length;
}
