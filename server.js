const express  = require('express')
const axios    = require('axios')
const cors     = require('cors')
const fs       = require('fs')
const path     = require('path')
const crypto   = require('crypto')
const jwt      = require('jsonwebtoken')
const bcrypt   = require('bcryptjs')

const app = express()
app.use(cors({ origin: '*', credentials: true }))
app.use(express.json())

// ── Config ────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data')
const F = {
  users:   path.join(DATA_DIR, 'users.json'),
  invites: path.join(DATA_DIR, 'invites.json'),
  alerts:  path.join(DATA_DIR, 'alerts.json'),
  seen:    path.join(DATA_DIR, 'seen.json'),
  history: path.join(DATA_DIR, 'history.json'),
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR)

const JWT_SECRET   = process.env.JWT_SECRET   || 'chilecompra-jwt-secret-2026'
const RESEND_KEY   = process.env.RESEND_API_KEY || ''
const FRONTEND_URL = process.env.FRONTEND_URL  || 'https://enremoto.cl'
const FROM_EMAIL   = process.env.FROM_EMAIL    || 'alertas@enremoto.cl'

// ── Helpers ───────────────────────────────────────────────────────
function readJ(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return def }
}
function writeJ(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

// ── Auth middleware ───────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' })
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Token inválido' }) }
}
function admin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos de admin' })
    next()
  })
}

// ── SSE ───────────────────────────────────────────────────────────
const clients = new Map()

app.get('/api/events', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const ping = setInterval(() => res.write('event:ping\ndata:{}\n\n'), 25000)
  const uid = req.user.id
  if (!clients.has(uid)) clients.set(uid, new Set())
  clients.get(uid).add(res)
  res.write('event:init\ndata:' + JSON.stringify({ ok: true }) + '\n\n')
  req.on('close', () => { clearInterval(ping); clients.get(uid)?.delete(res) })
})

function emit(userId, event, data) {
  const msg = 'event:' + event + '\ndata:' + JSON.stringify(data) + '\n\n'
  clients.get(userId)?.forEach(c => c.write(msg))
}
function emitAll(event, data) {
  clients.forEach(s => s.forEach(c => c.write('event:' + event + '\ndata:' + JSON.stringify(data) + '\n\n')))
}

// ── Email (Resend) ────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!RESEND_KEY) { console.log('[Email] Sin RESEND_API_KEY'); return false }
  try {
    await axios.post('https://api.resend.com/emails',
      { from: `Licitaciones ChileCompra <${FROM_EMAIL}>`, to, subject, html },
      { headers: { Authorization: 'Bearer ' + RESEND_KEY } }
    )
    console.log('[Email] Enviado a', to)
    return true
  } catch (e) {
    console.error('[Email error]', e.response?.data || e.message)
    return false
  }
}

