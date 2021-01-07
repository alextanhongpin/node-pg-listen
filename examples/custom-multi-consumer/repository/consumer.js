export default class ConsumerRepository {
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
    const consumer = result.rows?.[0];
    consumer.checkpoint = BigInt(consumer.checkpoint);
    return consumer;
  }

  async updateLastCheckpoint(name, checkpoint = 0) {
    try {
      await this.db.query("BEGIN");
      await this.db.query("SELECT * FROM consumer WHERE name = $1 FOR UPDATE", [
        name
      ]);

      const statement = `
        UPDATE consumer 
        SET checkpoint = $1
        WHERE name = $2
    `;
      const values = [checkpoint, name];
      const result = await this.db.query(statement, values);

      await this.db.query("COMMIT");
      return result.rowCount > 0;
    } catch (error) {
      await this.db.query("ROLLBACK");
      throw error;
    }
  }

  async minCheckpoint() {
    const statement = `
      SELECT min(checkpoint) AS checkpoint
      FROM consumer
    `;
    const result = await this.db.query(statement);
    const checkpoint = BigInt(result.rows?.[0].checkpoint);
    return checkpoint;
  }
}
