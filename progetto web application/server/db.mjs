import sqlite from 'sqlite3';

const db = new sqlite.Database('theatre.db', (err) => {
  if (err) throw err;
});

export default db;