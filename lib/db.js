const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

let builtinSqlite;
try {
  builtinSqlite = require('node:sqlite');
} catch (error) {
  builtinSqlite = null;
}

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

function createDatabaseAdapter(connection, mode) {
  if (mode === 'builtin') {
    return {
      run(sql, params = [], callback) {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }

        try {
          const statement = connection.prepare(sql);
          statement.run(...params);
          if (typeof callback === 'function') {
            setImmediate(() => callback(null));
          }
          return this;
        } catch (error) {
          if (typeof callback === 'function') {
            setImmediate(() => callback(error));
          } else {
            throw error;
          }
        }
      },
      get(sql, params = [], callback) {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }

        try {
          const statement = connection.prepare(sql);
          const row = statement.get(...params);
          if (typeof callback === 'function') {
            setImmediate(() => callback(null, row));
          }
          return row;
        } catch (error) {
          if (typeof callback === 'function') {
            setImmediate(() => callback(error));
          } else {
            throw error;
          }
        }
      },
      all(sql, params = [], callback) {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }

        try {
          const statement = connection.prepare(sql);
          const rows = statement.all(...params);
          if (typeof callback === 'function') {
            setImmediate(() => callback(null, rows));
          }
          return rows;
        } catch (error) {
          if (typeof callback === 'function') {
            setImmediate(() => callback(error));
          } else {
            throw error;
          }
        }
      },
      close(callback) {
        try {
          connection.close();
          if (typeof callback === 'function') {
            setImmediate(() => callback(null));
          }
        } catch (error) {
          if (typeof callback === 'function') {
            setImmediate(() => callback(error));
          } else {
            throw error;
          }
        }
      }
    };
  }

  return connection;
}

function getDb() {
  if (!dbConnection) {
    const resolvedPath = resolveDbPath();
    ensureDatabaseDirectory(resolvedPath);

    let selectedMode = null;
    if (builtinSqlite && builtinSqlite.DatabaseSync) {
      dbConnection = createDatabaseAdapter(new builtinSqlite.DatabaseSync(resolvedPath), 'builtin');
      selectedMode = 'builtin';
    } else if (sqlite3) {
      dbConnection = createDatabaseAdapter(new sqlite3.Database(resolvedPath), 'sqlite3');
      selectedMode = 'sqlite3';
    } else {
      throw new Error('No SQLite runtime is available.');
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[db] Using SQLite database at ${resolvedPath} via ${selectedMode}`);
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
  return new Promise((resolve, reject) => {
    const connection = getDb();
    const run = (sql, params = []) => new Promise((resolveRun, rejectRun) => {
      connection.run(sql, params, (err) => (err ? rejectRun(err) : resolveRun()));
    });
    const all = (sql, params = []) => new Promise((resolveAll, rejectAll) => {
      connection.all(sql, params, (err, rows) => (err ? rejectAll(err) : resolveAll(rows)));
    });

    const ensureUser = async (name, email, passwordHash, gradeLevel, yearLevel, role) => {
      await run(
        `INSERT OR IGNORE INTO users (name, email, password, gradeLevel, yearLevel, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, email, passwordHash, gradeLevel, yearLevel, role]
      );
      await run(
        `UPDATE users SET name = ?, password = ?, gradeLevel = ?, yearLevel = ?, role = ? WHERE LOWER(email) = LOWER(?)`,
        [name, passwordHash, gradeLevel, yearLevel, role, email]
      );
    };

    const seedDefaultAccounts = async () => {
      const adminPasswordHash = hashPassword(process.env.ADMIN_PASSWORD || 'admin123');
      const devPasswordHash = hashPassword(process.env.DEV_PASSWORD || 'lovebydev');
      const studentPasswordHash = hashPassword(process.env.STUDENT_PASSWORD || 'student123');

      await ensureUser('Administrator', process.env.ADMIN_EMAIL || 'admin@portal.com', adminPasswordHash, 'Administration', 'N/A', 'admin');
      await ensureUser('Developer', process.env.DEV_EMAIL || 'dev@dev.dev', devPasswordHash, 'Development', 'N/A', 'dev');
      await ensureUser('Sample Student', process.env.STUDENT_EMAIL || 'student@portal.com', studentPasswordHash, 'General Education', '1st Year', 'student');
      await run(`UPDATE users SET role = 'student' WHERE role IS NULL`);
    };

    (async () => {
      try {
        await run('PRAGMA foreign_keys = ON');
        await run('PRAGMA journal_mode = WAL');
        await run(
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

        await run(
          `CREATE TABLE IF NOT EXISTS grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            subject TEXT NOT NULL,
            teacher TEXT,
            grade TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id)
          )`
        );

        const gradeColumns = await all('PRAGMA table_info(grades)');
        if (Array.isArray(gradeColumns) && !gradeColumns.some((col) => col.name === 'teacher')) {
          await run('ALTER TABLE grades ADD COLUMN teacher TEXT');
        }

        const columns = await all('PRAGMA table_info(users)');
        if (Array.isArray(columns)) {
          const hasYear = columns.some((col) => col.name === 'yearLevel');
          const hasRole = columns.some((col) => col.name === 'role');
          const hasStudentId = columns.some((col) => col.name === 'studentId');
          const hasProfilePicture = columns.some((col) => col.name === 'profilePicture');

          if (!hasYear) {
            await run('ALTER TABLE users ADD COLUMN yearLevel TEXT');
          }
          if (!hasRole) {
            await run('ALTER TABLE users ADD COLUMN role TEXT');
          }
          if (!hasStudentId) {
            await run('ALTER TABLE users ADD COLUMN studentId TEXT');
          }
          if (!hasProfilePicture) {
            await run('ALTER TABLE users ADD COLUMN profilePicture TEXT');
          }
        }

        await seedDefaultAccounts();
        resolve();
      } catch (error) {
        reject(error);
      }
    })();
  });
}

module.exports = {
  db,
  initDb,
  resolveDbPath
};
