// express
import express from 'express'
const app = express()
// dotenv
import 'dotenv/config'
// postgres/betterauth
import { auth, pool } from "./auth.js"
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { APIError } from 'better-auth/api'
// plaid
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
// crypto
import crypto from 'crypto'
// ejs
app.set("view engine", "ejs")
app.use(express.static('public'));

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.all("/api/auth/{*any}", toNodeHandler(auth));

async function initTables() {
  // await pool.query(`DROP TABLE IF EXISTS calories CASCADE`);
  // await pool.query(`DROP TABLE IF EXISTS "account" CASCADE`);
  // await pool.query(`DROP TABLE IF EXISTS "verification" CASCADE`);
  // await pool.query(`DROP TABLE IF EXISTS "session" CASCADE`);
  // await pool.query(`DROP TABLE IF EXISTS "user" CASCADE`);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS "plaid_account" (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "itemId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "institutionName" TEXT,
    "institutionId" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

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
initTables()


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

// plaid routes
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,

  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});


const plaidClient = new PlaidApi(configuration);

app.get('/api/create_link_token', requireAuth, async (req, res) => {
  const userId = req.user.id

  const config = {
    user: { client_user_id: userId },
    products: ['transactions'],
    client_name: 'broke be gone',
    language: 'en',
    country_codes: ['US']
  }

  const tokenResponse = await plaidClient.linkTokenCreate(config)
  res.json({ link_token: tokenResponse.data.link_token })
})

app.post('/api/exchange_public_token', requireAuth, async (req, res) => {
  const { public_token } = req.body
  const userId = req.user.id

  const tokenResponse = await plaidClient.itemPublicTokenExchange({ public_token })
  const accessToken = tokenResponse.data.access_token
  const itemId = tokenResponse.data.item_id

  // store institution
  const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
  const institutionId = itemResponse.data.item.institution_id;

  let institutionName = null;

  if (institutionId) {
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ['US'],
    });
    institutionName = institutionResponse.data.institution.name;
  }
  
  const id = crypto.randomUUID()
  const now = new Date()
  await pool.query(
    `
        INSERT INTO "plaid_account" (
          id, "userId", "itemId", "accessToken",
          "institutionId", "institutionName",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
    [id, userId, itemId, accessToken, institutionId, institutionName, now, now]
  );

  res.json({ success: true })
})

app.get('/api/balance', requireAuth, async (req, res) => {
  const userId = req.user.id

  const result = await pool.query(
    'SELECT "accessToken" FROM plaid_account WHERE "userId" = $1',
    [userId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({
      error: 'No access token found for user'
    });
  }

  const allBalances = []
  for (let i = 0; i < result.rows.length; i++) {
    const accessToken = result.rows[i].accessToken
    const balanceResponse = await plaidClient.accountsBalanceGet({ access_token: accessToken })
    const accounts = balanceResponse.data.accounts

    for (let j = 0; j < accounts.length; j++) {
      allBalances.push(accounts[j])
    }
  }

  res.json({ accounts: allBalances })
})

// route route
app.get('/', requireAuth, async (req, res) => {
  res.render('index')
  // const userId = req.user
  // console.log(userId);

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
