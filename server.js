const express = require('express');
const session = require('express-session');
const path = require('path');
const nodemailer = require('nodemailer');
const { db, initDb } = require('./lib/db');
const { hashPassword, verifyPassword, normalizeRole, normalizeEmail, isValidEmailFormat, isValidGmailEmailLocalPart, isValidPassword, isValidName, escapeHtml } = require('./lib/auth');
const { securityHeaders, forbidSensitiveFiles } = require('./lib/middleware');

const app = express();
const SESSION_SECRET = process.env.SESSION_SECRET || 'portal-secret-key';
const loginAttempts = new Map();
const devState = {
  appLogs: [],
  cache: {},
  cacheClearedAt: null
};

const ACCOUNT_ROLE_LIMITS = {
  admin: 3,
  staff: 6
};

const otpStore = new Map();

function logDevEvent(message) {
  const entry = `${new Date().toISOString()} - ${message}`;
  devState.appLogs.unshift(entry);
  if (devState.appLogs.length > 50) {
    devState.appLogs.length = 50;
  }
}

function requireDev(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'dev') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function saveOtp(email, payload) {
  otpStore.set(email.toLowerCase(), {
    ...payload,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
}

function consumeOtp(email, otp) {
  const normalizedEmail = email.toLowerCase();
  const record = otpStore.get(normalizedEmail);
  if (!record) {
    return null;
  }
  if (record.otp !== otp || record.expiresAt < Date.now()) {
    otpStore.delete(normalizedEmail);
    return null;
  }
  otpStore.delete(normalizedEmail);
  return record;
}

async function sendOtpEmail(email, otp) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = process.env.SMTP_USER || process.env.SMTP_EMAIL || process.env.SENDER_EMAIL;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.SENDER_PASSWORD;

  if (!user || !pass) {
    console.warn(`OTP email skipped for ${email}. SMTP credentials not configured.`);
    return false;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  await transport.sendMail({
    from: user,
    to: email,
    subject: 'Portal verification code',
    text: `Your portal verification code is ${otp}. It expires in 10 minutes.`,
    html: `<p>Your portal verification code is <strong>${otp}</strong>.</p><p>It expires in 10 minutes.</p>`
  });
  return true;
}

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    }
  })
);

app.use(securityHeaders);
app.use(forbidSensitiveFiles);
app.use(express.static(path.join(__dirname), { dotfiles: 'ignore', index: false }));

app.get('/dev/api/health-check', requireDev, (req, res) => {
  db.get('SELECT COUNT(*) AS count FROM users', [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to run health check.' });
    }
    logDevEvent('Performed health check');
    res.json({
      message: 'Health check complete.',
      uptimeSeconds: Math.round(process.uptime()),
      userCount: row.count,
      cacheEntries: Object.keys(devState.cache).length,
      cacheClearedAt: devState.cacheClearedAt
    });
  });
});

app.get('/dev/api/export-users', requireDev, (req, res) => {
  db.all('SELECT id, name, email, role, gradeLevel, yearLevel FROM users ORDER BY id', [], (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to export users.' });
    }

    const escapeCsv = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
    const csvRows = [
      ['id', 'name', 'email', 'role', 'gradeLevel', 'yearLevel'].map(escapeCsv).join(','),
      ...users.map((user) => [
        user.id,
        user.name,
        user.email,
        normalizeRole(user.role),
        user.gradeLevel || '',
        user.yearLevel || ''
      ].map(escapeCsv).join(','))
    ];

    logDevEvent(`Exported ${users.length} users`);
    res.json({
      message: `Exported ${users.length} users.`,
      filename: 'users.csv',
      csv: csvRows.join('\n')
    });
  });
});

app.get('/dev/api/app-logs', requireDev, (req, res) => {
  logDevEvent('Viewed app logs');
  res.json({
    message: 'App logs loaded.',
    logs: devState.appLogs.slice(0, 20)
  });
});

app.get('/dev/api/clear-cache', requireDev, (req, res) => {
  devState.cache = {};
  devState.cacheClearedAt = new Date().toISOString();
  logDevEvent('Cleared application cache');
  res.json({
    message: 'Application cache cleared.',
    cacheClearedAt: devState.cacheClearedAt
  });
});

function attemptLogin(email, password, callback) {
  email = email?.toString().trim().toLowerCase();
  password = password?.toString();
  if (!email || !password) {
    return callback(null, null, false);
  }

  db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email], (err, user) => {
    if (err || !user || !verifyPassword(password, user.password)) {
      const attempts = loginAttempts.get(email) || 0;
      loginAttempts.set(email, attempts + 1);
      return callback(null, null, loginAttempts.get(email) >= 5);
    }

    loginAttempts.delete(email);
    callback(null, user, false);
  });
}

