const express = require("express")
const axios = require("axios")
const cors = require("cors")

const app = express()
app.use(cors())
app.use(express.json())

app.get("/api/licitaciones", async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString()
    const url = "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?" + params
    const { data } = await axios.get(url)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get("/api/ordenesdecompra", async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString()
    const url = "https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json?" + params
    const { data } = await axios.get(url)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(3001, () => console.log("Proxy corriendo en http://localhost:3001"))
