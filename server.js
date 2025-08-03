// express
import express, { response } from 'express'
const app = express()
// dotenv
import 'dotenv/config'
// postgres
import { auth, pool } from "./auth.js"
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'

app.set("view engine", "ejs")
app.use(express.static('public'));

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.all("/api/auth/{*any}", toNodeHandler(auth));

async function initTables() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL,
      image TEXT,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      "expiresAt" TIMESTAMP NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMP,
      "refreshTokenExpiresAt" TIMESTAMP,
      scope TEXT,
      "idToken" TEXT,
      password TEXT,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL
    );
  `);
}

async function requireAuth(req, res, next) {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers)
    });

    if (!session || !session.user) {
        return res.redirect('/log-in');
    }

    // Add user info to request for use in routes
    req.user = session.user;

    next();
}
app.get('/', requireAuth ,async (req, res) => {
  res.render('index')
})

// user auth routes
app.get('/sign-up', (req, res) => {
    res.render('signup', { error: null })
})

app.post('/sign-up', async (req, res) => {
    const { email, password, name } = req.body;

    try {
        await auth.api.signUpEmail({
            body: {
                email,
                password,
                name,
            }

        })

        const response = await auth.api.signInEmail({
            body: { email, password },
            headers: fromNodeHeaders(req.body),
            asResponse: true
        })

        res.set('set-cookie', response.headers.get('set-cookie'));

        res.redirect('/')
    } catch (error) {
        if (error instanceof APIError) {
            res.render('signup', {
                error: error.message
            })

        }
    }
})
initTables()

app.get('/log-in', (req, res) => {
  res.render('login', { error: null })
})

app.post('/log-in', async (req, res) => {
  const { email, password } = req.body;

  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: fromNodeHeaders(req.headers),
    asResponse: true
  });

  if (!response.ok) {
    const error = await response.json()
    return res.render('login', { error: error.message || "asf" })
  }
  res.set('set-cookie', response.headers.get('set-cookie'));
  return res.redirect('/')
})

app.post('/logout', async (req, res) => {
  const result = await auth.api.signOut({
    headers: req.headers,
    asResponse: true
  })

  const setCookieHeader = result.headers.get('set-cookie');
  res.set('set-cookie', setCookieHeader);

  res.redirect('/log-in')
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