function emailAlertHTML(alerta, nuevas) {
  const rows = nuevas.slice(0, 8).map(l => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-size:11px;color:#6b7280">${l.CodigoExterno}</td>
      <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:12px">${l.Nombre}</td>
      <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:11px;color:#6b7280;white-space:nowrap">${l.FechaCierre ? l.FechaCierre.split('T')[0] : '—'}</td>
    </tr>`).join('')
  return `
    <div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:24px;background:#fff">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div style="display:flex;gap:2px">
          <div style="width:4px;height:20px;background:#003087;border-radius:2px"></div>
          <div style="width:4px;height:20px;background:#fff;border:1px solid #ddd;border-radius:2px"></div>
          <div style="width:4px;height:20px;background:#D52B1E;border-radius:2px"></div>
        </div>
        <h2 style="margin:0;font-size:16px;color:#111">Explorador de Licitaciones</h2>
      </div>
      <div style="background:#dbeafe;border-radius:8px;padding:12px 16px;margin-bottom:16px">
        <p style="margin:0;font-size:13px;color:#1d4ed8">
          <strong>${nuevas.length} nueva${nuevas.length > 1 ? 's' : ''} licitación${nuevas.length > 1 ? 'es' : ''}</strong>
          detectada${nuevas.length > 1 ? 's' : ''} para la alerta <strong>"${alerta.nombre}"</strong>
        </p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead><tr style="background:#f9fafb">
          <th style="padding:8px;text-align:left;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb">CÓDIGO</th>
          <th style="padding:8px;text-align:left;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb">NOMBRE</th>
          <th style="padding:8px;text-align:left;font-size:10px;color:#6b7280;border-bottom:1px solid #e5e7eb">CIERRE</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${FRONTEND_URL}" style="display:inline-block;background:#D52B1E;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px">
        Ver en el explorador →
      </a>
      <p style="margin-top:20px;font-size:11px;color:#9ca3af">
        Puedes desactivar esta alerta ingresando al explorador en la sección Alertas.
      </p>
    </div>`
}

// ── Setup (primer usuario sin invitación) ─────────────────────────
app.get('/api/setup/status', (req, res) => {
  const users = readJ(F.users, [])
  res.json({ needsSetup: users.length === 0 })
})

app.post('/api/setup', async (req, res) => {
  const users = readJ(F.users, [])
  if (users.length > 0) return res.status(400).json({ error: 'El sistema ya fue configurado' })
  const { email, password, name } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
  const hashed = await bcrypt.hash(password, 12)
  const user = {
    id: Date.now().toString(), email: email.toLowerCase(),
    name: name || 'Admin', password: hashed, role: 'admin',
    createdAt: new Date().toISOString(),
  }
  writeJ(F.users, [user])
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } })
})

// ── Auth ──────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  const users = readJ(F.users, [])
  const user = users.find(u => u.email === email.toLowerCase())
  if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' })
  const ok = await bcrypt.compare(password, user.password)
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' })
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } })
})

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, inviteToken } = req.body
  const invites = readJ(F.invites, [])
  const invite  = invites.find(i => i.token === inviteToken && !i.usedAt)
  if (!invite) return res.status(400).json({ error: 'Invitación inválida o ya utilizada' })
  if (invite.email && invite.email !== email.toLowerCase()) return res.status(400).json({ error: 'Esta invitación es para otro email' })
  const users = readJ(F.users, [])
  if (users.find(u => u.email === email.toLowerCase())) return res.status(400).json({ error: 'Email ya registrado' })
  const hashed = await bcrypt.hash(password, 12)
  const user = {
    id: Date.now().toString(), email: email.toLowerCase(),
    name: name || email.split('@')[0], password: hashed, role: 'user',
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  writeJ(F.users, users)
  const idx = invites.findIndex(i => i.token === inviteToken)
  invites[idx].usedAt = new Date().toISOString()
  invites[idx].usedBy = user.id
  writeJ(F.invites, invites)
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } })
})

app.get('/api/auth/me', auth, (req, res) => {
  const user = readJ(F.users, []).find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'No encontrado' })
  res.json({ id: user.id, email: user.email, role: user.role, name: user.name })
})

// ── Admin: invitaciones ───────────────────────────────────────────
app.post('/api/admin/invites', admin, async (req, res) => {
  const { email } = req.body
  const token = crypto.randomBytes(32).toString('hex')
  const invites = readJ(F.invites, [])
  const invite = { token, email: email?.toLowerCase() || null, createdAt: new Date().toISOString(), createdBy: req.user.id, usedAt: null, usedBy: null }
  invites.push(invite)
  writeJ(F.invites, invites)
  const url = `${FRONTEND_URL}?invite=${token}`
  if (email && RESEND_KEY) {
    await sendEmail({
      to: email,
      subject: 'Invitación al Explorador de Licitaciones',
      html: `
        <div style="font-family:system-ui;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#D52B1E">🇨🇱 Explorador de Licitaciones ChileCompra</h2>
          <p>Has sido invitado a acceder al sistema de monitoreo de licitaciones públicas.</p>
          <a href="${url}" style="display:inline-block;background:#D52B1E;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
            Crear mi cuenta →
          </a>
          <p style="color:#9ca3af;font-size:12px">O copia este enlace: ${url}</p>
          <p style="color:#9ca3af;font-size:12px">Este enlace es de un solo uso.</p>
        </div>`
    })
  }
  res.json({ invite, url })
})

app.get('/api/admin/invites', admin, (req, res) => {
  res.json(readJ(F.invites, []).slice().reverse())
})

app.delete('/api/admin/invites/:token', admin, (req, res) => {
  writeJ(F.invites, readJ(F.invites, []).filter(i => i.token !== req.params.token))
  res.json({ ok: true })
})

// ── Admin: usuarios ───────────────────────────────────────────────
app.get('/api/admin/users', admin, (req, res) => {
  res.json(readJ(F.users, []).map(u => ({ ...u, password: undefined })))
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

// ── Alerts (per-user) ─────────────────────────────────────────────
app.get('/api/alerts', auth, (req, res) => {
  const all = readJ(F.alerts, [])
  res.json(req.user.role === 'admin' ? all : all.filter(a => a.userId === req.user.id))
})

app.post('/api/alerts', auth, (req, res) => {
  const alerts = readJ(F.alerts, [])
  const a = {
    id: Date.now().toString(), userId: req.user.id, userName: req.user.name,
    nombre: req.body.nombre || 'Sin nombre',
    keywords: req.body.keywords || [], tipos: req.body.tipos || [],
    estados: req.body.estados || ['5'],
    montoMin: req.body.montoMin || 0, montoMax: req.body.montoMax || 0,
    organismo: req.body.organismo || '', emailNotif: req.body.emailNotif !== false,
    activa: true, creadaEn: new Date().toISOString(), ultimaVez: null, matchCount: 0,
  }
  alerts.push(a)
  writeJ(F.alerts, alerts)
  res.json(a)
})

app.put('/api/alerts/:id', auth, (req, res) => {
  let alerts = readJ(F.alerts, [])
  const a = alerts.find(x => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'No encontrada' })
  if (a.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' })
  alerts = alerts.map(x => x.id === req.params.id ? { ...x, ...req.body, id: x.id, userId: x.userId } : x)
  writeJ(F.alerts, alerts)
  res.json({ ok: true })
})

app.delete('/api/alerts/:id', auth, (req, res) => {
  const alerts = readJ(F.alerts, [])
  const a = alerts.find(x => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'No encontrada' })
  if (a.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' })
  writeJ(F.alerts, alerts.filter(x => x.id !== req.params.id))
  res.json({ ok: true })
})

// ── History (per-user) ────────────────────────────────────────────
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

// ── Dashboard stats ───────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const all     = readJ(F.history, [])
  const hist    = req.user.role === 'admin' ? all : all.filter(h => h.userId === req.user.id)
  const alerts  = readJ(F.alerts, []).filter(a => req.user.role === 'admin' || a.userId === req.user.id)

  const byAlert = {}, byDay = {}, byEstado = {}, byTipo = {}
  const now = Date.now()

  hist.forEach(h => {
    byAlert[h.alertaNombre] = (byAlert[h.alertaNombre] || 0) + 1
    byEstado[h.estado] = (byEstado[h.estado] || 0) + 1
    if (h.tipo) byTipo[h.tipo] = (byTipo[h.tipo] || 0) + 1
    if (now - new Date(h.fechaDetec).getTime() < 30 * 86400000) {
      const d = h.fechaDetec.split('T')[0]
      byDay[d] = (byDay[d] || 0) + 1
    }
  })

  res.json({
    totalDetecciones: hist.length,
    alertasActivas:   alerts.filter(a => a.activa).length,
    totalAlertas:     alerts.length,
    totalMonto:       hist.reduce((s, h) => s + (h.monto || 0), 0),
    byAlert:  Object.entries(byAlert).sort(([,a],[,b]) => b - a).slice(0, 8),
    byDay:    Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)),
    byEstado: Object.entries(byEstado),
    byTipo:   Object.entries(byTipo).sort(([,a],[,b]) => b - a).slice(0, 8),
    recientes: hist.slice(-5).reverse(),
  })
})

// ── Polling ───────────────────────────────────────────────────────
function matchAlerta(l, a) {
  if (a.estados.length && !a.estados.includes(String(l.CodigoEstado))) return false
  if (a.tipos.length   && !a.tipos.includes(l.Tipo)) return false
  if (a.montoMin > 0   && (l.MontoEstimado || 0) < a.montoMin) return false
  if (a.montoMax > 0   && (l.MontoEstimado || 0) > a.montoMax) return false
  if (a.organismo && !(l.Organismo?.Nombre || '').toLowerCase().includes(a.organismo.toLowerCase())) return false
  if (a.keywords.length) {
    const txt = [l.Nombre, l.Descripcion, l.Organismo?.Nombre].filter(Boolean).join(' ').toLowerCase()
    if (!a.keywords.some(k => k.trim() && txt.includes(k.trim().toLowerCase()))) return false
  }
  return true
}

let TICKET = '', pollingTimer = null

async function runPolling() {
  const alerts = readJ(F.alerts, []).filter(a => a.activa)
  if (!alerts.length || !TICKET) return
  console.log('[Polling]', new Date().toLocaleTimeString('es-CL'))
  try {
    const { data } = await axios.get(
      'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=' + encodeURIComponent(TICKET),
      { timeout: 20000 }
    )
    const lista   = data?.Listado || []
    const seen    = readJ(F.seen, {})
    const history = readJ(F.history, [])
    let total = 0

    for (const alerta of alerts) {
      const nuevas = lista.filter(l => matchAlerta(l, alerta) && !seen[l.CodigoExterno + '_' + alerta.id])
      if (!nuevas.length) continue
      total += nuevas.length
      nuevas.forEach(l => { seen[l.CodigoExterno + '_' + alerta.id] = Date.now() })
      nuevas.forEach(l => history.push({
        alertaId: alerta.id, alertaNombre: alerta.nombre, userId: alerta.userId,
        codigo: l.CodigoExterno, nombre: l.Nombre, tipo: l.Tipo,
        monto: l.MontoEstimado, moneda: l.UnidadMonedaEstimadaDescripcion,
        organismo: l.Organismo?.Nombre, estado: l.CodigoEstado,
        fechaCierre: l.FechaCierre, fechaDetec: new Date().toISOString(),
      }))

      // Update matchCount
      const saved = readJ(F.alerts, [])
      const idx   = saved.findIndex(a => a.id === alerta.id)
      if (idx >= 0) { saved[idx].matchCount = (saved[idx].matchCount || 0) + nuevas.length; saved[idx].ultimaVez = new Date().toISOString(); writeJ(F.alerts, saved) }

      // SSE notify
      emit(alerta.userId, 'nuevasLicitaciones', { alertaId: alerta.id, alertaNombre: alerta.nombre, cantidad: nuevas.length, licitaciones: nuevas.slice(0, 5) })

      // Email notify
      if (alerta.emailNotif) {
        const user = readJ(F.users, []).find(u => u.id === alerta.userId)
        if (user?.email) await sendEmail({ to: user.email, subject: `🔔 ${nuevas.length} nueva${nuevas.length > 1 ? 's' : ''} licitación${nuevas.length > 1 ? 'es' : ''} — ${alerta.nombre}`, html: emailAlertHTML(alerta, nuevas) })
      }
      console.log('[Match]', nuevas.length, 'nuevas —', alerta.nombre)
    }

    // Cleanup
    const semana = 7 * 86400000
    Object.keys(seen).forEach(k => { if (Date.now() - seen[k] > semana) delete seen[k] })
    writeJ(F.seen, seen)
    writeJ(F.history, history.slice(-1000))
    emitAll('pollingOk', { hora: new Date().toISOString(), total: lista.length, nuevas: total })
  } catch (e) {
    console.error('[Polling error]', e.message)
    emitAll('pollingError', { mensaje: e.message })
  }
}

app.post('/api/polling/start', auth, (req, res) => {
  const min = Math.max(1, parseInt(req.body.intervalo) || 5)
  TICKET = req.body.ticket || TICKET
  if (pollingTimer) clearInterval(pollingTimer)
  pollingTimer = setInterval(runPolling, min * 60000)
  runPolling()
  res.json({ ok: true, min })
})

app.post('/api/polling/stop', auth, (req, res) => {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null }
  res.json({ ok: true })
})

app.get('/api/polling/status', auth, (req, res) => {
  res.json({ activo: pollingTimer !== null })
})

app.listen(3001, () => {
  console.log('✅  http://localhost:3001')
  console.log('📧  Email:', RESEND_KEY ? 'Resend configurado' : 'Sin configurar (setea RESEND_API_KEY)')
})
