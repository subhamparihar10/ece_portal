# ECE Department Portal

Self-hosted website for the Electronics & Communication department. No internet needed after installation:
the database is a local SQLite file, uploads are stored on disk, and the frontend uses no CDN or web fonts.

## Run
1. Install Node.js 18+ (once, with internet).
2. In this folder run `npm install` (once, with internet), then `npm start`.
3. Open http://localhost:3000. Others on the same Wi-Fi/LAN use `http://<this-pc-ip>:3000`.

First login: `admin@ece.local` / `Admin@12345`. Change it by clicking your name (top right) > Change password.
To choose your own first admin, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables (see `.env.example`) before the first run.

## Deploy on Render
1. Put this folder in a GitHub repo (`node_modules`, `.env`, `data/`, `uploads/` are git-ignored).
2. Render dashboard > **New > Blueprint** > pick the repo. Render reads `render.yaml`.
3. When asked, enter `ADMIN_EMAIL` and `ADMIN_PASSWORD` (used only on first start to create the admin).
4. Wait for the deploy; open the `https://<name>.onrender.com` URL and log in.

`render.yaml` uses the **Starter** plan because the database (`ece.db`) and uploaded files live on a persistent disk
mounted at `/var/data` (`DATA_DIR`, `UPLOAD_DIR`). Free web services have no persistent disk: every restart or redeploy
would wipe users, files and records. A persistent disk also limits the service to one instance (no scaling out).
If `ADMIN_PASSWORD` is left unset in production, a random one is printed once in the deploy logs.
HTTPS comes from Render, so cookies are marked secure and the offline service worker works on every device.
Backup: Manage > Backup (database) plus the `uploads/` files; Render's disk snapshots also cover both.

## Roles
- **Student**: registers on their own, uploads files (held for review), posts remarks, downloads.
- **Faculty**: uploads publish instantly; reviews student uploads; edits subjects/syllabus; posts notices.
- **Admin**: everything, plus users and roles, password resets, activity log, database backup, deleting subjects.
  Promote a faculty member under Manage > Users.

## Customise
Edit `public/config.js` (college name, department, contact). Add subjects under Manage > Subjects & syllabus.

## Where things live
| What | Where |
|---|---|
| Database (users, subjects, file records, remarks, notices, audit log) | `data/ece.db` |
| Uploaded files | `uploads/` |
| Login secret | `data/.secret` (auto-generated) |
| API | `server.js` |
| Schema and starter subjects | `db.js` |
| Frontend | `public/` |

**Backup**: Manage > Backup downloads the database; copy `uploads/` too. Restore = put both back and restart.

## Offline behaviour
The server needs zero internet. In the browser, a service worker also saves the site, subject list, library list and every file
a user has opened, so those stay readable if the connection to the server drops. Browsers only allow service workers on
`localhost` or HTTPS, so for that extra layer on other devices put the site behind HTTPS (Caddy or nginx) and set `COOKIE_SECURE=1`.

## API summary
- `POST /api/auth/register|login|logout|password`, `GET /api/auth/me`
- `GET|POST /api/resources`, `GET /api/resources/:id`, `/:id/download`, `/:id/view`, `PATCH /:id/status`, `DELETE /:id`
- `GET|POST|PUT|DELETE /api/subjects`, `GET|POST|DELETE /api/remarks`, `GET|POST|DELETE /api/notices`
- `GET /api/admin/stats|users|audit|backup`, `PATCH|DELETE /api/admin/users/:id`

## Security notes
Passwords are bcrypt-hashed, sessions use httpOnly cookies, uploads are renamed and type-restricted (25 MB), login is
rate-limited, and the frontend never inserts user text as HTML.
