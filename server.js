const express = require('express')
const axios   = require('axios')
const cors    = require('cors')
const fs      = require('fs')
const path    = require('path')
const jwt     = require('jsonwebtoken')
const bcrypt  = require('bcryptjs')

const app = express()
app.use(cors({ origin: '*', credentials: true }))
app.use(express.json())

const DATA_DIR  = path.join(__dirname, 'data')
const F = {
  users:   path.join(DATA_DIR, 'users.json'),
  alerts:  path.join(DATA_DIR, 'alerts.json'),
  seen:    path.join(DATA_DIR, 'seen.json'),
  history: path.join(DATA_DIR, 'history.json'),
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR)

const JWT_SECRET   = process.env.JWT_SECRET   || 'chilecompra-jwt-secret-2026'
const RESEND_KEY   = process.env.RESEND_API_KEY || ''
const FRONTEND_URL = process.env.FRONTEND_URL  || 'https://enremoto.cl'
const FROM_EMAIL   = process.env.FROM_EMAIL    || 'alertas@enremoto.cl'

function readJ(f, d) { try { return JSON.parse(fs.readFileSync(f,'utf8')) } catch { return d } }
function writeJ(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)) }

function auth(req, res, next) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' })
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Token inválido' }) }
}
function admin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' })
    next()
  })
}

// ── SSE ──────────────────────────────────────────────────────────
const clients = new Map()
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  try {
    const tk = (req.headers.authorization||'').replace('Bearer ','') || req.query.token || ''
    if (tk) req.user = jwt.verify(tk, JWT_SECRET)
  } catch {}
  if (!req.user) req.user = { id: 'anon', role: 'user' }
  const uid = req.user.id
  const ping = setInterval(() => res.write('event:ping\ndata:{}\n\n'), 25000)
  if (!clients.has(uid)) clients.set(uid, new Set())
  clients.get(uid).add(res)
  res.write('event:init\ndata:{"ok":true}\n\n')
  req.on('close', () => { clearInterval(ping); clients.get(uid)?.delete(res) })
})
function emit(uid, ev, d) { clients.get(uid)?.forEach(c => c.write('event:'+ev+'\ndata:'+JSON.stringify(d)+'\n\n')) }
function emitAll(ev, d) { clients.forEach(s => s.forEach(c => c.write('event:'+ev+'\ndata:'+JSON.stringify(d)+'\n\n'))) }

// ── Setup (primer usuario) ────────────────────────────────────────
app.get('/api/setup/status', (req, res) => {
  res.json({ needsSetup: readJ(F.users, []).length === 0 })
})
app.post('/api/setup', async (req, res) => {
  if (readJ(F.users, []).length > 0) return res.status(400).json({ error: 'Ya configurado' })
  const { email, password, name } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
  const user = { id: Date.now().toString(), email: email.toLowerCase(), name: name||'Admin', password: await bcrypt.hash(password, 12), role: 'admin', createdAt: new Date().toISOString() }
  writeJ(F.users, [user])
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } })
})

// ── Auth ──────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  const users = readJ(F.users, [])
  const user = users.find(u => u.email === email?.toLowerCase())
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Email o contraseña incorrectos' })
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } })
})
app.get('/api/auth/me', auth, (req, res) => {
  const user = readJ(F.users, []).find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'No encontrado' })
  res.json({ id: user.id, email: user.email, role: user.role, name: user.name })
})

// ── Admin: gestión directa de usuarios ───────────────────────────
app.get('/api/admin/users', admin, (req, res) => {
  res.json(readJ(F.users, []).map(u => ({ ...u, password: undefined })))
})

app.post('/api/admin/users', admin, async (req, res) => {
  const { email, password, name, role } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
  const users = readJ(F.users, [])
  if (users.find(u => u.email === email.toLowerCase())) return res.status(400).json({ error: 'Email ya existe' })
  const user = {
    id: Date.now().toString(),
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    password: await bcrypt.hash(password, 12),
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  }
  users.push(user)
  writeJ(F.users, users)
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role })
})

