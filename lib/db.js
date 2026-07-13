const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

let sqlite3;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (error) {
  sqlite3 = null;
}

function resolveDbPath(explicitPath) {
  const rawDbPath = explicitPath || process.env.DB_PATH || process.env.DATABASE_URL || process.env.SQLITE_DB_PATH || 'portal.db';
  let dbPath = typeof rawDbPath === 'string' && rawDbPath.trim() ? rawDbPath.trim() : 'portal.db';

  if (dbPath.startsWith('sqlite:')) {
    dbPath = dbPath.replace(/^sqlite:/, '');
  }
  if (dbPath.startsWith('file:')) {
    dbPath = dbPath.replace(/^file:/, '');
  }
  if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(__dirname, '..', dbPath);
  }

  return dbPath;
}

function ensureDatabaseDirectory(dbFilePath) {
  const directory = path.dirname(dbFilePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

let dbConnection = null;

function getDb() {
  if (!dbConnection) {
    if (!sqlite3) {
      throw new Error('sqlite3 native module is not available. Reinstall dependencies and rebuild the module.');
    }

    const resolvedPath = resolveDbPath();
    ensureDatabaseDirectory(resolvedPath);
    dbConnection = new sqlite3.Database(resolvedPath);

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[db] Using SQLite database at ${resolvedPath}`);
    }
  }

  return dbConnection;
}

const db = new Proxy({}, {
  get(_target, property) {
    const connection = getDb();
    const value = connection[property];
    if (typeof value === 'function') {
      return value.bind(connection);
    }
    return value;
  }
});

function initDb() {
  const connection = getDb();
  connection.serialize(() => {
    connection.run('PRAGMA foreign_keys = ON');
    connection.run('PRAGMA journal_mode = WAL');
    connection.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        gradeLevel TEXT,
        yearLevel TEXT,
        role TEXT DEFAULT 'student',
        studentId TEXT
      )`
    );

    connection.run(
      `CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        subject TEXT NOT NULL,
        teacher TEXT,
        grade TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      )`
    );

    connection.all('PRAGMA table_info(grades)', (err, gradeColumns) => {
      if (!err && Array.isArray(gradeColumns)) {
        const hasTeacher = gradeColumns.some((col) => col.name === 'teacher');
        if (!hasTeacher) {
          connection.run('ALTER TABLE grades ADD COLUMN teacher TEXT');
        }
      }
    });

    connection.all('PRAGMA table_info(users)', (err, columns) => {
      const ensureUser = (name, email, passwordHash, gradeLevel, yearLevel, role) => {
        connection.run(
          `INSERT OR IGNORE INTO users (name, email, password, gradeLevel, yearLevel, role)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [name, email, passwordHash, gradeLevel, yearLevel, role],
          (insertErr) => {
            if (insertErr) {
              return;
            }
            connection.run(
              `UPDATE users SET name = ?, password = ?, gradeLevel = ?, yearLevel = ?, role = ? WHERE LOWER(email) = LOWER(?)`,
              [name, passwordHash, gradeLevel, yearLevel, role, email]
            );
          }
        );
      };

      const seedAdminAndDev = () => {
        const adminPasswordHash = hashPassword(process.env.ADMIN_PASSWORD || 'admin123');
        const devPasswordHash = hashPassword(process.env.DEV_PASSWORD || 'lovebydev');

        ensureUser('Administrator', process.env.ADMIN_EMAIL || 'admin@portal.com', adminPasswordHash, 'Administration', 'N/A', 'admin');
        ensureUser('Developer', process.env.DEV_EMAIL || 'dev@dev.dev', devPasswordHash, 'Development', 'N/A', 'dev');
        connection.run(`UPDATE users SET role = 'student' WHERE role IS NULL`);
      };

      if (!err && Array.isArray(columns)) {
        const hasYear = columns.some((col) => col.name === 'yearLevel');
        const hasRole = columns.some((col) => col.name === 'role');
        const hasStudentId = columns.some((col) => col.name === 'studentId');

        const addStudentIdAndSeed = () => {
          if (!hasStudentId) {
            connection.run('ALTER TABLE users ADD COLUMN studentId TEXT', [], (alterErr) => {
              if (alterErr) return;
              seedAdminAndDev();
            });
            return;
          }
          seedAdminAndDev();
        };

        const addSeedData = () => {
          seedAdminAndDev();
        };

        if (!hasYear) {
          connection.run('ALTER TABLE users ADD COLUMN yearLevel TEXT', [], (alterErr) => {
            if (alterErr) return;
            if (!hasRole) {
              connection.run('ALTER TABLE users ADD COLUMN role TEXT', [], (alterRoleErr) => {
                if (alterRoleErr) return;
                addStudentIdAndSeed();
              });
            } else {
              addStudentIdAndSeed();
            }
          });
          return;
        }

        if (!hasRole) {
          connection.run('ALTER TABLE users ADD COLUMN role TEXT', [], (alterErr) => {
            if (alterErr) return;
            addStudentIdAndSeed();
          });
          return;
        }

        if (!hasStudentId) {
          connection.run('ALTER TABLE users ADD COLUMN studentId TEXT', [], (alterErr) => {
            if (alterErr) return;
            addSeedData();
          });
          return;
        }

        addSeedData();
      } else {
        seedAdminAndDev();
      }
    });
  });
}

module.exports = {
  db,
  initDb,
  resolveDbPath
};
