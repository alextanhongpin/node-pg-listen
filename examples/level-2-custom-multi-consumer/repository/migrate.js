class Migrator {
  constructor(db) {
    this.db = db;
  }

  async migrate() {
    // NOTE: Perform migrations. Don't do this in production.
    const result = await this.db.query(`
      CREATE TABLE IF NOT EXISTS person (
        id uuid DEFAULT gen_random_uuid(),
        name text NOT NULL,
        created_at timestamptz not null default current_timestamp,
        updated_at timestamptz not null default current_timestamp,
        
        PRIMARY KEY (id)
      );

      CREATE TABLE IF NOT EXISTS event (
        id bigint GENERATED ALWAYS AS IDENTITY,
        event text NOT NULL,
        object text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}',
        
        PRIMARY KEY (id)
      );

      CREATE TABLE IF NOT EXISTS consumer (
        id bigint GENERATED ALWAYS AS IDENTITY,
        name text NOT NULL,
        checkpoint bigint NOT NULL DEFAULT 0,
        topics text[] NOT NULL DEFAULT '{*}',

        created_at timestamptz not null default current_timestamp,
        updated_at timestamptz not null default current_timestamp,

        PRIMARY KEY (id),
        UNIQUE (name)
      );`);
    return result.length;
  }
}

export default function migrate(db) {
  const migrator = new Migrator(db);
  return migrator.migrate();
}
