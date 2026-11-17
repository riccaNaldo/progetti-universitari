import sqlite from 'sqlite3';
import crypto from 'crypto';
import db from './db.mjs';

// This function returns a specific user given its ID
const getUserById = (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users WHERE id = ?';
      db.get(sql, [id], (err, row) => {
        if (err) 
          reject(err);
        else if (row === undefined)
          resolve({error: 'User not found.'});
        else {
          
          const user = {id: row.id, username: row.email, name: row.name, secret: row.secret,
            lastTotpStep: row.lastTotpStep, isAdmin: row.isAdmin}
          resolve(user);
        }
    });
  });
};


// This function is used at log-in time to verify username and password.
const getUser = (email, password) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users WHERE email=?';
    db.get(sql, [email], (err, row) => {
      if (err) {
        reject(err);
      } else if (row === undefined) {
        resolve(false);
      }
      else {
        const user = { id: row.id, username: row.email, name: row.name, secret: row.secret, lastTotpStep: row.lastTotpStep, isAdmin: row.isAdmin };

        // Check the hashes with an async call, this operation may be CPU-intensive (and we don't want to block the server)
        crypto.scrypt(password, row.salt, 32, function (err, hashedPassword) { // WARN: it is 64 and not 32 (as in the week example) in the DB
          if (err) reject(err);
          if (!crypto.timingSafeEqual(Buffer.from(row.hash, 'hex'), hashedPassword)) // WARN: it is hash and not password (as in the week example) in the DB
            resolve(false);
          else
            resolve(user);
        });
      }
    });
  });
};

// This function updates the lastTotpStep for the user in the database.
const updateLastTotpStep = (userId, lastTotpStep) => {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE users SET lastTotpStep = ? WHERE id = ?';
    db.run(sql, [lastTotpStep, userId], function (err) {
      if (err) {
        reject(err);
      }
      if (this.changes !== 1) {
        resolve({ error: 'User not found.' });
      } else {
        resolve(this.changes);
      }
    });
  });
};


export default {
  getUserById,
  getUser,
  updateLastTotpStep
};