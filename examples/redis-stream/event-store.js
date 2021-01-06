export default class EventStore {
  constructor(db) {
    this.db = db;
  }

  async findAll(limit = 10_000) {
    const statement = `
      SELECT *
      FROM event
      LIMIT $1
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
