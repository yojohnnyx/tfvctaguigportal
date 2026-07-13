const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { hashPassword } = require('./auth');

const rawDbPath = process.env.DB_PATH || process.env.DATABASE_URL || '../portal.db';
let dbPath = rawDbPath;
if (dbPath.startsWith('sqlite:')) {
  dbPath = dbPath.replace(/^sqlite:/, '');
}
if (dbPath.startsWith('file:')) {
  dbPath = dbPath.replace(/^file:/, '');
}
if (!path.isAbsolute(dbPath)) {
  dbPath = path.join(__dirname, '..', dbPath);
}

const db = new sqlite3.Database(dbPath);

function initDb() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        gradeLevel TEXT,
        yearLevel TEXT,
        role TEXT DEFAULT 'student',
        studentId TEXT,
        twoStepEnabled INTEGER DEFAULT 0
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        subject TEXT NOT NULL,
        teacher TEXT,
        grade TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      )`
    );

    db.all('PRAGMA table_info(grades)', (err, gradeColumns) => {
      if (!err && Array.isArray(gradeColumns)) {
        const hasTeacher = gradeColumns.some((col) => col.name === 'teacher');
        if (!hasTeacher) {
          db.run('ALTER TABLE grades ADD COLUMN teacher TEXT');
        }
      }
    });

    db.all('PRAGMA table_info(users)', (err, columns) => {
      const ensureUser = (name, email, passwordHash, gradeLevel, yearLevel, role) => {
        db.run(
          `INSERT OR IGNORE INTO users (name, email, password, gradeLevel, yearLevel, role)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [name, email, passwordHash, gradeLevel, yearLevel, role],
          (insertErr) => {
            if (insertErr) {
              return;
            }
            db.run(
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
        db.run(`UPDATE users SET role = 'student' WHERE role IS NULL`);
      };

      if (!err && Array.isArray(columns)) {
        const hasYear = columns.some((col) => col.name === 'yearLevel');
        const hasRole = columns.some((col) => col.name === 'role');
        const hasStudentId = columns.some((col) => col.name === 'studentId');
        const hasTwoStepEnabled = columns.some((col) => col.name === 'twoStepEnabled');

        const addStudentIdAndSeed = () => {
          if (!hasStudentId) {
            db.run('ALTER TABLE users ADD COLUMN studentId TEXT', [], (alterErr) => {
              if (alterErr) return;
              seedAdminAndDev();
            });
            return;
          }
          seedAdminAndDev();
        };

        const addTwoStepFlagAndSeed = () => {
          if (!hasTwoStepEnabled) {
            db.run('ALTER TABLE users ADD COLUMN twoStepEnabled INTEGER DEFAULT 0', [], (alterErr) => {
              if (alterErr) return;
              seedAdminAndDev();
            });
            return;
          }
          seedAdminAndDev();
        };

        if (!hasYear) {
          db.run('ALTER TABLE users ADD COLUMN yearLevel TEXT', [], (alterErr) => {
            if (alterErr) return;
            if (!hasRole) {
              db.run('ALTER TABLE users ADD COLUMN role TEXT', [], (alterRoleErr) => {
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
          db.run('ALTER TABLE users ADD COLUMN role TEXT', [], (alterErr) => {
            if (alterErr) return;
            addStudentIdAndSeed();
          });
          return;
        }

        if (!hasStudentId) {
          db.run('ALTER TABLE users ADD COLUMN studentId TEXT', [], (alterErr) => {
            if (alterErr) return;
            addTwoStepFlagAndSeed();
          });
          return;
        }

        addTwoStepFlagAndSeed();
      } else {
        seedAdminAndDev();
      }
    });
  });
}

module.exports = {
  db,
  initDb
};
