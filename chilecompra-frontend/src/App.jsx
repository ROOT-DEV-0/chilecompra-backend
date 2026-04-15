import { useState, useMemo, useEffect, useRef, useCallback } from "react";

const SERVER = "https://chilecompra-backend-production.up.railway.app";
const BASE   = SERVER + "/api/licitaciones";
const TICKET = "E546CB25-483D-4EB2-9FBC-D927DB75FFCA";

// ── Datos de referencia ───────────────────────────────────────────
const ESTADOS = {
  "5":  { label:"Publicada",  bg:"#dbeafe", color:"#1d4ed8" },
  "6":  { label:"Cerrada",    bg:"#f3f4f6", color:"#6b7280" },
  "7":  { label:"Desierta",   bg:"#fee2e2", color:"#b91c1c" },
  "8":  { label:"Adjudicada", bg:"#dcfce7", color:"#15803d" },
  "18": { label:"Revocada",   bg:"#fef9c3", color:"#a16207" },
  "19": { label:"Suspendida", bg:"#fef9c3", color:"#a16207" },
};
const TIPOS = {
  "L1":"Licitación Pública < 100 UTM","LE":"Licitación Pública 100–1.000 UTM",
  "LP":"Licitación Pública > 1.000 UTM","LS":"Servicios Personales Especializados",
  "A1":"Licitación Privada (sin oferentes)","B1":"Licitación Privada otras causales",
  "CO":"Licitación Privada 100–1.000 UTM","B2":"Licitación Privada > 1.000 UTM",
  "D1":"Trato Directo Proveedor Único","E2":"Licitación Privada < 100 UTM",
  "C1":"Compra Directa OC","C2":"Trato Directo Cotización","R1":"OC < 3 UTM",
  "CA":"OC sin resolución","SE":"Sin emisión automática","AG":"Compra Ágil",
};

// ── Utils ─────────────────────────────────────────────────────────
function toApi(s){ if(!s)return""; const[y,m,d]=s.split("-"); return`${d}${m}${y}`; }
function today(){ return new Date().toISOString().split("T")[0]; }
function fmtD(iso){ return iso?iso.split("T")[0]:"—"; }
function fmtM(m,u){ return m>0?`${u||"CLP"} ${Number(m).toLocaleString("es-CL")}`:null; }
function fmtHora(iso){ if(!iso)return"—"; const d=new Date(iso); return d.toLocaleDateString("es-CL")+" "+d.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}); }

function api(path, opts={}) {
  const token = localStorage.getItem("token");
  return fetch(SERVER + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());
}

function Badge({ c }) {
  const e = ESTADOS[String(c)];
  return <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:99, background:e?.bg||"#f3f4f6", color:e?.color||"#6b7280", whiteSpace:"nowrap" }}>{e?.label||`Estado ${c}`}</span>;
}

// ── Estilos base ──────────────────────────────────────────────────
const S = {
  inp:   { fontSize:12, height:32, boxSizing:"border-box", width:"100%", padding:"0 8px", border:"1px solid #e5e7eb", borderRadius:6, background:"white", color:"#111", outline:"none" },
  lbl:   { fontSize:9, fontWeight:600, color:"#9ca3af", letterSpacing:"0.06em", marginBottom:4, display:"block" },
  card:  { background:"white", border:"1px solid #e5e7eb", borderRadius:10, padding:"14px", marginBottom:8 },
  red:   { background:"#D52B1E", color:"white", border:"none", borderRadius:6, cursor:"pointer", fontWeight:600 },
  ghost: { background:"transparent", border:"1px solid #e5e7eb", borderRadius:6, cursor:"pointer", color:"#374151" },
};

const MODES = [
  {id:"activas",label:"Activas hoy"}, {id:"fecha_estado",label:"Fecha / Estado"},
  {id:"codigo",label:"Por código"}, {id:"organismo",label:"Organismo"}, {id:"proveedor",label:"Proveedor"},
];

// ── Exportar ICS ──────────────────────────────────────────────────
function exportICS(items) {
  function icsDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toISOString().replace(/[-:]/g,"").split(".")[0]+"Z";
  }
  const events = items.filter(h => h.fechaCierre).map(h => {
    const dt = icsDate(h.fechaCierre);
    return [
      "BEGIN:VEVENT",
      "DTSTART:" + dt,
      "DTEND:" + dt,
      "SUMMARY:Cierre: " + (h.nombre||"").replace(/[,;\\]/g," ").slice(0,60),
      "DESCRIPTION:Código: " + h.codigo + "\\nOrganismo: " + (h.organismo||"") + "\\nAlerta: " + (h.alertaNombre||""),
      "URL:https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs=WgLuBLRjJcBU5dIg43fZAQ==&idlicitacion=" + h.codigo,
      "END:VEVENT"
    ].join("\r\n");
  });
  const cal = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//ChileCompra//Licitaciones//ES","CALSCALE:GREGORIAN", ...events,"END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([cal], { type:"text/calendar;charset=utf-8" }));
  a.download = "licitaciones_cierres.ics";
  a.click();
}

