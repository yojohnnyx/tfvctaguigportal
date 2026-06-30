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
- If you want to add more features, consider adding a README section for admin/staff workflows and database reset instructions.
