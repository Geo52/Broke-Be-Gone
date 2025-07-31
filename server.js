// express
import express, { response } from 'express'
const app = express()
// dotenv
import 'dotenv/config'
// postgres
import { pool } from "./auth.js"


app.get('/', async(req, res) => {
    res.send('Hello World!')
})


const port = 3000
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
