import pg from "pg";
//const { Client } = pg;

// listen/notify does not work with pool. See issue here: https://github.com/brianc/node-pg-pool/issues/40
const client = new pg.Client({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME
});

// Automatically starts the connection. Don't do this in production.
client.connect();
// client.end()

export default client;