app.get(['/', '/login', '/login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/register', (req, res) => {
  let { name, email, major, year, password, confirmPassword, studentId, from } = req.body;
  name = name?.toString().trim();
  email = email?.toString().trim().toLowerCase();
  major = major?.toString().trim();
  year = year?.toString().trim();
  studentId = studentId?.toString().trim();
  from = from?.toString().trim();

  if (!isValidName(name) || !email || !major || !year || !password || !confirmPassword) {
    return res.redirect('/register.html?error=missing-fields');
  }

  if (!isValidEmailFormat(email) || !isValidGmailEmailLocalPart(email)) {
    return res.redirect('/register.html?error=invalid-email');
  }

  if (!isValidPassword(password)) {
    return res.redirect('/register.html?error=password-too-short');
  }

  if (from === 'admin' && !studentId) {
    return res.redirect('/register.html?error=missing-student-id');
  }

  if (password !== confirmPassword) {
    return res.redirect('/register.html?error=password-mismatch');
  }

  const twoStepEnabled = req.body.twoStepEnabled === 'on' || req.body.twoStepEnabled === '1' ? 1 : 0;
  const insert = `INSERT INTO users (name, email, password, gradeLevel, yearLevel, role, studentId, twoStepEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const passwordHash = hashPassword(password);
  db.run(insert, [name, email, passwordHash, major, year, 'student', studentId || null, twoStepEnabled], function (err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.send('Email already registered. <a href="register.html">Try again</a>');
      }
      return res.send('Unable to create account. <a href="register.html">Back</a>');
    }

    if (req.session.user && req.session.user.role === 'admin') {
      return res.redirect('/admin?status=student-created');
    }

    req.session.user = { id: this.lastID, name, email, gradeLevel: major, yearLevel: year, role: 'student', twoStepEnabled };
    res.redirect('/dashboard');
  });
});

app.post('/login', (req, res) => {
  const email = req.body.email?.toString().trim().toLowerCase();
  const password = req.body.password?.toString();

  if (!email || !password || !isValidEmailFormat(email) || !isValidGmailEmailLocalPart(email)) {
    return res.redirect('/login?error=invalid-credentials');
  }

  attemptLogin(email, password, async (err, user, locked) => {
    if (err) {
      return res.redirect('/login?error=login-failed');
    }
    if (!user) {
      return res.redirect(locked ? '/login?error=account-locked' : '/login?error=invalid-credentials');
    }

    const normalizedRole = normalizeRole(user.role);
    if (normalizedRole === 'student' && Number(user.twoStepEnabled) === 1) {
      const otp = generateOtp();
      const pendingUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        gradeLevel: user.gradeLevel,
        yearLevel: user.yearLevel,
        role: normalizedRole
      };
      saveOtp(user.email, { otp, ...pendingUser });
      try {
        await sendOtpEmail(user.email, otp);
      } catch (mailError) {
        console.error('Unable to send OTP email:', mailError);
      }

      req.session.pendingOtp = pendingUser;
      req.session.save(() => {
        res.redirect(`/login?step=otp&email=${encodeURIComponent(user.email)}`);
      });
      return;
    }

    req.session.regenerate((sessionErr) => {
      if (sessionErr) {
        return res.redirect('/login?error=login-failed');
      }
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        gradeLevel: user.gradeLevel,
        yearLevel: user.yearLevel,
        role: normalizedRole
      };
      req.session.admin = req.session.user.role === 'admin';

      if (req.session.user.role === 'admin') {
        return res.redirect('/admin');
      }
      if (req.session.user.role === 'dev') {
        return res.redirect('/dev');
      }
      if (req.session.user.role === 'staff') {
        return res.redirect('/staff');
      }
      res.redirect('/dashboard');
    });
  });
});

app.post('/login/otp', (req, res) => {
  const email = req.body.email?.toString().trim().toLowerCase();
  const otp = req.body.otp?.toString().trim();
  const pendingOtp = req.session.pendingOtp;

  if (!email || !otp || !pendingOtp || pendingOtp.email !== email) {
    return res.redirect(`/login?step=otp&email=${encodeURIComponent(email || '')}&error=invalid-otp`);
  }

  const verified = consumeOtp(email, otp);
  if (!verified) {
    return res.redirect(`/login?step=otp&email=${encodeURIComponent(email)}&error=invalid-otp`);
  }

  req.session.regenerate((sessionErr) => {
    if (sessionErr) {
      return res.redirect('/login?error=login-failed');
    }
    req.session.user = {
      id: pendingOtp.id,
      name: pendingOtp.name,
      email: pendingOtp.email,
      gradeLevel: pendingOtp.gradeLevel,
      yearLevel: pendingOtp.yearLevel,
      role: pendingOtp.role
    };
    req.session.admin = req.session.user.role === 'admin';
    req.session.pendingOtp = null;

    if (req.session.user.role === 'admin') {
      return res.redirect('/admin');
    }
    if (req.session.user.role === 'dev') {
      return res.redirect('/dev');
    }
    if (req.session.user.role === 'staff') {
      return res.redirect('/staff');
    }
    res.redirect('/dashboard');
  });
});

app.post('/admin/login', (req, res) => {
  const email = req.body.email?.toString().trim().toLowerCase();
  const password = req.body.password?.toString();

  if (!email || !password || !isValidEmailFormat(email)) {
    return res.redirect('/admin.html?error=invalid-credentials');
  }

  attemptLogin(email, password, (err, user, locked) => {
    if (err) {
      return res.redirect('/admin.html?error=login-failed');
    }
    if (!user || normalizeRole(user.role) !== 'admin') {
      return res.redirect(locked ? '/admin.html?error=account-locked' : '/admin.html?error=invalid-credentials');
    }

    req.session.regenerate((sessionErr) => {
      if (sessionErr) {
        return res.redirect('/admin.html?error=login-failed');
      }
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        gradeLevel: user.gradeLevel,
        yearLevel: user.yearLevel,
        role: normalizeRole(user.role)
      };
      req.session.admin = true;
      return res.redirect('/admin');
    });
  });
});

app.post('/dev/create-account', (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'dev') {
    return res.redirect('/login.html');
  }

  const { role, name, email, password, confirmPassword, department } = req.body;
  const normalizedRole = normalizeRole(role);
  const normalizedEmail = normalizeEmail(email);

  if (!isValidName(name) || !normalizedEmail || !password || !confirmPassword) {
    return res.redirect('/dev?status=invalid-input');
  }
  if (!isValidEmailFormat(normalizedEmail) || !isValidGmailEmailLocalPart(normalizedEmail)) {
    return res.redirect('/dev?status=invalid-email');
  }
  if (!isValidPassword(password)) {
    return res.redirect('/dev?status=password-too-short');
  }
  if (password !== confirmPassword) {
    return res.redirect('/dev?status=invalid-input');
  }
  if (!['admin', 'staff'].includes(normalizedRole)) {
    return res.redirect('/dev?status=invalid-role');
  }

  const roleLimit = ACCOUNT_ROLE_LIMITS[normalizedRole];
  return db.get(
    'SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = ?',
    [normalizedRole],
    (err, row) => {
      if (err) {
        return res.redirect('/dev?status=save-failed');
      }
      if (row.count >= roleLimit) {
        const statusKey = normalizedRole === 'admin' ? 'admin-limit' : 'staff-limit';
        return res.redirect(`/dev?status=${statusKey}`);
      }

      const passwordHash = hashPassword(password);
      const gradeLevel = normalizedRole === 'admin' ? 'Administration' : (department?.trim() || 'Staff');
      const yearLevel = 'N/A';

      db.run(
        'INSERT INTO users (name, email, password, gradeLevel, yearLevel, role) VALUES (?, ?, ?, ?, ?, ?)',
        [name.trim(), normalizedEmail, passwordHash, gradeLevel, yearLevel, normalizedRole],
        function (err) {
          if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
              return res.redirect('/dev?status=email-exists');
            }
            return res.redirect('/dev?status=save-failed');
          }
          res.redirect(`/dev?status=created-${normalizedRole}`);
        }
      );
    }
  );
});

// API endpoint for AJAX account creation from the dev modal
app.post('/dev/api/create-account', requireDev, (req, res) => {
  const { role, name, email, password, confirmPassword, department } = req.body;
  const normalizedRole = normalizeRole(role);
  const normalizedEmail = normalizeEmail(email);
  if (!isValidName(name) || !normalizedEmail || !password || !confirmPassword) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!isValidEmailFormat(normalizedEmail) || !isValidGmailEmailLocalPart(normalizedEmail)) {
    return res.status(400).json({ error: 'Email must contain only letters, numbers, @, and . and, for Gmail addresses, the part before @gmail.com must include letters.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (!['admin', 'staff'].includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  const roleLimit = ACCOUNT_ROLE_LIMITS[normalizedRole];
  return db.get(
    'SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = ?',
    [normalizedRole],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Unable to verify role limit.' });
      }
      if (row.count >= roleLimit) {
        const errorMessage = normalizedRole === 'admin'
          ? 'Admin account limit reached. Only 3 admin accounts are allowed.'
          : 'Staff account limit reached. Only 6 staff accounts are allowed.';
        return res.status(409).json({ error: errorMessage });
      }

      const passwordHash = hashPassword(password);
      const gradeLevel = normalizedRole === 'admin' ? 'Administration' : (department?.trim() || 'Staff');
      const yearLevel = 'N/A';

      db.run(
        'INSERT INTO users (name, email, password, gradeLevel, yearLevel, role, studentId) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name.trim(), normalizedEmail, passwordHash, gradeLevel, yearLevel, normalizedRole, null],
        function (err) {
          if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
              return res.status(409).json({ error: 'Email already registered.' });
            }
            return res.status(500).json({ error: 'Unable to create account.' });
          }

          const newUser = {
            id: this.lastID,
            name: name.trim(),
            email: normalizedEmail,
            role: normalizedRole,
            gradeLevel,
            yearLevel,
            studentId: null
          };

          logDevEvent(`Created account ${newUser.email} (${newUser.role})`);
          res.json({ message: `Created ${normalizedRole}.`, user: newUser });
        }
      );
    }
  );
});

app.post('/dev/update-user', requireDev, (req, res) => {
  const { id, name, email, role, gradeLevel, yearLevel, studentId, password, confirmPassword } = req.body;
  const normalizedRole = normalizeRole(role);
  const normalizedEmail = normalizeEmail(email);
  if (!id || !isValidName(name) || !normalizedEmail || !role) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!['admin', 'staff', 'dev', 'student'].includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (!isValidEmailFormat(normalizedEmail) || !isValidGmailEmailLocalPart(normalizedEmail)) {
    return res.status(400).json({ error: 'Email must contain only letters, numbers, @, and . and, for Gmail addresses, the part before @gmail.com must include letters.' });
  }

  if (password) {
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (password !== (confirmPassword || '')) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
  }

  // For admin/staff accounts, remove course/year/student fields per requirements
  let finalGrade = gradeLevel?.trim() || '';
  let finalYear = yearLevel?.trim() || '';
  let finalStudent = studentId?.trim() || null;
  if (['admin', 'staff'].includes(normalizedRole)) {
    finalGrade = '';
    finalYear = 'N/A';
    finalStudent = null;
  }

  // Build dynamic update to include password only when provided
  const sets = ['name = ?', 'email = ?', 'role = ?', 'gradeLevel = ?', 'yearLevel = ?', 'studentId = ?'];
  const params = [name.trim(), normalizedEmail, normalizedRole, finalGrade, finalYear, finalStudent];
  if (password) {
    sets.push('password = ?');
    params.push(hashPassword(password));
  }
  params.push(id);

  const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = ?`;
  db.run(sql, params, function (err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(400).json({ error: 'Email already exists.' });
      }
      return res.status(500).json({ error: 'Unable to update user.' });
    }
    logDevEvent(`Updated user ${email} (id=${id}) by ${req.session.user?.email || 'unknown'}`);
    res.json({ message: 'User updated successfully.' });
  });
});