app.put('/api/admin/users/:id', admin, async (req, res) => {
  let users = readJ(F.users, [])
  const idx = users.findIndex(u => u.id === req.params.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' })
  if (req.body.password) req.body.password = await bcrypt.hash(req.body.password, 12)
  users[idx] = { ...users[idx], ...req.body, id: users[idx].id }
  writeJ(F.users, users)
  res.json({ ok: true })
})

app.delete('/api/admin/users/:id', admin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' })
  writeJ(F.users, readJ(F.users, []).filter(u => u.id !== req.params.id))
  res.json({ ok: true })
})

// ── Proxy ChileCompra ─────────────────────────────────────────────
app.get('/api/licitaciones', async (req, res) => {
  try {
    const { data } = await axios.get('https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?' + new URLSearchParams(req.query).toString(), { timeout: 15000 })
    res.json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/ordenesdecompra', async (req, res) => {
  try {
    const { data } = await axios.get('https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json?' + new URLSearchParams(req.query).toString(), { timeout: 15000 })
    res.json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Alerts ────────────────────────────────────────────────────────
app.get('/api/alerts', auth, (req, res) => {
  const all = readJ(F.alerts, [])
  res.json(req.user.role === 'admin' ? all : all.filter(a => a.userId === req.user.id))
})
app.post('/api/alerts', auth, (req, res) => {
  const alerts = readJ(F.alerts, [])
  const a = { id: Date.now().toString(), userId: req.user.id, userName: req.user.name, nombre: req.body.nombre||'Sin nombre', keywords: req.body.keywords||[], tipos: req.body.tipos||[], estados: req.body.estados||['5'], montoMin: req.body.montoMin||0, montoMax: req.body.montoMax||0, organismo: req.body.organismo||'', emailNotif: req.body.emailNotif!==false, activa: true, creadaEn: new Date().toISOString(), ultimaVez: null, matchCount: 0 }
  alerts.push(a); writeJ(F.alerts, alerts); res.json(a)
})
app.put('/api/alerts/:id', auth, (req, res) => {
  let alerts = readJ(F.alerts, [])
  const a = alerts.find(x => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'No encontrada' })
  if (a.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' })
  alerts = alerts.map(x => x.id === req.params.id ? { ...x, ...req.body, id: x.id, userId: x.userId } : x)
  writeJ(F.alerts, alerts); res.json({ ok: true })
})
app.delete('/api/alerts/:id', auth, (req, res) => {
  const alerts = readJ(F.alerts, [])
  const a = alerts.find(x => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'No encontrada' })
  if (a.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' })
  writeJ(F.alerts, alerts.filter(x => x.id !== req.params.id)); res.json({ ok: true })
})

// ── History ───────────────────────────────────────────────────────
app.get('/api/history', auth, (req, res) => {
  const all = readJ(F.history, [])
  const list = req.user.role === 'admin' ? all : all.filter(h => h.userId === req.user.id)
  res.json(list.slice(-200).reverse())
})
app.delete('/api/history', auth, (req, res) => {
  let all = readJ(F.history, [])
  writeJ(F.history, req.user.role === 'admin' ? [] : all.filter(h => h.userId !== req.user.id))
  res.json({ ok: true })
})

// ── Stats ─────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const all    = readJ(F.history, [])
  const hist   = req.user.role === 'admin' ? all : all.filter(h => h.userId === req.user.id)
  const alerts = readJ(F.alerts, []).filter(a => req.user.role === 'admin' || a.userId === req.user.id)
  const byAlert = {}, byDay = {}, byEstado = {}, byTipo = {}
  hist.forEach(h => {
    byAlert[h.alertaNombre] = (byAlert[h.alertaNombre]||0)+1
    byEstado[h.estado] = (byEstado[h.estado]||0)+1
    if (h.tipo) byTipo[h.tipo] = (byTipo[h.tipo]||0)+1
    if (Date.now()-new Date(h.fechaDetec).getTime() < 30*86400000) {
      const d = h.fechaDetec.split('T')[0]; byDay[d] = (byDay[d]||0)+1
    }
  })
  res.json({
    totalDetecciones: hist.length,
    alertasActivas: alerts.filter(a=>a.activa).length,
    totalAlertas: alerts.length,
    totalMonto: hist.reduce((s,h)=>s+(h.monto||0),0),
    byAlert: Object.entries(byAlert).sort(([,a],[,b])=>b-a).slice(0,8),
    byDay: Object.entries(byDay).sort(([a],[b])=>a.localeCompare(b)),
    byEstado: Object.entries(byEstado),
    byTipo: Object.entries(byTipo).sort(([,a],[,b])=>b-a).slice(0,8),
    recientes: hist.slice(-5).reverse(),
  })
})

// ── Polling ───────────────────────────────────────────────────────
function matchAlerta(l, a) {
  if (a.estados.length && !a.estados.includes(String(l.CodigoEstado))) return false
  if (a.tipos.length   && !a.tipos.includes(l.Tipo)) return false
  if (a.montoMin > 0   && (l.MontoEstimado||0) < a.montoMin) return false
  if (a.montoMax > 0   && (l.MontoEstimado||0) > a.montoMax) return false
  if (a.organismo && !(l.Organismo?.Nombre||'').toLowerCase().includes(a.organismo.toLowerCase())) return false
  if (a.keywords.length) {
    const txt = [l.Nombre,l.Descripcion,l.Organismo?.Nombre].filter(Boolean).join(' ').toLowerCase()
    if (!a.keywords.some(k=>k.trim()&&txt.includes(k.trim().toLowerCase()))) return false
  }
  return true
}

let TICKET = '', pollingTimer = null

async function runPolling() {
  const alerts = readJ(F.alerts, []).filter(a=>a.activa)
  if (!alerts.length || !TICKET) return
  console.log('[Polling]', new Date().toLocaleTimeString('es-CL'))
  try {
    const { data } = await axios.get('https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket='+encodeURIComponent(TICKET), { timeout: 20000 })
    const lista = data?.Listado||[]
    const seen  = readJ(F.seen, {})
    const history = readJ(F.history, [])
    let total = 0
    for (const alerta of alerts) {
      const nuevas = lista.filter(l=>matchAlerta(l,alerta)&&!seen[l.CodigoExterno+'_'+alerta.id])
      if (!nuevas.length) continue
      total += nuevas.length
      nuevas.forEach(l=>{ seen[l.CodigoExterno+'_'+alerta.id]=Date.now() })
      nuevas.forEach(l=>history.push({ alertaId:alerta.id, alertaNombre:alerta.nombre, userId:alerta.userId, codigo:l.CodigoExterno, nombre:l.Nombre, tipo:l.Tipo, monto:l.MontoEstimado, moneda:l.UnidadMonedaEstimadaDescripcion, organismo:l.Organismo?.Nombre, estado:l.CodigoEstado, fechaCierre:l.FechaCierre, fechaDetec:new Date().toISOString() }))
      const saved = readJ(F.alerts, [])
      const idx = saved.findIndex(a=>a.id===alerta.id)
      if (idx>=0) { saved[idx].matchCount=(saved[idx].matchCount||0)+nuevas.length; saved[idx].ultimaVez=new Date().toISOString(); writeJ(F.alerts,saved) }
      emit(alerta.userId, 'nuevasLicitaciones', { alertaId:alerta.id, alertaNombre:alerta.nombre, cantidad:nuevas.length, licitaciones:nuevas.slice(0,5) })
      console.log('[Match]', nuevas.length, '—', alerta.nombre)
    }
    const semana = 7*86400000
    Object.keys(seen).forEach(k=>{ if(Date.now()-seen[k]>semana) delete seen[k] })
    writeJ(F.seen, seen)
    writeJ(F.history, history.slice(-1000))
    emitAll('pollingOk', { hora:new Date().toISOString(), total:lista.length, nuevas:total })
  } catch(e) {
    console.error('[Polling error]', e.message)
    emitAll('pollingError', { mensaje:e.message })
  }
}

app.post('/api/polling/start', auth, (req, res) => {
  const min = Math.max(1, parseInt(req.body.intervalo)||5)
  TICKET = req.body.ticket || TICKET
  if (pollingTimer) clearInterval(pollingTimer)
  pollingTimer = setInterval(runPolling, min*60000)
  runPolling()
  res.json({ ok:true, min })
})
app.post('/api/polling/stop', auth, (req, res) => {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer=null }
  res.json({ ok:true })
})
app.get('/api/polling/status', auth, (req, res) => res.json({ activo: pollingTimer!==null }))

app.listen(3001, () => {
  console.log('✅  http://localhost:3001')
  console.log('📧  Email:', RESEND_KEY ? 'Resend configurado' : 'Sin configurar')
})
