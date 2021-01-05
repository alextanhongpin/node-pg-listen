export default class EventRepository {
  constructor(db) {
    this.db = db;
  }

  async findAll(checkpoint = 0, limit = 10_000) {
    const statement = `
      SELECT *
      FROM event
      WHERE id > $1
      LIMIT $2
    `;
    const values = [checkpoint, limit];
    const result = await this.db.query(statement, values);
    return result.rows;
  }

  async truncate(checkpoint = 0) {
    const statement = `
      DELETE 
      FROM event
      WHERE id <= $1
    `;
    const values = [checkpoint];

    const result = await this.db.query(statement, values);
    return result.rowCount;
  }
}