app.post('/admin/grade', (req, res) => {
  if (!req.session.admin) {
    return res.redirect('/admin.html');
  }

  const studentId = req.body.studentId?.trim();
  const gradeId = req.body.gradeId?.trim();
  const subject = req.body.subject?.trim();
  const grade = req.body.grade?.trim();

  if (!studentId || !subject || !grade) {
    return res.send('Please provide student, subject, and grade. <a href="/admin">Back</a>');
  }

  const gradeValue = parseFloat(grade);
  if (Number.isNaN(gradeValue) || gradeValue < 1.0 || gradeValue > 5.0) {
    return res.send('Please enter a valid numeric grade between 1.00 and 5.00. <a href="/admin">Back</a>');
  }

  db.get('SELECT id FROM users WHERE id = ? AND (role IS NULL OR LOWER(role) NOT IN ("admin","dev"))', [studentId], (err, student) => {
    if (err || !student) {
      return res.send('Selected student is invalid. Please choose a valid student account. <a href="/admin">Back</a>');
    }

    if (gradeId) {
      const update = `UPDATE grades SET subject = ?, grade = ? WHERE id = ? AND userId = ?`;
      db.run(update, [subject, grade, gradeId, studentId], function (err) {
        if (err || this.changes === 0) {
          return res.send('Unable to update grade. <a href="/admin">Back</a>');
        }
        return res.redirect('/admin?status=grade-updated');
      });
      return;
    }

    const insert = `INSERT INTO grades (userId, subject, teacher, grade) VALUES (?, ?, ?, ?)`;
    db.run(insert, [studentId, subject, null, grade], function (err) {
      if (err) {
        return res.send('Unable to save grade. <a href="/admin">Back</a>');
      }
      res.redirect('/admin?status=grade-added');
    });
  });
});

