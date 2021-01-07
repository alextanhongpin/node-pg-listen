export default class EventStore {
  constructor(db) {
    this.db = db;
  }

  async findAll(limit = 10_000) {
    // Selecting for update blocks another 'SELECT .. FROM UPDATE',
    // so they will never get the same paginated result when running
    // concurrently.
    const statement = `
      SELECT *
      FROM event
      ORDER BY id
      LIMIT $1
      FOR UPDATE
    `;
    const values = [limit];
    const result = await this.db.query(statement, values);
    return result.rows;
  }

  async truncate(eventId = 0) {
    const statement = `
      DELETE 
      FROM event
      WHERE id <= $1
    `;
    const values = [eventId];

    const result = await this.db.query(statement, values);
    return result.rowCount;
  }
}
