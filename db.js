// db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./news.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    slug TEXT UNIQUE,
    excerpt TEXT,
    body TEXT,
    status TEXT, -- draft|published
    author_id INTEGER,
    category_id INTEGER,
    featured_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME,
    views INTEGER DEFAULT 0,
    FOREIGN KEY(author_id) REFERENCES users(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);

  // create default admin if not exists (password: admin123) - you can change later
  const bcrypt = require('bcrypt');
  const defaultEmail = 'admin@example.com';
  db.get('SELECT * FROM users WHERE email = ?', [defaultEmail], (err, row) => {
    if (err) return console.error(err);
    if (!row) {
      bcrypt.hash('admin123', 10).then(hash => {
        db.run('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
          ['Admin', defaultEmail, hash, 'admin']);
        console.log('Default admin created: admin@example.com / admin123');
      });
    }
  });
});

module.exports = db;