app.get('/admin', (req, res) => {
  if (!req.session.admin) {
    return res.redirect('/admin.html');
  }

  db.all('SELECT * FROM users WHERE LOWER(role) = ? ORDER BY gradeLevel, yearLevel, name', ['student'], (err, users) => {
    if (err) {
      return res.send('Unable to load students.');
    }

    db.all('SELECT * FROM grades', (err2, grades) => {
      if (err2) {
        return res.send('Unable to load grades.');
      }

      const gradesByUser = {};
      grades.forEach((grade) => {
        if (!gradesByUser[grade.userId]) {
          gradesByUser[grade.userId] = [];
        }
        gradesByUser[grade.userId].push(grade);
      });

      const majors = Array.from(new Set(users.map((user) => user.gradeLevel || 'Unknown major'))).sort();
      const years = Array.from(new Set(users.map((user) => user.yearLevel || 'Unspecified year'))).sort();
      const totalStudents = users.length;
      const totalMajors = majors.length;
      const gradedStudents = Object.keys(gradesByUser).length;
      const totalGrades = grades.length;
      const status = req.query.status;
      let statusMessage = '';
      if (status === 'grade-added') {
        statusMessage = 'Grade added successfully. Student dashboard will update automatically.';
      } else if (status === 'grade-updated') {
        statusMessage = 'Grade updated successfully. Student dashboard will update automatically.';
      } else if (status === 'student-created') {
        statusMessage = 'Student account created successfully.';
      }

      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal Admin Dashboard</title>
  <link rel="icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="shortcut icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="page-shell">
    <div class="page-header">
      <div class="brand-row">
        <img class="logo-img" src="/TFVC-CLG_Logo.png" alt="TFVC College logo" />
        <div>
          <div class="brand">Admin Dashboard</div>
          <p class="subtitle">Search students by name or email from the left panel.</p>
        </div>
      </div>
      <button type="button" class="hamburger-button admin-hamburger" onclick="toggleAdminPanelMenu()" aria-expanded="false" aria-controls="adminPanelMenu" aria-label="Open admin menu">?</button>
      <div class="page-actions">
        <button type="button" class="theme-toggle-button" onclick="toggleTheme()">Switch to dark</button>
        <a class="button-enroll" href="/register.html?from=admin">Enroll student</a>
        <a class="button-logout" href="/logout">Sign out</a>
      </div>
    </div>

    <div class="admin-grid">
      <aside class="admin-panel" id="adminPanelMenu">
        <div class="panel-card">
          <div class="panel-menu-header">
            <h2>Search students</h2>
            <button type="button" class="panel-close-button" onclick="toggleAdminPanelMenu()" aria-label="Close admin menu">?</button>
          </div>
          <p class="helper">Search students by name or email in the admin dashboard.</p>
          ${statusMessage ? `<div class="status-message">${escapeHtml(statusMessage)}</div>` : ''}
          <div class="field-block">
            <label for="studentSearch">Search students</label>
            <input type="search" id="studentSearch" placeholder="Search students..." />
          </div>
        </div>
      </aside>

      <section class="dashboard-wrapper student-list">
        <section class="card stats-overview">
          <div class="overview-grid">
            <div class="overview-item">
              <span>Total students</span>
              <strong>${totalStudents}</strong>
            </div>
            <div class="overview-item">
              <span>Total recorded grades</span>
              <strong>${totalGrades}</strong>
            </div>
            <div class="overview-item">
              <span>Students with grades</span>
              <strong>${gradedStudents}</strong>
            </div>
            <div class="overview-item">
              <span>Unique majors</span>
              <strong>${totalMajors}</strong>
            </div>
          </div>
          <h2>Students</h2>
          <p class="helper">Click a student name to open their subject and grade editor.</p>
        </section>
`;

      users.forEach((user) => {
        const safeName = escapeHtml(user.name);
        const safeEmail = escapeHtml(user.email);
        const safeGradeLevel = escapeHtml(user.gradeLevel || 'Unknown major');
        const safeYearLevel = escapeHtml(user.yearLevel || 'Unspecified year');
        const userSubjectList = (gradesByUser[user.id] || []).map((grade) => escapeHtml(grade.subject)).filter(Boolean).join(', ');
        html += `
      <section class="card student-card" data-user-id="${user.id}" data-name="${escapeHtml((user.name + ' ' + (user.studentId || '') + ' ' + (user.gradeLevel || '')).toLowerCase())}" data-grade-level="${escapeHtml((user.gradeLevel || '').toLowerCase())}" data-year-level="${escapeHtml((user.yearLevel || '').toLowerCase())}" data-student-id="${escapeHtml((user.studentId || '').toLowerCase())}">
        <button type="button" class="student-card-button" data-user-id="${user.id}">
          <div class="student-card-title">${safeName}</div>
          <div class="student-card-meta">
            <span>${escapeHtml(user.studentId || 'No ID')}</span>
            <span>${safeGradeLevel}</span>
          </div>
        </button>
      </section>
`;
      });

      html += `    </div>
  </div>

  <div id="studentDetailModal" class="modal-backdrop" data-modal="studentDetailModal">
    <div class="modal-card student-detail-card">
      <div class="modal-header">
        <div>
          <h2 id="detailStudentName">Student details</h2>
          <p class="helper">Manage subjects and grades for this student.</p>
        </div>
        <button type="button" class="modal-close" aria-label="Close student details">?</button>
      </div>
      <div class="student-detail-grid">
        <div>
          <p class="detail-label">Student ID</p>
          <p id="detailStudentId"></p>
        </div>
        <div>
          <p class="detail-label">Major</p>
          <p id="detailStudentMajor"></p>
        </div>
        <div>
          <p class="detail-label">Year level</p>
          <p id="detailStudentYear"></p>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Grade</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="detailSubjectsTable"></tbody>
        </table>
      </div>
      <form id="studentGradeForm" action="/admin/grade" method="post" class="grade-form">
        <input type="hidden" name="studentId" id="detailFormStudentId" />
        <input type="hidden" name="gradeId" id="detailFormGradeId" />
        <div class="form-grid">
          <div class="field-block">
            <label for="detailSubject">Subject</label>
            <input type="text" id="detailSubject" name="subject" placeholder="e.g. Math" required />
          </div>
          <div class="field-block">
            <label for="detailGrade">Grade</label>
            <input type="text" id="detailGrade" name="grade" placeholder="e.g. 1.00 or 1.25" required />
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="button-secondary" onclick="closeModal('studentDetailModal')">Cancel</button>
          <button type="submit" class="button-primary" id="detailFormSubmitButton">Add grade</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    window.adminStudentData = ${JSON.stringify(users.map((user) => ({
      id: user.id,
      name: user.name,
      studentId: user.studentId || '',
      major: user.gradeLevel || 'Unknown major',
      yearLevel: user.yearLevel || 'Unspecified year',
      grades: (gradesByUser[user.id] || []).map((grade) => ({ id: grade.id, subject: grade.subject, grade: grade.grade }))
    }))).replace(/</g, '\u003c')};
  </script>

  <script src="/scripts.js"></script>
</body>
</html>`;

      res.send(html);
    });
  });
});

app.get('/dev', (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'dev') {
    return res.redirect('/login.html');
  }

  db.all('SELECT * FROM users ORDER BY role, gradeLevel, yearLevel, name', [], (err, users) => {
    if (err) {
      return res.send('Unable to load user data.');
    }

    db.all('SELECT * FROM grades', [], (err2, grades) => {
      if (err2) {
        return res.send('Unable to load grades.');
      }

      const gradesByUser = {};
      grades.forEach((grade) => {
        if (!gradesByUser[grade.userId]) {
          gradesByUser[grade.userId] = [];
        }
        gradesByUser[grade.userId].push(grade);
      });

      const studentCount = users.filter((u) => normalizeRole(u.role) === 'student').length;
      const adminCount = users.filter((u) => normalizeRole(u.role) === 'admin').length;
      const staffCount = users.filter((u) => normalizeRole(u.role) === 'staff').length;
      const devCount = users.filter((u) => normalizeRole(u.role) === 'dev').length;
      const totalGrades = grades.length;
      const status = req.query.status;
      let statusMessage = '';
      if (status === 'created-admin') {
        statusMessage = 'Admin account created successfully.';
      } else if (status === 'created-staff') {
        statusMessage = 'Staff account created successfully.';
      } else if (status === 'email-exists') {
        statusMessage = 'That email is already registered.';
      } else if (status === 'invalid-input') {
        statusMessage = 'Please complete the form and make sure passwords match.';
      } else if (status === 'invalid-role') {
        statusMessage = 'Selected role is not supported.';
      } else if (status === 'invalid-email') {
        statusMessage = 'Email must only contain letters, numbers, @, and . and use a valid format.';
      } else if (status === 'admin-limit') {
        statusMessage = 'Admin account limit reached. Only 3 admin accounts are allowed.';
      } else if (status === 'staff-limit') {
        statusMessage = 'Staff account limit reached. Only 6 staff accounts are allowed.';
      } else if (status === 'save-failed') {
        statusMessage = 'Unable to create account. Please try again.';
      }

      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Developer Dashboard</title>
  <link rel="icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="shortcut icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="page-shell">
    <div class="admin-grid dev-dashboard">
      <button type="button" class="hamburger-button" onclick="toggleDevPanelMenu()" aria-expanded="false" aria-controls="devPanelMenu" aria-label="Open developer tools menu">?</button>
      <aside class="admin-panel">
        <div class="page-header dev-left-header">
          <div class="brand-row">
            <img class="logo-img" src="/TFVC-CLG_Logo.png" alt="TFVC College logo" />
            <div>
              <div class="brand">Developer Dashboard</div>
              <p class="subtitle">Manage accounts, run dev tools, and inspect portal state from the developer console.</p>
            </div>
          </div>
          <div class="page-actions">
            <button type="button" class="theme-toggle-button" onclick="toggleTheme()">Switch to dark</button>
            <button type="button" class="button-primary" onclick="openModal('createAccountModal')">Create account</button>
            <button type="button" class="tip-button" onclick="openModal('devTipModal')">Need a tip?</button>
            <a class="button-logout" href="/logout">Sign out</a>
          </div>
        </div>
        <div class="panel-card" id="devPanelMenu">
          <div class="panel-menu-header">
            <h2>Dev tools</h2>
            <button type="button" class="panel-close-button" onclick="toggleDevPanelMenu()" aria-label="Close developer tools menu">?</button>
          </div>
          <p class="helper">Use these actions to inspect the portal, export users, or run quick utility checks.</p>
          ${statusMessage ? `<div class="status-message">${escapeHtml(statusMessage)}</div>` : ''}
          <div class="field-block">
            <label for="studentSearch">Search users</label>
            <input type="search" id="studentSearch" placeholder="Search by name, email, or role..." />
          </div>
          <div class="field-block">
            <label for="courseFilter">Role filter</label>
            <select id="courseFilter">
              <option value="">All roles</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
              <option value="dev">Dev</option>
              <option value="student">Student</option>
            </select>
          </div>
          <div class="field-block">
            <label for="yearFilter">Year level</label>
            <select id="yearFilter">
              <option value="">All years</option>
              ${Array.from(new Set(users.map((u) => u.yearLevel || 'Unspecified year'))).map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join('')}
            </select>
          </div>
          <div class="field-block">
            <label for="sortOrder">Sort by</label>
            <select id="sortOrder">
              <option value="">Default order</option>
              <option value="name-asc">Name � A to Z</option>
              <option value="name-desc">Name � Z to A</option>
              <option value="role">Role</option>
              <option value="year">Year level</option>
            </select>
          </div>
          <button type="button" class="button-secondary" onclick="resetAdminFilters()">Reset filters</button>
        </div>

        <div class="panel-card">
          <h2>Quick actions</h2>
          <button type="button" class="button-secondary dev-action-button" data-action="health-check">Health check</button>
          <button type="button" class="button-secondary dev-action-button" data-action="export-users">Export user list</button>
          <button type="button" class="button-secondary dev-action-button" data-action="app-logs">View app logs</button>
          <button type="button" class="button-secondary dev-action-button" data-action="clear-cache">Clear cache</button>
        </div>
      </aside>

      <section class="dashboard-wrapper student-list">
        <section class="card stats-overview">
          <div class="overview-grid">
            <button type="button" class="overview-item role-summary active" data-role="all">
              <span>All accounts</span>
              <strong>${users.length}</strong>
            </button>
            <button type="button" class="overview-item role-summary" data-role="admin">
              <span>Admins</span>
              <strong>${adminCount}</strong>
            </button>
            <button type="button" class="overview-item role-summary" data-role="staff">
              <span>Staff</span>
              <strong>${staffCount}</strong>
            </button>
            <button type="button" class="overview-item role-summary" data-role="dev">
              <span>Dev</span>
              <strong>${devCount}</strong>
            </button>
            <button type="button" class="overview-item role-summary" data-role="student">
              <span>Students</span>
              <strong>${studentCount}</strong>
            </button>
          </div>
          <h2>Account creation</h2
          <p class="helper">Create admin and staff accounts. Staff users can only view and print student records.</p>
        </section>

        <!-- Account creation moved to header modal; keeping account directory only -->

        <section class="card account-directory">
          <div class="account-directory-header">
            <h2>Account directory</h2>
            <p class="helper">Click an account to view full details, edit fields, or delete the account.</p>
          </div>
          <div class="account-list">
            ${users
              .map((user) => {
                const safeName = escapeHtml(user.name);
                const safeEmail = escapeHtml(user.email);
                const safeRole = escapeHtml(normalizeRole(user.role));
                const safeGradeLevel = escapeHtml(user.gradeLevel || '');
                const safeYearLevel = escapeHtml(user.yearLevel || '');
                const safeStudentId = escapeHtml(user.studentId || '');
                return `<button type="button" class="account-entry" data-user-id="${user.id}" data-name="${safeName}" data-email="${safeEmail}" data-role="${safeRole}" data-grade-level="${safeGradeLevel}" data-year-level="${safeYearLevel}" data-student-id="${safeStudentId}">
                  <span class="account-title">${safeName}</span>
                  <span class="account-meta">${safeRole}${safeStudentId ? ` � ${safeStudentId}` : ''}</span>
                  <span class="account-email">${safeEmail}</span>
                </button>`;
              })
              .join('')}
          </div>
        </section>

        <section class="card">
          <h2>Staff record viewer</h2>
          <p class="helper">Staff accounts can use the student record viewer to print student grades and details without editing rights.</p>
          <button type="button" class="button-secondary" onclick="window.location='/staff'">Open staff viewer</button>
        </section>

        <div id="accountModal" class="modal-backdrop" data-modal="accountModal">
          <div class="modal-card">
            <h2>User account</h2>
            <p id="accountModalMessage" class="helper"></p>
            <form id="accountEditForm">
              <input type="hidden" id="accountId" name="id" />
              <div class="field-block">
                <label for="accountName">Full name</label>
                <input type="text" id="accountName" name="name" required />
              </div>
              <div class="field-block">
                <label for="accountEmail">Email address</label>
                <input type="email" id="accountEmail" name="email" required />
              </div>
              <div class="field-block">
                <label for="accountPassword">Password (leave blank to keep current)</label>
                <input type="password" id="accountPassword" name="password" />
              </div>
              <div class="field-block">
                <label for="accountConfirmPassword">Confirm password</label>
                <input type="password" id="accountConfirmPassword" name="confirmPassword" />
              </div>
              <div class="field-block">
                <label for="accountRole">Role</label>
                <select id="accountRole" name="role" required>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                  <option value="dev">Dev</option>
                  <option value="student">Student</option>
                </select>
              </div>
              <div class="field-block">
                <label for="accountGradeLevel">Course / department</label>
                <input type="text" id="accountGradeLevel" name="gradeLevel" />
              </div>
              <div class="field-block">
                <label for="accountYearLevel">Year level</label>
                <input type="text" id="accountYearLevel" name="yearLevel" />
              </div>
              <div class="field-block">
                <label for="accountStudentId">Student ID</label>
                <input type="text" id="accountStudentId" name="studentId" />
              </div>
              <div class="modal-actions">
                <button type="button" class="button-secondary" onclick="closeModal('accountModal')">Cancel</button>
                <button type="button" class="button-secondary" id="deleteAccountButton">Delete</button>
                <button type="submit" class="button-primary">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>

  <div id="createAccountModal" class="modal-backdrop" data-modal="createAccountModal">
    <div class="modal-card">
      <h2>Create account</h2>
      <p class="helper">Create admin or staff accounts from here (max 3 admins, max 6 staff).</p>
      <div class="modal-tabs" role="tablist" aria-label="Create account tabs">
        <button type="button" class="tab-button active" data-tab="admin">Admin</button>
        <button type="button" class="tab-button" data-tab="staff">Staff</button>
      </div>
      <p id="createAccountMessage" class="helper"></p>
      <form id="createAccountForm" action="/dev/create-account" method="post">
        <input type="hidden" id="createRole" name="role" value="admin" />
        <div class="field-block">
          <label for="createName">Full name</label>
          <input type="text" id="createName" name="name" required />
        </div>
        <div class="field-block">
          <label for="createEmail">Email address</label>
          <input type="email" id="createEmail" name="email" required pattern="[A-Za-z0-9@.]+" title="Use letters, numbers, @, and . only" />
        </div>
        <div class="field-block" id="departmentField" style="display:none;">
          <label for="createDepartment">Department</label>
          <input type="text" id="createDepartment" name="department" />
        </div>
        <div class="field-block">
          <label for="createPassword">Password</label>
          <input type="password" id="createPassword" name="password" required />
        </div>
        <div class="field-block">
          <label for="createConfirmPassword">Confirm password</label>
          <input type="password" id="createConfirmPassword" name="confirmPassword" required />
        </div>
        <div class="modal-actions">
          <button type="button" class="button-secondary" onclick="closeModal('createAccountModal')">Cancel</button>
          <button type="submit" class="button-primary">Create account</button>
        </div>
      </form>
    </div>
  </div>

  <div id="devTipModal" class="modal-backdrop" data-modal="devTipModal">
    <div class="modal-card">
      <h2>Developer Tip</h2>
      <p>Use the developer dashboard to clean up accounts, inspect system state, and manage access levels.</p>
      <div class="modal-actions">
        <button type="button" class="button-secondary" onclick="closeModal('devTipModal')">Close</button>
      </div>
    </div>
  </div>

  <div id="devActionModal" class="modal-backdrop" data-modal="devActionModal">
    <div class="modal-card">
      <h2>Dev action</h2>
      <p id="devActionMessage">Running developer action...</p>
      <div class="modal-actions">
        <button type="button" class="button-secondary" onclick="closeModal('devActionModal')">Close</button>
      </div>
    </div>
  </div>

  <div id="studentCreatedModal" class="modal-backdrop" data-modal="studentCreatedModal">
    <div class="modal-card">
      <h2>Student Account Created</h2>
      <p>The student account was successfully created. You remain logged in as admin.</p>
      <div class="modal-actions">
        <button type="button" class="button-secondary" onclick="closeModal('studentCreatedModal')">Close</button>
      </div>
    </div>
  </div>

  <script src="/scripts.js"></script>
  ${status === 'student-created' ? `<script>window.addEventListener('DOMContentLoaded', () => openModal('studentCreatedModal'));</script>` : ''}
</body>
</html>`;

      res.send(html);
    });
  });
});