// ── Dashboard mini-chart ──────────────────────────────────────────
function BarChart({ data, color="#D52B1E", label="" }) {
  if (!data?.length) return <p style={{ fontSize:11, color:"#9ca3af", textAlign:"center", padding:"1rem 0" }}>Sin datos</p>;
  const max = Math.max(...data.map(([,v]) => v));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      {data.map(([k, v]) => (
        <div key={k} style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:10, color:"#6b7280", minWidth:80, textAlign:"right", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={k}>{k}</span>
          <div style={{ flex:1, background:"#f3f4f6", borderRadius:3, overflow:"hidden", height:14 }}>
            <div style={{ width:`${(v/max)*100}%`, background:color, height:"100%", borderRadius:3, transition:"width 0.4s" }}/>
          </div>
          <span style={{ fontSize:10, fontWeight:600, minWidth:24, color:"#111" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data }) {
  if (!data?.length) return <p style={{ fontSize:11, color:"#9ca3af", textAlign:"center", padding:"1rem 0" }}>Sin datos (últimos 30 días)</p>;
  const max = Math.max(...data.map(([,v]) => v), 1);
  const W=320, H=80, pad=8;
  const pts = data.map(([,v], i) => {
    const x = pad + (i / Math.max(data.length-1, 1)) * (W - pad*2);
    const y = H - pad - ((v/max) * (H - pad*2));
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:80 }}>
      <polyline points={pts} fill="none" stroke="#D52B1E" strokeWidth="2" strokeLinejoin="round"/>
      {data.map(([d,v], i) => {
        const x = pad + (i / Math.max(data.length-1, 1)) * (W - pad*2);
        const y = H - pad - ((v/max) * (H - pad*2));
        return <circle key={i} cx={x} cy={y} r="3" fill="#D52B1E"/>;
      })}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser]         = useState(null);
  const [authCheck, setAuthCheck] = useState(false);
  const [screen, setScreen]     = useState("login"); // login | register | setup | app
  const [inviteToken, setInviteToken] = useState("");

  // Auth form
  const [authForm, setAuthForm] = useState({ email:"", password:"", name:"" });
  const [authErr, setAuthErr]   = useState("");
  const [authLoad, setAuthLoad] = useState(false);

  // App state
  const [tab, setTab]           = useState("dashboard");
  const [alerts, setAlerts]     = useState([]);
  const [history, setHistory]   = useState([]);
  const [stats, setStats]       = useState(null);
  const [polling, setPolling]   = useState(false);
  const [pollingMin, setPollingMin] = useState(5);
  const [lastPoll, setLastPoll] = useState(null);
  const [badge, setBadge]       = useState(0);
  const [toasts, setToasts]     = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editAlert, setEditAlert] = useState(null);
  const [form, setForm]         = useState({ nombre:"", keywords:"", tipos:[], estados:["5"], montoMin:"", montoMax:"", organismo:"", emailNotif:true });
  const [showRef, setShowRef]   = useState(false);

  // Admin
  const [adminTab, setAdminTab] = useState("usuarios");
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminInvites, setAdminInvites] = useState([]);
  const [inviteEmail, setInviteEmail]   = useState("");
  const [inviteLink, setInviteLink]     = useState("");

  // Buscar
  const [mode, setMode]         = useState("activas");
  const [p, setP]               = useState({ codigo:"", fecha:today(), estado:"todos", org:"", prov:"", fechaOrg:today(), fechaProv:today() });
  const [f, setF]               = useState({ q:"", tipo:"", estado:"", min:"", max:"" });
  const [data, setData]         = useState(null);
  const [detail, setDetail]     = useState(null);
  const [sel, setSel]           = useState(null);
  const [load, setLoad]         = useState(false);
  const [loadD, setLoadD]       = useState(false);
  const [err, setErr]           = useState("");
  const [pg, setPg]             = useState(1);
  const PER = 20;
  const sseRef = useRef(null);

  // ── Init ────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inv = params.get("invite");
    if (inv) { setInviteToken(inv); setScreen("register"); setAuthCheck(true); return; }
    const token = localStorage.getItem("token");
    if (token) {
      api("/api/auth/me").then(u => {
        if (u.id) { setUser(u); setScreen("app"); connectSSE(); } else { localStorage.removeItem("token"); }
      }).catch(() => localStorage.removeItem("token")).finally(() => setAuthCheck(true));
    } else {
      api("/api/setup/status").then(d => {
        if (d.needsSetup) setScreen("setup");
        setAuthCheck(true);
      }).catch(() => setAuthCheck(true));
    }
  }, []);

  function connectSSE() {
    if (sseRef.current) sseRef.current.close();
    const token = localStorage.getItem("token");
    if (!token) return;
    const es = new EventSource(SERVER + "/api/events?token=" + token);
    // Workaround: EventSource no soporta headers, usamos query param
    sseRef.current = es;
    es.addEventListener("nuevasLicitaciones", e => {
      const d = JSON.parse(e.data);
      setBadge(n => n + d.cantidad);
      toast(`🔔 ${d.alertaNombre}: ${d.cantidad} nueva${d.cantidad > 1 ? "s" : ""}`,"success");
      fetchHistory(); fetchAlerts();
      if (Notification.permission === "granted") {
        new Notification("Nueva licitación", { body: `${d.alertaNombre}: ${d.cantidad} nueva${d.cantidad > 1 ? "s" : ""}\n${d.licitaciones?.[0]?.Nombre||""}` });
      }
    });
    es.addEventListener("pollingOk", e => { const d = JSON.parse(e.data); setLastPoll(d.hora); setPolling(true); });
    es.addEventListener("pollingError", e => toast("Error polling: " + JSON.parse(e.data).mensaje, "error"));
    es.onerror = () => setTimeout(connectSSE, 5000);
  }

  function toast(msg, tipo="info") {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, tipo }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }

  async function fetchAlerts()  { try { setAlerts(await api("/api/alerts")); } catch {} }
  async function fetchHistory() { try { setHistory(await api("/api/history")); } catch {} }
  async function fetchStats()   { try { setStats(await api("/api/stats")); } catch {} }

  useEffect(() => {
    if (screen !== "app") return;
    fetchAlerts(); fetchHistory(); fetchStats();
    if (Notification.permission === "default") Notification.requestPermission();
    api("/api/polling/status").then(d => setPolling(d.activo)).catch(() => {});
  }, [screen]);

  // ── Auth actions ─────────────────────────────────────────────────
  async function doLogin(e) {
    e.preventDefault(); setAuthErr(""); setAuthLoad(true);
    try {
      const d = await api("/api/auth/login", { method:"POST", body: { email: authForm.email, password: authForm.password } });
      if (d.error) { setAuthErr(d.error); return; }
      localStorage.setItem("token", d.token);
      setUser(d.user); setScreen("app"); connectSSE();
    } catch { setAuthErr("Error de conexión"); } finally { setAuthLoad(false); }
  }

  async function doRegister(e) {
    e.preventDefault(); setAuthErr(""); setAuthLoad(true);
    try {
      const d = await api("/api/auth/register", { method:"POST", body: { email: authForm.email, password: authForm.password, name: authForm.name, inviteToken } });
      if (d.error) { setAuthErr(d.error); return; }
      localStorage.setItem("token", d.token);
      setUser(d.user); setScreen("app"); connectSSE();
      window.history.replaceState({}, "", window.location.pathname);
    } catch { setAuthErr("Error de conexión"); } finally { setAuthLoad(false); }
  }

  async function doSetup(e) {
    e.preventDefault(); setAuthErr(""); setAuthLoad(true);
    try {
      const d = await api("/api/setup", { method:"POST", body: { email: authForm.email, password: authForm.password, name: authForm.name } });
      if (d.error) { setAuthErr(d.error); return; }
      localStorage.setItem("token", d.token);
      setUser(d.user); setScreen("app"); connectSSE();
    } catch { setAuthErr("Error de conexión"); } finally { setAuthLoad(false); }
  }

  function logout() {
    localStorage.removeItem("token");
    if (sseRef.current) sseRef.current.close();
    setUser(null); setScreen("login"); setData(null);
  }

  // ── Alertas ──────────────────────────────────────────────────────
  async function togglePolling() {
    if (polling) {
      await api("/api/polling/stop", { method:"POST" });
      setPolling(false); toast("Monitoreo pausado","info");
    } else {
      await api("/api/polling/start", { method:"POST", body: { ticket: TICKET, intervalo: pollingMin } });
      setPolling(true); toast(`Monitoreo iniciado cada ${pollingMin} min`,"success");
    }
  }

  async function saveAlerta() {
    const body = {
      nombre:    form.nombre || "Sin nombre",
      keywords:  form.keywords.split(/[,\n]+/).map(s => s.trim()).filter(Boolean),
      tipos:     form.tipos, estados: form.estados.length ? form.estados : ["5"],
      montoMin:  Number(form.montoMin)||0, montoMax: Number(form.montoMax)||0,
      organismo: form.organismo, emailNotif: form.emailNotif,
    };
    if (editAlert) { await api("/api/alerts/" + editAlert.id, { method:"PUT", body }); toast("Alerta actualizada","success"); }
    else           { await api("/api/alerts", { method:"POST", body }); toast("Alerta creada","success"); }
    fetchAlerts(); setShowForm(false); setEditAlert(null);
    setForm({ nombre:"", keywords:"", tipos:[], estados:["5"], montoMin:"", montoMax:"", organismo:"", emailNotif:true });
  }

  function openEdit(a) {
    setForm({ nombre:a.nombre, keywords:a.keywords.join(", "), tipos:a.tipos, estados:a.estados, montoMin:a.montoMin||"", montoMax:a.montoMax||"", organismo:a.organismo||"", emailNotif:a.emailNotif!==false });
    setEditAlert(a); setShowForm(true);
  }
  function toggleTipo(t){ setForm(f=>({...f,tipos:f.tipos.includes(t)?f.tipos.filter(x=>x!==t):[...f.tipos,t]})); }
  function toggleEst(e){  setForm(f=>({...f,estados:f.estados.includes(e)?f.estados.filter(x=>x!==e):[...f.estados,e]})); }

  // ── Admin ────────────────────────────────────────────────────────
  async function fetchAdminData() {
    const [u, i] = await Promise.all([api("/api/admin/users"), api("/api/admin/invites")]);
    setAdminUsers(u); setAdminInvites(i);
  }

  async function createInvite() {
    const d = await api("/api/admin/invites", { method:"POST", body: { email: inviteEmail || undefined } });
    if (d.error) { toast(d.error,"error"); return; }
    setInviteLink(d.url);
    setInviteEmail("");
    fetchAdminData();
    toast(inviteEmail ? "Invitación enviada por email" : "Invitación creada","success");
  }

  // ── Buscador ─────────────────────────────────────────────────────
  function buildUrl() {
    const t = encodeURIComponent(TICKET);
    if (mode==="activas")      return `${BASE}?estado=activas&ticket=${t}`;
    if (mode==="codigo")       return `${BASE}?codigo=${encodeURIComponent(p.codigo.trim())}&ticket=${t}`;
    if (mode==="fecha_estado") { const fd=p.fecha?`&fecha=${toApi(p.fecha)}`:""; const es=p.estado!=="todos"?`&estado=${p.estado}`:`&estado=todos`; return `${BASE}?ticket=${t}${fd}${es}`; }
    if (mode==="organismo")    return `${BASE}?fecha=${toApi(p.fechaOrg)}&CodigoOrganismo=${encodeURIComponent(p.org)}&ticket=${t}`;
    if (mode==="proveedor")    return `${BASE}?fecha=${toApi(p.fechaProv)}&CodigoProveedor=${encodeURIComponent(p.prov)}&ticket=${t}`;
    return `${BASE}?ticket=${t}`;
  }

  async function search() {
    setLoad(true); setErr(""); setData(null); setSel(null); setDetail(null); setPg(1);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch(e) { setErr(e.message.includes("fetch")||e.message.includes("Network") ? "No se pudo conectar al servidor." : `Error: ${e.message}`); }
    finally { setLoad(false); }
  }

  async function fetchDetail(codigo) {
    setLoadD(true); setDetail(null);
    try {
      const r = await fetch(`${BASE}?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(TICKET)}`);
      const j = await r.json();
      if (j.Listado?.[0]) setDetail(j.Listado[0]);
    } catch {} finally { setLoadD(false); }
  }

  function selectRow(l) {
    if (sel?.CodigoExterno===l.CodigoExterno) { setSel(null); setDetail(null); }
    else { setSel(l); setDetail(null); fetchDetail(l.CodigoExterno); }
  }

  const filtered = useMemo(() => {
    if (!data?.Listado) return [];
    return data.Listado.filter(l => {
      if (f.q) {
        const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
        const text  = [l.Nombre, l.CodigoExterno, l.Organismo?.Nombre, l.Descripcion].filter(Boolean).join(" ").toLowerCase();
        if (!words.some(w => text.includes(w))) return false;
      }
      if (f.tipo && l.Tipo!==f.tipo) return false;
      if (f.estado && String(l.CodigoEstado)!==f.estado) return false;
      if (f.min && (l.MontoEstimado||0)<Number(f.min)) return false;
      if (f.max && Number(f.max)>0 && (l.MontoEstimado||0)>Number(f.max)) return false;
      return true;
    });
  }, [data, f]);

  const totalPg  = Math.ceil(filtered.length / PER);
  const items    = filtered.slice((pg-1)*PER, pg*PER);
  const stCounts = useMemo(() => {
    if (!data?.Listado) return {};
    return data.Listado.reduce((a,l) => { const k=String(l.CodigoEstado); a[k]=(a[k]||0)+1; return a; }, {});
  }, [data]);
  const hasFil = f.q||f.tipo||f.estado||f.min||f.max;
  const D = detail || sel;

  function exportCSV() {
    const hdrs = ["Código","Nombre","Estado","Tipo","Monto","Moneda","Organismo","Publicación","Cierre"];
    const rows = filtered.map(l => [l.CodigoExterno,`"${(l.Nombre||"").replace(/"/g,'""')}"`,ESTADOS[String(l.CodigoEstado)]?.label||l.CodigoEstado,l.Tipo,l.MontoEstimado||0,l.UnidadMonedaEstimadaDescripcion||"CLP",`"${(l.Organismo?.Nombre||"").replace(/"/g,'""')}"`,fmtD(l.FechaPublicacion),fmtD(l.FechaCierre)]);
    const csv = [hdrs,...rows].map(r=>r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
    a.download = `licitaciones_${today()}.csv`; a.click();
  }

  // ════════════════════════════════════════════════════════════════
  if (!authCheck) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#f9fafb" }}>
      <p style={{ color:"#9ca3af", fontSize:13 }}>Cargando...</p>
    </div>
  );

  // ── Pantalla auth ────────────────────────────────────────────────
  if (screen !== "app") {
    const isSetup    = screen === "setup";
    const isRegister = screen === "register";
    const title  = isSetup ? "Crear cuenta de administrador" : isRegister ? "Crear tu cuenta" : "Iniciar sesión";
    const submit = isSetup ? doSetup : isRegister ? doRegister : doLogin;
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#f9fafb", padding:16 }}>
        <div style={{ background:"white", border:"1px solid #e5e7eb", borderRadius:12, padding:"28px 24px", width:"100%", maxWidth:380, boxShadow:"0 4px 24px rgba(0,0,0,0.06)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
            <div style={{ display:"flex", gap:2 }}>
              <div style={{ width:4, height:22, background:"#003087", borderRadius:2 }}/>
              <div style={{ width:4, height:22, background:"#fff", borderRadius:2, border:"1px solid #ddd" }}/>
              <div style={{ width:4, height:22, background:"#D52B1E", borderRadius:2 }}/>
            </div>
            <span style={{ fontSize:14, fontWeight:700 }}>Explorador de Licitaciones</span>
          </div>
          <h2 style={{ margin:"0 0 20px", fontSize:15, fontWeight:600 }}>{title}</h2>
          {isSetup && <div style={{ padding:"10px 12px", background:"#dbeafe", borderRadius:8, marginBottom:16, fontSize:11, color:"#1d4ed8" }}>Primera vez — estás creando la cuenta de administrador.</div>}
          {isRegister && <div style={{ padding:"10px 12px", background:"#dcfce7", borderRadius:8, marginBottom:16, fontSize:11, color:"#15803d" }}>Tienes una invitación válida. Completa tus datos.</div>}
          <form onSubmit={submit}>
            {(isSetup||isRegister) && (
              <div style={{ marginBottom:12 }}>
                <label style={S.lbl}>NOMBRE</label>
                <input value={authForm.name} onChange={e=>setAuthForm(f=>({...f,name:e.target.value}))} placeholder="Tu nombre" style={S.inp} required/>
              </div>
            )}
            <div style={{ marginBottom:12 }}>
              <label style={S.lbl}>EMAIL</label>
              <input type="email" value={authForm.email} onChange={e=>setAuthForm(f=>({...f,email:e.target.value}))} placeholder="correo@ejemplo.cl" style={S.inp} required/>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={S.lbl}>CONTRASEÑA</label>
              <input type="password" value={authForm.password} onChange={e=>setAuthForm(f=>({...f,password:e.target.value}))} placeholder="••••••••" style={S.inp} required/>
            </div>
            {authErr && <div style={{ padding:"8px 12px", background:"#fee2e2", borderRadius:6, marginBottom:12, fontSize:11, color:"#b91c1c" }}>{authErr}</div>}
            <button type="submit" disabled={authLoad} style={{ ...S.red, width:"100%", height:38, fontSize:13 }}>
              {authLoad ? "Procesando..." : isSetup ? "Crear cuenta admin" : isRegister ? "Crear cuenta" : "Ingresar"}
            </button>
          </form>
          {!isSetup && !isRegister && (
            <p style={{ margin:"12px 0 0", fontSize:11, color:"#9ca3af", textAlign:"center" }}>
              ¿No tienes cuenta? Solicita una invitación al administrador.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── App principal ────────────────────────────────────────────────
  const TABS = [
    { id:"dashboard", label:"📊 Dashboard" },
    { id:"buscar",    label:"🔍 Buscar" },
    { id:"alertas",   label:"🔔 Alertas" },
    { id:"historial", label:"📋 Historial" },
    ...(user?.role==="admin" ? [{ id:"admin", label:"⚙️ Admin" }] : []),
  ];

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", color:"#111", background:"#f9fafb", minHeight:"100vh", padding:"12px 16px 40px" }}>

      {/* Toasts */}
      <div style={{ position:"fixed", top:16, right:16, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding:"10px 16px", borderRadius:8, fontSize:12, fontWeight:500, maxWidth:320, boxShadow:"0 4px 12px rgba(0,0,0,0.15)", background:t.tipo==="success"?"#dcfce7":t.tipo==="error"?"#fee2e2":"#dbeafe", color:t.tipo==="success"?"#15803d":t.tipo==="error"?"#b91c1c":"#1d4ed8" }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ display:"flex", gap:2 }}>
            <div style={{ width:4, height:22, background:"#003087", borderRadius:2 }}/>
            <div style={{ width:4, height:22, background:"#fff", borderRadius:2, border:"1px solid #ddd" }}/>
            <div style={{ width:4, height:22, background:"#D52B1E", borderRadius:2 }}/>
          </div>
          <span style={{ fontSize:15, fontWeight:700 }}>Explorador de Licitaciones</span>
          {polling && <span style={{ fontSize:9, padding:"2px 8px", background:"#dcfce7", color:"#15803d", borderRadius:99, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}><span style={{ width:5, height:5, borderRadius:"50%", background:"#15803d", display:"inline-block" }}/>Monitoreando</span>}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={()=>setShowRef(true)} style={{ ...S.ghost, fontSize:11, padding:"4px 10px" }}>📖 Códigos</button>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color:"#6b7280" }}>{user?.name}</span>
            <button onClick={logout} style={{ ...S.ghost, fontSize:11, padding:"4px 10px" }}>Salir</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, marginBottom:12, background:"white", border:"1px solid #e5e7eb", borderRadius:10, padding:4 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if(t.id==="historial"){fetchHistory();setBadge(0);} if(t.id==="alertas")fetchAlerts(); if(t.id==="dashboard")fetchStats(); if(t.id==="admin")fetchAdminData(); }}
            style={{ flex:1, padding:"7px 8px", fontSize:11, border:"none", borderRadius:7, cursor:"pointer", position:"relative", background:tab===t.id?"#111":"transparent", color:tab===t.id?"white":"#6b7280", fontWeight:tab===t.id?600:400 }}>
            {t.label}
            {t.id==="historial"&&badge>0&&<span style={{ position:"absolute", top:3, right:6, background:"#D52B1E", color:"white", fontSize:8, fontWeight:700, padding:"1px 4px", borderRadius:99 }}>{badge>99?"99+":badge}</span>}
          </button>
        ))}
      </div>

      {/* ══ DASHBOARD ══════════════════════════════════════════════ */}
      {tab==="dashboard"&&(
        <div>
          {!stats ? (
            <p style={{ fontSize:12, color:"#9ca3af", textAlign:"center", padding:"2rem" }}>Cargando estadísticas...</p>
          ) : (
            <div>
              {/* Métricas */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:8, marginBottom:12 }}>
                {[
                  { l:"Detecciones", v:stats.totalDetecciones, color:"#1d4ed8" },
                  { l:"Alertas activas", v:stats.alertasActivas+"/"+stats.totalAlertas, color:"#15803d" },
                  { l:"Monto total detectado", v:stats.totalMonto>0?"CLP "+Number(stats.totalMonto).toLocaleString("es-CL"):"—", color:"#a16207", small:true },
                ].map(({l,v,color,small},i) => (
                  <div key={i} style={{ background:"white", border:"1px solid #e5e7eb", borderRadius:8, padding:"10px 12px" }}>
                    <p style={{ margin:"0 0 4px", fontSize:9, color:"#9ca3af" }}>{l}</p>
                    <p style={{ margin:0, fontSize:small?14:22, fontWeight:700, color }}>{v}</p>
                  </div>
                ))}
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                <div style={S.card}>
                  <p style={{ margin:"0 0 10px", fontSize:11, fontWeight:600 }}>Detecciones por alerta</p>
                  <BarChart data={stats.byAlert} color="#D52B1E"/>
                </div>
                <div style={S.card}>
                  <p style={{ margin:"0 0 10px", fontSize:11, fontWeight:600 }}>Detecciones por tipo de licitación</p>
                  <BarChart data={stats.byTipo} color="#1d4ed8"/>
                </div>
              </div>

              <div style={S.card}>
                <p style={{ margin:"0 0 8px", fontSize:11, fontWeight:600 }}>Detecciones últimos 30 días</p>
                <LineChart data={stats.byDay}/>
              </div>

              {stats.recientes?.length > 0 && (
                <div style={S.card}>
                  <p style={{ margin:"0 0 10px", fontSize:11, fontWeight:600 }}>Últimas detecciones</p>
                  {stats.recientes.map((h,i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:i<stats.recientes.length-1?"1px solid #f3f4f6":"none" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ margin:0, fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.nombre}</p>
                        <p style={{ margin:0, fontSize:10, color:"#9ca3af" }}>{h.alertaNombre} · {fmtHora(h.fechaDetec)}</p>
                      </div>
                      <Badge c={h.estado}/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ BUSCAR ══════════════════════════════════════════════════ */}
      {tab==="buscar"&&(
        <div>
          <div style={S.card}>
            <label style={S.lbl}>TIPO DE BÚSQUEDA</label>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
              {MODES.map(m => (
                <button key={m.id} onClick={()=>{setMode(m.id);setData(null);setSel(null);setDetail(null);}}
                  style={{ padding:"4px 12px", fontSize:11, borderRadius:99, cursor:"pointer", border:mode===m.id?"2px solid #111":"1px solid #e5e7eb", background:mode===m.id?"#111":"white", color:mode===m.id?"white":"#374151", fontWeight:mode===m.id?600:400 }}>
                  {m.label}
                </button>
              ))}
            </div>
            {mode!=="activas"&&(
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, marginBottom:10 }}>
                {mode==="codigo"&&<div><label style={S.lbl}>CÓDIGO</label><input value={p.codigo} onChange={e=>setP(x=>({...x,codigo:e.target.value}))} placeholder="1509-5-L114" style={{...S.inp,fontFamily:"monospace",fontSize:11}}/></div>}
                {mode==="fecha_estado"&&<><div><label style={S.lbl}>FECHA</label><input type="date" value={p.fecha} onChange={e=>setP(x=>({...x,fecha:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>ESTADO</label><select value={p.estado} onChange={e=>setP(x=>({...x,estado:e.target.value}))} style={S.inp}><option value="todos">Todos</option><option value="activas">Activas</option>{Object.entries(ESTADOS).map(([k,v])=><option key={k} value={v.label.toLowerCase()}>{v.label}</option>)}</select></div></>}
                {mode==="organismo"&&<><div><label style={S.lbl}>CÓDIGO ORGANISMO</label><input value={p.org} onChange={e=>setP(x=>({...x,org:e.target.value}))} placeholder="694" style={{...S.inp,fontFamily:"monospace"}}/></div><div><label style={S.lbl}>FECHA</label><input type="date" value={p.fechaOrg} onChange={e=>setP(x=>({...x,fechaOrg:e.target.value}))} style={S.inp}/></div></>}
                {mode==="proveedor"&&<><div><label style={S.lbl}>CÓDIGO PROVEEDOR</label><input value={p.prov} onChange={e=>setP(x=>({...x,prov:e.target.value}))} placeholder="17793" style={{...S.inp,fontFamily:"monospace"}}/></div><div><label style={S.lbl}>FECHA</label><input type="date" value={p.fechaProv} onChange={e=>setP(x=>({...x,fechaProv:e.target.value}))} style={S.inp}/></div></>}
              </div>
            )}
            <button onClick={search} disabled={load} style={{...S.red,width:"100%",height:36,fontSize:13}}>{load?"Consultando...":"🔍  Buscar licitaciones"}</button>
          </div>

          {err&&<div style={{padding:"10px 14px",background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,marginBottom:8,fontSize:12,color:"#b91c1c"}}>{err}</div>}

          {data&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:6,marginBottom:8}}>
                {[{l:"Total API",v:(data.Cantidad||0).toLocaleString("es-CL")},{l:"Filtradas",v:filtered.length.toLocaleString("es-CL")},...Object.entries(stCounts).sort(([,a],[,b])=>b-a).slice(0,4).map(([k,v])=>({l:ESTADOS[k]?.label||`Est.${k}`,v:v.toLocaleString("es-CL"),dot:ESTADOS[k]?.color}))].map(({l,v,dot},i)=>(
                  <div key={i} style={{background:"white",border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>{dot&&<span style={{width:6,height:6,borderRadius:99,background:dot,display:"inline-block"}}/>}<p style={{margin:0,fontSize:9,color:"#6b7280"}}>{l}</p></div>
                    <p style={{margin:0,fontSize:18,fontWeight:600}}>{v}</p>
                  </div>
                ))}
              </div>
              <div style={S.card}>
                <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto auto auto auto",gap:6,alignItems:"end"}}>
                  <div><label style={S.lbl}>PALABRAS CLAVE</label><input value={f.q} onChange={e=>{setF(x=>({...x,q:e.target.value}));setPg(1);}} placeholder="computador, aseo..." style={S.inp}/></div>
                  <div style={{minWidth:90}}><label style={S.lbl}>TIPO</label><select value={f.tipo} onChange={e=>{setF(x=>({...x,tipo:e.target.value}));setPg(1);}} style={{...S.inp,minWidth:90}}><option value="">Todos</option>{Object.entries(TIPOS).map(([k,v])=><option key={k} value={k}>{k} — {v}</option>)}</select></div>
                  <div style={{minWidth:110}}><label style={S.lbl}>ESTADO</label><select value={f.estado} onChange={e=>{setF(x=>({...x,estado:e.target.value}));setPg(1);}} style={{...S.inp,minWidth:110}}><option value="">Todos</option>{Object.entries(ESTADOS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
                  <div style={{minWidth:90}}><label style={S.lbl}>MONTO MÍN</label><input type="number" value={f.min} onChange={e=>{setF(x=>({...x,min:e.target.value}));setPg(1);}} placeholder="0" style={{...S.inp,minWidth:90}}/></div>
                  <div style={{minWidth:90}}><label style={S.lbl}>MONTO MÁX</label><input type="number" value={f.max} onChange={e=>{setF(x=>({...x,max:e.target.value}));setPg(1);}} placeholder="∞" style={{...S.inp,minWidth:90}}/></div>
                  {hasFil&&<button onClick={()=>{setF({q:"",tipo:"",estado:"",min:"",max:""});setPg(1);}} style={{...S.ghost,height:32,padding:"0 10px",fontSize:11}}>Limpiar</button>}
                  <button onClick={exportCSV} style={{...S.ghost,height:32,padding:"0 10px",fontSize:11,whiteSpace:"nowrap"}}>↓ CSV</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:sel?"1fr 340px":"1fr",gap:8,alignItems:"start"}}>
                <div style={{border:"1px solid #e5e7eb",borderRadius:10,overflow:"hidden",background:"white"}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed",minWidth:sel?380:580}}>
                      <colgroup><col style={{width:sel?"22%":"13%"}}/><col style={{width:sel?"42%":"36%"}}/><col style={{width:"14%"}}/>{!sel&&<col style={{width:"7%"}}/>}<col style={{width:sel?"22%":"18%"}}/>{!sel&&<col style={{width:"12%"}}/>}</colgroup>
                      <thead><tr style={{background:"#f9fafb"}}>{["Código","Nombre","Estado",...(!sel?["Tipo"]:[]),"Monto",...(!sel?["Organismo"]:[])].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",fontWeight:600,fontSize:10,color:"#6b7280",borderBottom:"1px solid #e5e7eb"}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {items.length===0&&<tr><td colSpan={7} style={{padding:"2rem",textAlign:"center",color:"#9ca3af",fontSize:12}}>{data.Cantidad===0?"Sin resultados de la API.":"Sin resultados con los filtros."}</td></tr>}
                        {items.map((l,i)=>{
                          const isS=sel?.CodigoExterno===l.CodigoExterno;
                          return(<tr key={l.CodigoExterno||i} onClick={()=>selectRow(l)} style={{borderBottom:"1px solid #f3f4f6",cursor:"pointer",background:isS?"#eff6ff":"white"}} onMouseEnter={e=>{if(!isS)e.currentTarget.style.background="#f9fafb";}} onMouseLeave={e=>{if(!isS)e.currentTarget.style.background="white";}}>
                            <td style={{padding:"9px 10px",fontFamily:"monospace",fontSize:10,color:"#9ca3af"}}>{l.CodigoExterno}</td>
                            <td style={{padding:"9px 10px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.Nombre}>{l.Nombre}</td>
                            <td style={{padding:"9px 10px"}}><Badge c={l.CodigoEstado}/></td>
                            {!sel&&<td style={{padding:"9px 10px",fontFamily:"monospace",fontSize:10,color:"#6b7280",cursor:"help"}} title={TIPOS[l.Tipo]||l.Tipo}>{l.Tipo}</td>}
                            <td style={{padding:"9px 10px",textAlign:"right",whiteSpace:"nowrap",fontSize:11}}>{l.MontoEstimado>0?fmtM(l.MontoEstimado,l.UnidadMonedaEstimadaDescripcion):<span style={{color:"#d1d5db"}}>—</span>}</td>
                            {!sel&&<td style={{padding:"9px 10px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11,color:"#6b7280"}}>{l.Organismo?.Nombre}</td>}
                          </tr>);
                        })}
                      </tbody>
                    </table>
                  </div>
                  {totalPg>1&&<div style={{display:"flex",gap:6,justifyContent:"center",padding:10,borderTop:"1px solid #f3f4f6",alignItems:"center"}}><button onClick={()=>setPg(1)} disabled={pg===1} style={{padding:"3px 8px",fontSize:11}}>«</button><button onClick={()=>setPg(x=>Math.max(1,x-1))} disabled={pg===1} style={{padding:"3px 8px",fontSize:11}}>‹</button><span style={{fontSize:11,color:"#6b7280",minWidth:130,textAlign:"center"}}>{pg}/{totalPg} · {filtered.length.toLocaleString("es-CL")}</span><button onClick={()=>setPg(x=>Math.min(totalPg,x+1))} disabled={pg===totalPg} style={{padding:"3px 8px",fontSize:11}}>›</button><button onClick={()=>setPg(totalPg)} disabled={pg===totalPg} style={{padding:"3px 8px",fontSize:11}}>»</button></div>}
                </div>
                {sel&&(
                  <div style={{background:"white",border:"1px solid #e5e7eb",borderRadius:10,padding:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><Badge c={sel.CodigoEstado}/><button onClick={()=>{setSel(null);setDetail(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:16}}>✕</button></div>
                    <p style={{margin:"0 0 3px",fontSize:9,fontFamily:"monospace",color:"#9ca3af"}}>{sel.CodigoExterno}</p>
                    <p style={{margin:"0 0 12px",fontSize:13,fontWeight:600,lineHeight:1.4}}>{sel.Nombre}</p>
                    {loadD&&<p style={{fontSize:11,color:"#9ca3af",margin:"0 0 8px"}}>Cargando detalle...</p>}
                    <div style={{fontSize:12,marginBottom:10}}>
                      {[[D?.Tipo?`${D.Tipo} — ${TIPOS[D.Tipo]||D.Tipo}`:null,"Tipo"],[D?.Organismo?.Nombre,"Organismo"],[fmtM(D?.MontoEstimado,D?.UnidadMonedaEstimadaDescripcion),"Monto"],[fmtD(D?.FechaPublicacion)!=="—"?fmtD(D?.FechaPublicacion):null,"Publicación"],[fmtD(D?.FechaCierre)!=="—"?fmtD(D?.FechaCierre):null,"Cierre"],[fmtD(D?.FechaAdjudicacion)!=="—"?fmtD(D?.FechaAdjudicacion):null,"Adjudicación"],[D?.Regiones?.[0]?.NombreRegion||D?.RegionUnidad,"Región"]].filter(([v])=>v).map(([v,l])=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"5px 0",borderBottom:"1px solid #f3f4f6"}}><span style={{fontSize:11,color:"#6b7280",flexShrink:0}}>{l}</span><span style={{fontSize:11,textAlign:"right"}}>{v}</span></div>
                      ))}
                    </div>
                    {D?.Descripcion&&<div style={{marginBottom:10}}><p style={{fontSize:9,fontWeight:600,color:"#9ca3af",letterSpacing:"0.06em",margin:"0 0 4px"}}>DESCRIPCIÓN</p><p style={{fontSize:11,lineHeight:1.6,margin:0,color:"#6b7280",maxHeight:90,overflowY:"auto"}}>{D.Descripcion}</p></div>}
                    {D?.Items?.Listado?.length>0&&<div style={{marginBottom:10}}><p style={{fontSize:9,fontWeight:600,color:"#9ca3af",letterSpacing:"0.06em",margin:"0 0 4px"}}>ÍTEMS ({D.Items.Listado.length})</p><div style={{maxHeight:130,overflowY:"auto",border:"1px solid #f3f4f6",borderRadius:6}}>{D.Items.Listado.slice(0,8).map((it,i)=><div key={i} style={{padding:"6px 8px",borderBottom:"1px solid #f9fafb"}}><p style={{margin:0,fontWeight:600,fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.NombreProducto||it.Nombre}</p><p style={{margin:0,fontSize:10,color:"#6b7280"}}>Cant: {it.Cantidad} {it.UnidadMedida}</p></div>)}</div></div>}
                    <a href={`https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs=WgLuBLRjJcBU5dIg43fZAQ==&idlicitacion=${sel.CodigoExterno}`} target="_blank" style={{display:"block",textAlign:"center",padding:9,background:"#D52B1E",color:"white",borderRadius:6,fontSize:12,fontWeight:600,textDecoration:"none"}}>Ver en Mercado Público ↗</a>
                  </div>
                )}
              </div>
            </div>
          )}
          {!data&&!load&&!err&&<div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9ca3af"}}><p style={{fontSize:13,margin:0}}>Selecciona el tipo de búsqueda y presiona Buscar</p></div>}
        </div>
      )}

      {/* ══ ALERTAS ═════════════════════════════════════════════════ */}
      {tab==="alertas"&&(
        <div>
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <p style={{margin:0,fontSize:13,fontWeight:600}}>Motor de monitoreo</p>
                <p style={{margin:"3px 0 0",fontSize:11,color:"#6b7280"}}>{polling?`Revisando cada ${pollingMin} min · última: ${lastPoll?fmtHora(lastPoll):"pendiente..."}`:"Detenido"}</p>
              </div>
              <button onClick={togglePolling} style={polling?{...S.ghost,padding:"8px 16px",fontSize:12,fontWeight:600}:{...S.red,padding:"8px 16px",fontSize:12}}>{polling?"⏹ Detener":"▶ Iniciar"}</button>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <label style={{...S.lbl,margin:0,whiteSpace:"nowrap"}}>CADA (min):</label>
              <input type="number" min="1" max="60" value={pollingMin} onChange={e=>setPollingMin(Number(e.target.value))} style={{...S.inp,width:70,height:28}} disabled={polling}/>
              <span style={{fontSize:10,color:"#9ca3af"}}>Límite API: 10.000 req/día</span>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:600}}>{alerts.length} alerta{alerts.length!==1?"s":""}</span>
            <button onClick={()=>{setEditAlert(null);setForm({nombre:"",keywords:"",tipos:[],estados:["5"],montoMin:"",montoMax:"",organismo:"",emailNotif:true});setShowForm(true);}} style={{...S.red,padding:"7px 14px",fontSize:12}}>+ Nueva alerta</button>
          </div>

          {alerts.length===0&&<div style={{textAlign:"center",padding:"2rem",color:"#9ca3af",background:"white",border:"1px solid #e5e7eb",borderRadius:10}}><p style={{margin:0,fontSize:28}}>🔔</p><p style={{margin:"8px 0 0",fontSize:13}}>Sin alertas — crea una para empezar</p></div>}

          {alerts.map(a=>(
            <div key={a.id} style={{...S.card,borderLeft:`3px solid ${a.activa?"#15803d":"#e5e7eb"}`,opacity:a.activa?1:0.65}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:700}}>{a.nombre}</span>
                    <span style={{fontSize:9,padding:"2px 7px",background:a.activa?"#dcfce7":"#f3f4f6",color:a.activa?"#15803d":"#6b7280",borderRadius:99,fontWeight:600}}>{a.activa?"Activa":"Pausada"}</span>
                    {a.emailNotif&&<span style={{fontSize:9,padding:"2px 7px",background:"#fef9c3",color:"#a16207",borderRadius:99,fontWeight:600}}>📧 Email</span>}
                    {a.matchCount>0&&<span style={{fontSize:9,padding:"2px 7px",background:"#dbeafe",color:"#1d4ed8",borderRadius:99,fontWeight:600}}>{a.matchCount} match{a.matchCount!==1?"es":""}</span>}
                  </div>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap",fontSize:11,color:"#6b7280"}}>
                    {a.keywords.length>0&&<span>🔤 {a.keywords.join(", ")}</span>}
                    {a.tipos.length>0&&<span>📂 {a.tipos.join(", ")}</span>}
                    {a.estados.length>0&&<span>🏷 {a.estados.map(e=>ESTADOS[e]?.label||e).join(", ")}</span>}
                    {a.montoMin>0&&<span>💰 Min: {Number(a.montoMin).toLocaleString("es-CL")}</span>}
                    {a.organismo&&<span>🏛 {a.organismo}</span>}
                  </div>
                  {a.ultimaVez&&<p style={{margin:"4px 0 0",fontSize:10,color:"#9ca3af"}}>Último match: {fmtHora(a.ultimaVez)}</p>}
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button onClick={()=>api("/api/alerts/"+a.id,{method:"PUT",body:{activa:!a.activa}}).then(fetchAlerts)} style={{...S.ghost,padding:"5px 10px",fontSize:11}}>{a.activa?"Pausar":"Activar"}</button>
                  <button onClick={()=>openEdit(a)} style={{...S.ghost,padding:"5px 10px",fontSize:11}}>Editar</button>
                  <button onClick={()=>api("/api/alerts/"+a.id,{method:"DELETE"}).then(()=>{fetchAlerts();toast("Alerta eliminada","info");})} style={{background:"none",border:"1px solid #fca5a5",color:"#b91c1c",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>Eliminar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ HISTORIAL ═══════════════════════════════════════════════ */}
      {tab==="historial"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:600}}>{history.length} licitación{history.length!==1?"es":""} detectada{history.length!==1?"s":""}</span>
            <div style={{display:"flex",gap:6}}>
              {history.filter(h=>h.fechaCierre).length>0&&(
                <button onClick={()=>exportICS(history)} style={{...S.ghost,padding:"5px 12px",fontSize:11}}>📅 Exportar a calendario</button>
              )}
              {history.length>0&&<button onClick={()=>api("/api/history",{method:"DELETE"}).then(fetchHistory)} style={{...S.ghost,padding:"5px 12px",fontSize:11}}>Limpiar</button>}
            </div>
          </div>
          {history.length===0&&<div style={{textAlign:"center",padding:"2rem",color:"#9ca3af",background:"white",border:"1px solid #e5e7eb",borderRadius:10}}><p style={{margin:0,fontSize:28}}>📋</p><p style={{margin:"8px 0 0",fontSize:13}}>Sin detecciones aún</p></div>}
          {history.map((h,i)=>(
            <div key={i} style={{...S.card,marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                    <Badge c={h.estado}/>
                    <span style={{fontSize:9,fontFamily:"monospace",color:"#9ca3af"}}>{h.codigo}</span>
                    <span style={{fontSize:9,padding:"2px 7px",background:"#dbeafe",color:"#1d4ed8",borderRadius:99,fontWeight:600}}>{h.alertaNombre}</span>
                  </div>
                  <p style={{margin:"0 0 4px",fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.nombre}</p>
                  <div style={{display:"flex",gap:12,fontSize:10,color:"#6b7280",flexWrap:"wrap"}}>
                    {h.organismo&&<span>🏛 {h.organismo}</span>}
                    {h.monto>0&&<span>💰 {fmtM(h.monto,h.moneda)}</span>}
                    {h.fechaCierre&&<span>📅 Cierre: {fmtD(h.fechaCierre)}</span>}
                    <span>🕐 {fmtHora(h.fechaDetec)}</span>
                  </div>
                </div>
                <a href={`https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs=WgLuBLRjJcBU5dIg43fZAQ==&idlicitacion=${h.codigo}`} target="_blank" style={{fontSize:11,color:"#D52B1E",textDecoration:"none",whiteSpace:"nowrap",padding:"5px 10px",border:"1px solid #fca5a5",borderRadius:6,flexShrink:0}}>Ver ↗</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ ADMIN ═══════════════════════════════════════════════════ */}
      {tab==="admin"&&(
        <div>
          <div style={{display:"flex",gap:5,marginBottom:10}}>
            {["usuarios","invitaciones"].map(t=>(
              <button key={t} onClick={()=>setAdminTab(t)} style={{padding:"5px 14px",fontSize:11,borderRadius:99,cursor:"pointer",border:adminTab===t?"2px solid #111":"1px solid #e5e7eb",background:adminTab===t?"#111":"white",color:adminTab===t?"white":"#374151",fontWeight:adminTab===t?600:400,textTransform:"capitalize"}}>
                {t==="usuarios"?"👥 Usuarios":"✉️ Invitaciones"}
              </button>
            ))}
          </div>

          {adminTab==="invitaciones"&&(
            <div>
              <div style={S.card}>
                <p style={{margin:"0 0 10px",fontSize:12,fontWeight:600}}>Crear invitación</p>
                <div style={{display:"flex",gap:8}}>
                  <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="Email (opcional — si se omite, genera solo el link)" style={{...S.inp,flex:1}}/>
                  <button onClick={createInvite} style={{...S.red,padding:"0 16px",fontSize:12,whiteSpace:"nowrap"}}>Crear invitación</button>
                </div>
                {inviteLink&&(
                  <div style={{marginTop:10,padding:"10px 12px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8}}>
                    <p style={{margin:"0 0 5px",fontSize:10,fontWeight:600,color:"#15803d"}}>LINK DE INVITACIÓN (copia y envía):</p>
                    <div style={{display:"flex",gap:8}}>
                      <input readOnly value={inviteLink} style={{...S.inp,fontFamily:"monospace",fontSize:10,flex:1,background:"white"}}/>
                      <button onClick={()=>{navigator.clipboard.writeText(inviteLink);toast("Link copiado","success");}} style={{...S.ghost,padding:"0 12px",fontSize:11,whiteSpace:"nowrap"}}>Copiar</button>
                    </div>
                  </div>
                )}
              </div>

              {adminInvites.map((inv,i)=>(
                <div key={i} style={{...S.card,marginBottom:6,opacity:inv.usedAt?0.6:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                        <span style={{fontSize:9,fontFamily:"monospace",color:"#9ca3af"}}>{inv.token.slice(0,16)}...</span>
                        <span style={{fontSize:9,padding:"2px 7px",background:inv.usedAt?"#f3f4f6":"#dcfce7",color:inv.usedAt?"#6b7280":"#15803d",borderRadius:99,fontWeight:600}}>{inv.usedAt?"Utilizada":"Disponible"}</span>
                      </div>
                      <p style={{margin:0,fontSize:11,color:"#6b7280"}}>{inv.email||"Sin email asignado"} · {fmtHora(inv.createdAt)}</p>
                    </div>
                    {!inv.usedAt&&<button onClick={()=>api("/api/admin/invites/"+inv.token,{method:"DELETE"}).then(fetchAdminData)} style={{...S.ghost,padding:"4px 10px",fontSize:11,color:"#b91c1c",borderColor:"#fca5a5"}}>Revocar</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {adminTab==="usuarios"&&(
            <div>
              {adminUsers.map((u,i)=>(
                <div key={i} style={{...S.card,marginBottom:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                        <span style={{fontSize:13,fontWeight:600}}>{u.name}</span>
                        <span style={{fontSize:9,padding:"2px 7px",background:u.role==="admin"?"#fef9c3":"#dbeafe",color:u.role==="admin"?"#a16207":"#1d4ed8",borderRadius:99,fontWeight:600}}>{u.role}</span>
                      </div>
                      <p style={{margin:0,fontSize:11,color:"#6b7280"}}>{u.email} · Creado: {fmtD(u.createdAt)}</p>
                    </div>
                    {u.id!==user.id&&(
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={()=>api("/api/admin/users/"+u.id,{method:"PUT",body:{role:u.role==="admin"?"user":"admin"}}).then(fetchAdminData)} style={{...S.ghost,padding:"4px 10px",fontSize:11}}>{u.role==="admin"?"→ User":"→ Admin"}</button>
                        <button onClick={()=>{if(confirm("¿Eliminar usuario "+u.name+"?"))api("/api/admin/users/"+u.id,{method:"DELETE"}).then(fetchAdminData);}} style={{background:"none",border:"1px solid #fca5a5",color:"#b91c1c",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>Eliminar</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ MODAL: FORM ALERTA ═══════════════════════════════════════ */}
      {showForm&&(
        <div onClick={()=>setShowForm(false)} style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:12,padding:24,maxWidth:580,width:"90%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <span style={{fontSize:15,fontWeight:700}}>{editAlert?"Editar alerta":"Nueva alerta"}</span>
              <button onClick={()=>setShowForm(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#9ca3af"}}>✕</button>
            </div>
            <div style={{marginBottom:14}}><label style={S.lbl}>NOMBRE</label><input value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))} placeholder="Ej: Equipos TI, Aseo..." style={S.inp}/></div>
            <div style={{marginBottom:14}}><label style={S.lbl}>PALABRAS CLAVE (coma — basta UNA)</label><textarea value={form.keywords} onChange={e=>setForm(f=>({...f,keywords:e.target.value}))} placeholder="computador, laptop, impresora" style={{...S.inp,height:60,resize:"vertical",paddingTop:8}}/></div>
            <div style={{marginBottom:14}}>
              <label style={S.lbl}>TIPOS (vacío = todos)</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {Object.entries(TIPOS).map(([k,v])=><button key={k} onClick={()=>toggleTipo(k)} title={v} style={{padding:"3px 10px",fontSize:10,borderRadius:99,cursor:"pointer",border:form.tipos.includes(k)?"2px solid #1d4ed8":"1px solid #e5e7eb",background:form.tipos.includes(k)?"#dbeafe":"white",color:form.tipos.includes(k)?"#1d4ed8":"#374151"}}>{k}</button>)}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={S.lbl}>ESTADOS A MONITOREAR</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {Object.entries(ESTADOS).map(([k,v])=><button key={k} onClick={()=>toggleEst(k)} style={{padding:"3px 10px",fontSize:10,borderRadius:99,cursor:"pointer",border:form.estados.includes(k)?`2px solid ${v.color}`:"1px solid #e5e7eb",background:form.estados.includes(k)?v.bg:"white",color:form.estados.includes(k)?v.color:"#374151"}}>{v.label}</button>)}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
              <div><label style={S.lbl}>MONTO MÍN</label><input type="number" value={form.montoMin} onChange={e=>setForm(f=>({...f,montoMin:e.target.value}))} placeholder="0" style={S.inp}/></div>
              <div><label style={S.lbl}>MONTO MÁX</label><input type="number" value={form.montoMax} onChange={e=>setForm(f=>({...f,montoMax:e.target.value}))} placeholder="Sin límite" style={S.inp}/></div>
              <div><label style={S.lbl}>ORGANISMO</label><input value={form.organismo} onChange={e=>setForm(f=>({...f,organismo:e.target.value}))} placeholder="Municipalidad..." style={S.inp}/></div>
            </div>
            <div style={{marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
              <input type="checkbox" id="emailNotif" checked={form.emailNotif} onChange={e=>setForm(f=>({...f,emailNotif:e.target.checked}))} style={{width:16,height:16}}/>
              <label htmlFor="emailNotif" style={{fontSize:12,cursor:"pointer"}}>📧 Recibir notificación por email cuando haya matches</label>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowForm(false)} style={{...S.ghost,flex:1,padding:10,fontSize:13}}>Cancelar</button>
              <button onClick={saveAlerta} style={{...S.red,flex:2,padding:10,fontSize:13}}>{editAlert?"Guardar cambios":"Crear alerta"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: CÓDIGOS ══════════════════════════════════════════ */}
      {showRef&&(
        <div onClick={()=>setShowRef(false)} style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:12,padding:24,maxWidth:600,width:"90%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontSize:15,fontWeight:700}}>📖 Referencia de códigos</span>
              <button onClick={()=>setShowRef(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#9ca3af"}}>✕</button>
            </div>
            <p style={{fontSize:10,fontWeight:700,color:"#9ca3af",letterSpacing:"0.08em",margin:"0 0 8px"}}>TIPOS DE LICITACIÓN</p>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:20}}>
              <thead><tr style={{background:"#f9fafb"}}><th style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:"#6b7280",borderBottom:"1px solid #e5e7eb",width:"16%"}}>Código</th><th style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:"#6b7280",borderBottom:"1px solid #e5e7eb"}}>Descripción</th></tr></thead>
              <tbody>{Object.entries(TIPOS).map(([k,v],i)=><tr key={k} style={{borderBottom:"1px solid #f3f4f6",background:i%2===0?"white":"#fafafa"}}><td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#1d4ed8"}}>{k}</td><td style={{padding:"7px 10px"}}>{v}</td></tr>)}</tbody>
            </table>
            <p style={{fontSize:10,fontWeight:700,color:"#9ca3af",letterSpacing:"0.08em",margin:"0 0 8px"}}>ESTADOS</p>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:16}}>
              <tbody>{Object.entries(ESTADOS).map(([k])=><tr key={k} style={{borderBottom:"1px solid #f3f4f6"}}><td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#6b7280",width:"16%"}}>{k}</td><td style={{padding:"7px 10px"}}><Badge c={k}/></td></tr>)}</tbody>
            </table>
            <button onClick={()=>setShowRef(false)} style={{...S.red,width:"100%",padding:10,fontSize:13}}>Cerrar</button>
          </div>
        </div>
      )}

    </div>
  );
}
