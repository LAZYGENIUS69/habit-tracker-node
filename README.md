# Habit Tracker with Streaks

**Language:** Node.js &nbsp;|&nbsp; **Needs:** Postgres + Redis

This is a **starter**. The application already works. Your job is everything
that gets it building, tested and running in CI.

---

## You do not need Node.js installed

You will build this into a container, and the container brings its own
Node 20. If you have never written a line of Node.js, you can still finish
this assignment — you are not being asked to extend the app, you are being
asked to ship it.

Read the two sections below in order. The first tells you what the app needs;
the second is how you turn that into a Dockerfile.

---

## 1. What this app actually needs

This is the whole contract. Everything in your Dockerfile and compose file
comes from this table.

| | |
|---|---|
| **Runtime** | Node 20 |
| **Install dependencies** | `npm install` |
| **Start the app** | `node src/server.js` |
| **Listens on** | port 8080, bound to `0.0.0.0` |
| **Environment variables** | `DATABASE_URL`, `REDIS_URL`, `PORT` |
| **Needs running first** | Postgres, Redis, and the migrations applied |

### Endpoints

```
GET    /health                  is it alive, and are Postgres and Redis reachable
GET    /habits                  every habit with its current streak and longest ever
POST   /habits                  {"name": "Read 20 pages", "schedule": [1,3,5]}
POST   /habits/:id/tick         mark today done
DELETE /habits/:id/tick         undo today
```

`/health` reports Postgres and Redis **separately**. Use it constantly:
if it says `postgres: false`, the app started fine and your compose wiring
is wrong — do not go looking in the application code.

### Migrations

`migrations/` holds `.sql` files that must be applied **in filename order**,
before the app starts. They create the tables and insert sample data, so the
app is worth looking at the first time you run it.

You do not need an ORM or a migration tool. A container running `psql` over
the files in order is enough, and works whatever language the app is in.

---

## 2. What you must write

| File | What it has to do |
|---|---|
| `Dockerfile` | Build this app into an image. Install dependencies **before** copying the source, pin the base image version, and do not run as root. |
| `docker-compose.yml` | Start the app, Postgres, Redis and a migration step with one `docker compose up`. |
| `.circleci/config.yml` | lint → unit tests → integration tests → secret scan → image build |
| Unit tests | For `src/streaks.js`. No database, no network. |
| Integration tests | Against a real Postgres and Redis as CircleCI service containers. |

Then push your image to **your own Docker Hub account**, tagged with a real
version number — `:1.0`, not only `:latest`.

### When it works

```bash
docker compose up --build
curl localhost:8080/health
```

```json
{"status":"ok","postgres":true,"redis":true}
```

Both true, or you are not finished.

---

## 3. If you want to run it without Docker first

Optional, and only useful if you already have Node 20. Most people should
skip straight to the Dockerfile — the whole point is that the container
removes this step.

```bash
npm install
export DATABASE_URL=...
node src/server.js
```

---

## Where the marks are

`src/streaks.js` is **pure logic** — plain functions over plain data, no database and
no HTTP. That is deliberate, so a 70% coverage target is achievable rather
than busywork. Start your tests there.

There is no test runner wired up yet. Add one (Jest or node:test), and remember CI runs `npm test`.

## The hard part

Timezones. 'Today' for a user in Bangalore is not today in UTC, and a streak must not break because the server rolled over first. Decide where 'today' is defined and defend it.

### Timezone Decision & Audit

The unit test suite passes all 27 tests identically across `TZ=UTC`, `TZ=Asia/Kolkata`, and `TZ=Pacific/Kiritimati`.

This happens because `src/streaks.js` is a pure calculation layer: functions receive explicit calendar dates as arguments rather than inspecting the system clock. The streak calculation itself is fully deterministic.

However, passing unit tests does not mean the application is timezone-safe.

The actual timezone boundary is in `src/server.js`:
```javascript
const today = () => toKey(new Date());
```

`new Date()` captures a physical instant, but `toKey()` converts it to calendar fields using UTC. Around midnight, the UTC date and the user's local calendar date diverge. For example, at 02:00 IST in Bangalore (`UTC+05:30`), it is still 20:30 of the previous day in UTC. A habit completed at that moment is attributed to yesterday rather than today.

**Conclusion:** The streak calculation is deterministic; deriving "today" at the HTTP layer is the timezone-sensitive boundary.

Fixing this requires changing how the server determines the client's current calendar day (e.g. accepting a timezone header or explicit date). We deliberately defer that change to the dedicated timezone package to avoid altering application behavior during the testing package.

---

## Getting unstuck

| Symptom | Almost always |
|---|---|
| `/health` says `postgres: false` | Wrong hostname. Inside compose the host is the **service name**, not `localhost`. |
| Page will not load, logs look fine | No `ports:` mapping, or the app is bound to `127.0.0.1` instead of `0.0.0.0`. |
| `relation "..." does not exist` | Migrations did not run, or the app started before they finished. |
| Build takes minutes every time | `COPY . .` is above your dependency install. |
| CI cannot reach the database | In CircleCI service containers the host **is** `localhost` — the opposite of compose. |

---
## Demo
Docker Compose and Kubernetes deployment verified locally.
## Kubernetes Deployment (Minikube)

For running Habit Tracker on a local Kubernetes cluster with declarative Deployments, persistent storage (PVC), one-shot migration Jobs, and health probes, see the [Kubernetes Deployment Guide](kube/README.md).