app.get('/staff', (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'staff') {
    return res.redirect('/login.html');
  }

  db.all('SELECT * FROM users WHERE role IS NULL OR LOWER(role) = ? ORDER BY gradeLevel, yearLevel, name', ['student'], (err, students) => {
    if (err) {
      return res.send('Unable to load student records.');
    }

    db.all('SELECT * FROM grades', (err2, grades) => {
      if (err2) {
        return res.send('Unable to load grade data.');
      }

      const gradesByUser = {};
      grades.forEach((grade) => {
        if (!gradesByUser[grade.userId]) {
          gradesByUser[grade.userId] = [];
        }
        gradesByUser[grade.userId].push(grade);
      });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Record Viewer</title>
  <link rel="icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="shortcut icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="page-shell">
    <div class="page-header">
      <div class="brand-row">
        <img class="logo-img" src="/TFVC-CLG_Logo.png" alt="TFVC College logo" />
        <div>
          <div class="brand">Staff Record Viewer</div>
          <p class="subtitle">View and print student records. This account cannot modify grades.</p>
        </div>
      </div>
      <div class="page-actions">
        <button type="button" class="theme-toggle-button" onclick="toggleTheme()">Switch to dark</button>
        <button type="button" class="tip-button" onclick="window.print()">Print records</button>
        <a class="button-logout" href="/logout">Sign out</a>
      </div>
    </div>

    <div class="dashboard-wrapper">
      <section class="card">
        <div class="brand">Staff access granted</div>
        <p class="subtitle">Student records are read-only here. Use the browser print button to generate a physical copy.</p>
      </section>

      ${students.map((student) => {
        const safeName = escapeHtml(student.name);
        const safeEmail = escapeHtml(student.email);
        const safeGradeLevel = escapeHtml(student.gradeLevel || 'Unknown major');
        const safeYearLevel = escapeHtml(student.yearLevel || 'Unspecified year');
        const studentGrades = gradesByUser[student.id] || [];

        return `
      <section class="card student-card">
        <div class="student-header">
          <div>
            <div class="brand">${safeName}</div>
            <p class="subtitle">${safeEmail}</p>
            <p class="subtitle"><strong>Course:</strong> ${safeGradeLevel} � <strong>Year level:</strong> ${safeYearLevel}</p>
          </div>
        </div>
        <div class="student-content">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Professor</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                ${studentGrades.length === 0 ? '<tr><td colspan="3">No grades recorded yet.</td></tr>' : studentGrades.map((grade) => `
                <tr><td>${escapeHtml(grade.subject)}</td><td>${escapeHtml(grade.teacher || 'N/A')}</td><td>${escapeHtml(grade.grade)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>`;
      }).join('')}
    </div>
  </div>

  <script src="/scripts.js"></script>
</body>
</html>`;

      res.send(html);
    });
  });
});

app.post('/dev/delete-user', requireDev, (req, res) => {
  const user = req.session.user;
  const targetId = parseInt(req.body.targetId, 10);
  if (!targetId || targetId === user.id) {
    return res.status(400).json({ error: 'Invalid user selected.' });
  }

  db.get('SELECT * FROM users WHERE id = ?', [targetId], (err, target) => {
    if (err || !target || normalizeRole(target.role) === 'dev') {
      return res.status(400).json({ error: 'Unable to delete selected account.' });
    }

    db.run('DELETE FROM grades WHERE userId = ?', [targetId], (gradeErr) => {
      if (gradeErr) {
        return res.status(500).json({ error: 'Unable to remove grades for the selected account.' });
      }
      db.run('DELETE FROM users WHERE id = ?', [targetId], (userErr) => {
        if (userErr) {
          return res.status(500).json({ error: 'Unable to delete the selected account.' });
        }
        res.json({ message: 'User deleted successfully.' });
      });
    });
  });
});

app.get('/dashboard', (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.redirect('/login.html');
  }

  db.all('SELECT * FROM grades WHERE userId = ?', [user.id], (err, grades) => {
    if (err) {
      return res.send('Unable to load grade data. <a href="/dashboard">Back</a>');
    }

    const numericGrades = grades
      .map((grade) => parseFloat(grade.grade))
      .filter((value) => !Number.isNaN(value));
    const gwa = numericGrades.length
      ? Math.round((numericGrades.reduce((sum, value) => sum + value, 0) / numericGrades.length) * 100) / 100
      : 'N/A';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal Grading System - Dashboard</title>
  <link rel="icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="shortcut icon" type="image/png" href="/TFVC-CLG_Logo.png" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="page-shell">
    <div class="page-header">
      <div class="brand-row">
        <img class="logo-img" src="/TFVC-CLG_Logo.png" alt="TFVC College logo" />
        <div>
          <div class="brand">Grading Portal</div>
          <p class="subtitle">Welcome back, ${escapeHtml(user.name)}. Your data is loaded from SQLite so this portal remains available after refresh.</p>
        </div>
      </div>
      <div class="page-actions">
        <button type="button" class="theme-toggle-button" onclick="toggleTheme()">Switch to dark</button>
        <button type="button" class="tip-button" onclick="openModal('suggestModal')">Need a tip?</button>
        <a class="button-logout" href="/logout">Sign out</a>
      </div>
    </div>

    <div class="dashboard-wrapper">
      <section class="card">
        <div class="brand">Hello, ${escapeHtml(user.name)}</div>
        <p class="subtitle">Review your current progress, course standing, and performance summary below.</p>
      </section>

      <section class="stats-grid">
        <div class="stat-card">
          <span>Overall GWA</span>
          <strong>${gwa}</strong>
        </div>
        <div class="stat-card">
          <span>Recorded Subjects</span>
          <strong>${grades.length}</strong>
        </div>
        <div class="stat-card">
          <span>Major</span>
          <strong>${escapeHtml(user.gradeLevel || 'Not set')}</strong>
        </div>
        <div class="stat-card">
          <span>Year level</span>
          <strong>${escapeHtml(user.yearLevel || 'Not set')}</strong>
        </div>
      </section>

      <section class="card">
        <h2>Grades by Subject</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Teacher</th>
                <th>Grade</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
${grades.length === 0 ? '              <tr><td colspan="4">No grades recorded yet.</td></tr>\n' : grades.map((grade) => {
      const numeric = parseFloat(grade.grade);
      const status = !Number.isNaN(numeric) && numeric <= 4.0 ? 'status-pass' : 'status-fail';
      const note = !Number.isNaN(numeric) ? (numeric <= 4.0 ? 'Passing' : 'Failed') : 'Invalid grade';
      return `              <tr><td>${escapeHtml(grade.subject)}</td><td>${escapeHtml(grade.teacher || 'N/A')}</td><td>${escapeHtml(grade.grade)}</td><td class="${status}">${escapeHtml(note)}</td></tr>\n`;
    }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>

  <div id="suggestModal" class="modal-backdrop" data-modal="suggestModal">
    <div class="modal-card">
      <h2>Study Suggestion</h2>
      <p>Set a weekly study target and use the portal regularly to keep your academic progress organized.</p>
      <div class="modal-actions">
        <button type="button" class="button-secondary" onclick="closeModal('suggestModal')">Close</button>
      </div>
    </div>
  </div>

  <script src="/scripts.js"></script>
</body>
</html>`;

    res.send(html);
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

initDb();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Portal server running at http://localhost:${port}`);
});
