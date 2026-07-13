# Portal Grading System

A simple portal grading system built with Node.js, Express, and SQLite.

## Features

- Local authentication with registration and login
- Admin and staff pages
- SQLite data storage
- Basic client-side validation

## Files

- `server.js` - main Express server
- `lib/auth.js` - authentication helpers
- `lib/db.js` - SQLite database connection
- `lib/middleware.js` - session and route helpers
- `login.html`, `register.html`, `admin.html` - UI pages
- `scripts.js` - client-side form handling
- `styles.css` - project styles
- `portal.db` - local SQLite database file

## Install

```powershell
cd C:\Users\johnl\portal
npm install
```

## Run

```powershell
npm start
```

Then open http://localhost:3000 in your browser.

## Notes

- `node_modules/` is excluded from Git tracking via `.gitignore`
- The repository is already pushed to GitHub at `https://github.com/yojohnnyx/tfvctaguigportal`
- To enable student OTP emails, set SMTP environment variables before starting the app:
  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=587`
  - `SMTP_SECURE=false`
  - `SMTP_USER=your-email@gmail.com`
  - `SMTP_PASS=your-app-password`
- If you use Outlook, set `SMTP_HOST=smtp-mail.outlook.com` and `SMTP_PORT=587`
- If you want to add more features, consider adding a README section for admin/staff workflows and database reset instructions.
