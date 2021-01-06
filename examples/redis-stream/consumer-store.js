export default class ConsumerStore {
  constructor(db) {
    this.db = db;
  }

  async upsert(name) {
    const statement = `
      INSERT INTO consumer (name) VALUES ($1) 
      ON CONFLICT(name) DO UPDATE SET updated_at = now()
      RETURNING *
    `;
    const values = [name];
    const result = await this.db.query(statement, values);
    const consumer = result.rows[0];
    if (!consumer) return null;
    consumer.last_event_id = BigInt(consumer.last_event_id);
    return consumer;
  }

  async updateLastCheckpoint(name, lastEventId, lastRedisId) {
    try {
      await this.db.query("BEGIN");
      await this.db.query("SELECT * FROM consumer WHERE name = $1 FOR UPDATE", [
        name
      ]);

      const statement = `
        UPDATE consumer 
        SET last_event_id = $1,
            last_redis_id = $2
        WHERE name = $3
    `;
      const values = [lastEventId, lastRedisId, name];
      const result = await this.db.query(statement, values);

      await this.db.query("COMMIT");
      return result.rowCount > 0;
    } catch (error) {
      await this.db.query("ROLLBACK");
      throw error;
    }
  }
}
