# BudgetWise Unified

Full stack BudgetWise app with Next.js frontend and Express Prisma backend.

## Tech Stack

* Frontend: Next.js, TypeScript
* Backend: Express, TypeScript, Prisma
* Database: PostgreSQL
* Mail server: Postfix 3.11+
* Auth: JWT
* Containerization: Docker, Docker Compose

## Project Structure

* backend: API server
* frontend: Next.js UI
* mail-server: files for mail server
* openapi: API contract for current and future endpoints
* design: reference prototypes if included

---

# Local Setup (Docker Recommended)

## Run Everything with Docker

From repo root:

docker compose up --build

Services:

* Frontend: http://localhost:3000
* Backend: http://localhost:5001
* PostgreSQL: localhost:5432
* Mail server: localhost:10025, localhost:10465, localhost:10587

Stop services:

docker compose down

### Import Mock Data with Docker

1\. Copy your spreadsheet into:

backend/mock-data/personal\_transactions\_budgetwise\_2025\_2026.xlsx

2\. Start DB + app:

docker compose up --build

3\. In a second terminal (repo root), run the one-off seed:

docker compose --profile tools run --rm mock-seed

This imports data for the mock user into the Docker Postgres database.
It is optional and does not change normal teammate startup.

---

# Local Development (Without Docker)

## 1. Database (PostgreSQL Required)

You must have PostgreSQL running locally.

Example connection string:

DATABASE\_URL="postgresql://myapp:secret@localhost:5432/myapp\_db"

---

## 2. Mail server

You must have Postfix 3.11 installed and running locally.
The details will depend upon your operating system.

---

## 3. Backend

From repo root:

cd backend

cp .env.example .env

Edit backend/.env:

* DATABASE\_URL="postgresql://myapp:secret@localhost:5432/myapp\_db"
* JWT\_SECRET="budgetwise\_dev\_secret\_9f3a2c1d7e6b5a4c8d1f0e9b2a7c6d5e"
* PORT=5001
* CORS\_ORIGIN="http://localhost:3000"
* Appropriately set or comment out each of the MAIL\_SERVER_* variables,
depending upon how you configured the mail server.
The defaults should probably suffice,
depending upon your configuration of the mail server,
of course.

Install and run:

npm install

npx prisma generate

npx prisma migrate dev --name init

npm run dev

For mock data: npm run dev:mock
(username and password for mock user is shown in terminal after using this command)

Backend runs on:

http://localhost:5001

---

## 4. Frontend

Open a second terminal:

cd frontend

npm install

npm run dev

Frontend runs on:

http://localhost:3000

---

# Database Commands

## Run migrations:

npx prisma migrate dev

## Generate client:

npx prisma generate

## Reset database:

npx prisma migrate reset

---

# Docker Commands

Start services:

docker compose up --build

Import mock data (docker version):

In second terminal: docker compose --profile tools run --rm mock-seed
Username + password for the mock data account will be given in terminal

Run in background:

docker compose up -d

Stop services:

docker compose down

View logs:

docker compose logs -f

---

# Troubleshooting

## Port 5001 already in use

lsof -nP -iTCP:5001 -sTCP:LISTEN

kill -9 &lt;PID&gt;

## Port 3000 already in use

npm run dev \-\- -p 3001

## Docker rebuild

docker compose down -v

docker compose up --build

---

# Notes

* Do not commit backend/.env
* Do not commit frontend/.env.local
* Do not commit node\_modules
* Keep API keys server side only
* Use PostgreSQL for all environments
