import 'dotenv/config'
import pkg from 'pg'
import { betterAuth } from 'better-auth'

const { Pool } = pkg
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT || 5432,
})


export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
  },
})

export { pool }