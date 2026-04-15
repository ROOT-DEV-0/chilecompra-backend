import { useState, useMemo, useEffect, useCallback } from "react";

const BASE = "http://localhost:3001/api/licitaciones";

const ESTADOS = {
  "5":  { label:"Publicada",  bg:"#dbeafe", color:"#1d4ed8" },
  "6":  { label:"Cerrada",    bg:"#f3f4f6", color:"#6b7280" },
  "7":  { label:"Desierta",   bg:"#fee2e2", color:"#b91c1c" },
  "8":  { label:"Adjudicada", bg:"#dcfce7", color:"#15803d" },
  "18": { label:"Revocada",   bg:"#fef9c3", color:"#a16207" },
  "19": { label:"Suspendida", bg:"#fef9c3", color:"#a16207" },
};

const TIPOS = {
  "L1": "Licitación Pública menor a 100 UTM",
  "LE": "Licitación Pública entre 100 y 1.000 UTM",
  "LP": "Licitación Pública mayor a 1.000 UTM",
  "LS": "Licitación Pública Servicios Personales Especializados",
  "A1": "Licitación Privada por LP anterior sin oferentes",
  "B1": "Licitación Privada por otras causales",
  "CO": "Licitación Privada entre 100 y 1.000 UTM",
  "B2": "Licitación Privada mayor a 1.000 UTM",
  "D1": "Trato Directo — Proveedor Único",
  "E2": "Licitación Privada menor a 100 UTM",
  "C1": "Compra Directa (Orden de Compra)",
  "C2": "Trato Directo Cotización",
  "F2": "Trato Directo Cotización F2",
  "F3": "Compra Directa OC F3",
  "G1": "Compra Directa OC G1",
  "G2": "Directo Cotización G2",
  "R1": "Orden de Compra menor a 3 UTM",
  "CA": "Orden de Compra sin resolución",
  "SE": "Sin emisión automática",
  "AG": "Compra Ágil",
};

function toApi(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}${m}${y}`;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function fmtD(iso) {
  return iso ? iso.split("T")[0] : "—";
}

function fmtM(m, u) {
  return m > 0 ? `${u || "CLP"} ${Number(m).toLocaleString("es-CL")}` : null;
}

function Badge({ c }) {
  const e = ESTADOS[String(c)];
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
      background: e?.bg || "#f3f4f6", color: e?.color || "#6b7280", whiteSpace: "nowrap",
    }}>
      {e?.label || `Estado ${c}`}
    </span>
  );
}

const MODES = [
  { id: "activas",      label: "Activas hoy" },
  { id: "fecha_estado", label: "Fecha / Estado" },
  { id: "codigo",       label: "Por código" },
  { id: "organismo",    label: "Organismo" },
  { id: "proveedor",    label: "Proveedor" },
];

export default function App() {
  const [ticket, setTicket]     = useState("E546CB25-483D-4EB2-9FBC-D927DB75FFCA");
  const [mode, setMode]         = useState("activas");
  const [p, setP]               = useState({ codigo: "", fecha: today(), estado: "todos", org: "", prov: "", fechaOrg: today(), fechaProv: today() });
  const [f, setF]               = useState({ q: "", tipo: "", estado: "", min: "", max: "" });
  const [data, setData]         = useState(null);
  const [detail, setDetail]     = useState(null);
  const [sel, setSel]           = useState(null);
  const [load, setLoad]         = useState(false);
  const [loadD, setLoadD]       = useState(false);
  const [err, setErr]           = useState("");
  const [pg, setPg]             = useState(1);
  const [showRef, setShowRef]   = useState(false);
  const PER = 20;

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage?.get("cc_ticket");
        if (r?.value) setTicket(r.value);
      } catch {}
    })();
  }, []);

  const saveT = useCallback(async (v) => {
    setTicket(v);
    try { await window.storage?.set("cc_ticket", v); } catch {}
  }, []);

  function buildUrl() {
    const t = encodeURIComponent(ticket.trim());
    if (mode === "activas")      return `${BASE}?estado=activas&ticket=${t}`;
    if (mode === "codigo")       return `${BASE}?codigo=${encodeURIComponent(p.codigo.trim())}&ticket=${t}`;
    if (mode === "fecha_estado") {
      const fd = p.fecha ? `&fecha=${toApi(p.fecha)}` : "";
      const es = p.estado !== "todos" ? `&estado=${p.estado}` : `&estado=todos`;
      return `${BASE}?ticket=${t}${fd}${es}`;
    }
    if (mode === "organismo") return `${BASE}?fecha=${toApi(p.fechaOrg)}&CodigoOrganismo=${encodeURIComponent(p.org)}&ticket=${t}`;
    if (mode === "proveedor")  return `${BASE}?fecha=${toApi(p.fechaProv)}&CodigoProveedor=${encodeURIComponent(p.prov)}&ticket=${t}`;
    return `${BASE}?ticket=${t}`;
  }

  async function search() {
    if (!ticket.trim()) { setErr("Ingresa tu ticket de API."); return; }
    setLoad(true); setErr(""); setData(null); setSel(null); setDetail(null); setPg(1);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setData(j);
    } catch (e) {
      setErr(
        e.message.includes("fetch") || e.message.includes("Network")
          ? "No se pudo conectar. Asegúrate que el servidor proxy está corriendo: node server.js"
          : `Error: ${e.message}`
      );
    } finally { setLoad(false); }
  }

  async function fetchDetail(codigo) {
    if (!ticket || !codigo) return;
    setLoadD(true); setDetail(null);
    try {
      const r = await fetch(`${BASE}?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(ticket.trim())}`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      if (j.Listado?.[0]) setDetail(j.Listado[0]);
    } catch {} finally { setLoadD(false); }
  }

  function selectRow(l) {
    if (sel?.CodigoExterno === l.CodigoExterno) { setSel(null); setDetail(null); }
    else { setSel(l); setDetail(null); fetchDetail(l.CodigoExterno); }
  }

  const filtered = useMemo(() => {
    if (!data?.Listado) return [];
    return data.Listado.filter(l => {
      if (f.q) {
        const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
        const text = [l.Nombre, l.CodigoExterno, l.Organismo?.Nombre, l.Descripcion]
          .filter(Boolean).join(" ").toLowerCase();
        if (!words.some(w => text.includes(w))) return false;
      }
      if (f.tipo && l.Tipo !== f.tipo) return false;
      if (f.estado && String(l.CodigoEstado) !== f.estado) return false;
      if (f.min && (l.MontoEstimado || 0) < Number(f.min)) return false;
      if (f.max && Number(f.max) > 0 && (l.MontoEstimado || 0) > Number(f.max)) return false;
      return true;
    });
  }, [data, f]);

  const totalPg = Math.ceil(filtered.length / PER);
  const items   = filtered.slice((pg - 1) * PER, pg * PER);

  const stCounts = useMemo(() => {
    if (!data?.Listado) return {};
    return data.Listado.reduce((a, l) => {
      const k = String(l.CodigoEstado);
      a[k] = (a[k] || 0) + 1;
      return a;
    }, {});
  }, [data]);

  function exportCSV() {
    const hdrs = ["Código","Nombre","Estado","Tipo","Monto","Moneda","Organismo","Publicación","Cierre"];
    const rows = filtered.map(l => [
      l.CodigoExterno,
      `"${(l.Nombre||"").replace(/"/g,'""')}"`,
      ESTADOS[String(l.CodigoEstado)]?.label || l.CodigoEstado,
      l.Tipo, l.MontoEstimado || 0,
      l.UnidadMonedaEstimadaDescripcion || "CLP",
      `"${(l.Organismo?.Nombre||"").replace(/"/g,'""')}"`,
      fmtD(l.FechaPublicacion),
      fmtD(l.FechaCierre),
    ]);
    const csv = [hdrs, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `licitaciones_${today()}.csv`;
    a.click();
  }

  const D       = detail || sel;
  const hasFil  = f.q || f.tipo || f.estado || f.min || f.max;

  const inp  = { fontSize: 12, height: 32, boxSizing: "border-box", width: "100%", padding: "0 8px", border: "1px solid #e5e7eb", borderRadius: 6, background: "white", color: "#111", outline: "none" };
  const lbl  = { fontSize: 9, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.06em", marginBottom: 4, display: "block" };
  const card = { background: "white", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", marginBottom: 8 };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#111", paddingTop: 12, paddingBottom: 40, background: "#f9fafb", minHeight: "100vh", padding: "12px 16px 40px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <div style={{ display: "flex", gap: 2 }}>
              <div style={{ width: 4, height: 22, background: "#003087", borderRadius: 2 }} />
              <div style={{ width: 4, height: 22, background: "#fff", borderRadius: 2, border: "1px solid #ddd" }} />
              <div style={{ width: 4, height: 22, background: "#D52B1E", borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Explorador de Licitaciones</span>
            <span style={{ fontSize: 9, color: "#9ca3af", padding: "2px 7px", border: "1px solid #e5e7eb", borderRadius: 99 }}>ChileCompra API</span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "#6b7280", marginLeft: 14 }}>Consulta, filtra y exporta licitaciones de Mercado Público en tiempo real</p>
        </div>
        <button onClick={() => setShowRef(true)}
          style={{ fontSize: 11, color: "#3b82f6", padding: "5px 12px", border: "1px solid #3b82f6", borderRadius: 6, background: "transparent", cursor: "pointer", whiteSpace: "nowrap" }}>
          📋 Códigos de referencia
        </button>
      </div>

      {/* Ticket */}
      <div style={card}>
        <label style={lbl}>TICKET DE API</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={ticket} onChange={e => saveT(e.target.value)}
            style={{ ...inp, fontFamily: "monospace", fontSize: 11, flex: 1 }} />
          <span style={{ fontSize: 9, padding: "3px 8px", background: "#dcfce7", color: "#15803d", borderRadius: 99, whiteSpace: "nowrap", fontWeight: 600 }}>✓ Listo</span>
        </div>
      </div>

      {/* Mode */}
      <div style={card}>
        <label style={lbl}>TIPO DE BÚSQUEDA</label>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => { setMode(m.id); setData(null); setSel(null); setDetail(null); }}
              style={{ padding: "4px 12px", fontSize: 11, borderRadius: 99, cursor: "pointer",
                border: mode === m.id ? "2px solid #111" : "1px solid #e5e7eb",
                background: mode === m.id ? "#111" : "white",
                fontWeight: mode === m.id ? 600 : 400,
                color: mode === m.id ? "white" : "#374151" }}>
              {m.label}
            </button>
          ))}
        </div>

        {mode !== "activas" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 10 }}>
            {mode === "codigo" && (
              <div>
                <label style={lbl}>CÓDIGO</label>
                <input value={p.codigo} onChange={e => setP(x => ({ ...x, codigo: e.target.value }))}
                  placeholder="1509-5-L114" style={{ ...inp, fontFamily: "monospace", fontSize: 11 }} />
              </div>
            )}
            {mode === "fecha_estado" && (<>
              <div>
                <label style={lbl}>FECHA</label>
                <input type="date" value={p.fecha} onChange={e => setP(x => ({ ...x, fecha: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>ESTADO</label>
                <select value={p.estado} onChange={e => setP(x => ({ ...x, estado: e.target.value }))} style={inp}>
                  <option value="todos">Todos</option>
                  <option value="activas">Activas</option>
                  <option value="publicada">Publicada</option>
                  <option value="cerrada">Cerrada</option>
                  <option value="desierta">Desierta</option>
                  <option value="adjudicada">Adjudicada</option>
                  <option value="revocada">Revocada</option>
                  <option value="suspendida">Suspendida</option>
                </select>
              </div>
            </>)}
            {mode === "organismo" && (<>
              <div>
                <label style={lbl}>CÓDIGO ORGANISMO</label>
                <input value={p.org} onChange={e => setP(x => ({ ...x, org: e.target.value }))}
                  placeholder="694" style={{ ...inp, fontFamily: "monospace" }} />
              </div>
              <div>
                <label style={lbl}>FECHA</label>
                <input type="date" value={p.fechaOrg} onChange={e => setP(x => ({ ...x, fechaOrg: e.target.value }))} style={inp} />
              </div>
            </>)}
            {mode === "proveedor" && (<>
              <div>
                <label style={lbl}>CÓDIGO PROVEEDOR</label>
                <input value={p.prov} onChange={e => setP(x => ({ ...x, prov: e.target.value }))}
                  placeholder="17793" style={{ ...inp, fontFamily: "monospace" }} />
              </div>
              <div>
                <label style={lbl}>FECHA</label>
                <input type="date" value={p.fechaProv} onChange={e => setP(x => ({ ...x, fechaProv: e.target.value }))} style={inp} />
              </div>
            </>)}
          </div>
        )}

        <button onClick={search} disabled={load}
          style={{ width: "100%", height: 36, background: load ? "#9ca3af" : "#D52B1E", color: "white", border: "none", borderRadius: 6, cursor: load ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
          {load ? "Consultando API..." : "🔍  Buscar licitaciones"}
        </button>
      </div>

      {err && (
        <div style={{ padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, marginBottom: 8, fontSize: 12, color: "#b91c1c", lineHeight: 1.6 }}>
          {err}
        </div>
      )}

      {data && (
        <div>
          {/* Métricas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 6, marginBottom: 8 }}>
            {[
              { l: "Total API", v: (data.Cantidad || 0).toLocaleString("es-CL") },
              { l: "Filtradas",  v: filtered.length.toLocaleString("es-CL") },
              ...Object.entries(stCounts).sort(([,a],[,b]) => b - a).slice(0, 4).map(([k, v]) => ({
                l: ESTADOS[k]?.label || `Est.${k}`, v: v.toLocaleString("es-CL"), dot: ESTADOS[k]?.color,
              })),
            ].map(({ l, v, dot }, i) => (
              <div key={i} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                  {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: dot, display: "inline-block" }} />}
                  <p style={{ margin: 0, fontSize: 9, color: "#6b7280" }}>{l}</p>
                </div>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div style={card}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto auto auto", gap: 6, alignItems: "end" }}>
              <div>
                <label style={lbl}>BUSCAR POR PALABRAS CLAVE (nombre, código, organismo, descripción)</label>
                <input value={f.q} onChange={e => { setF(x => ({ ...x, q: e.target.value })); setPg(1); }}
                  placeholder="Ej: computador, aseo, consultoría..." style={inp} />
              </div>
              <div style={{ minWidth: 90 }}>
                <label style={lbl}>TIPO</label>
                <select value={f.tipo} onChange={e => { setF(x => ({ ...x, tipo: e.target.value })); setPg(1); }} style={{ ...inp, minWidth: 90 }}>
                  <option value="">Todos</option>
                  {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 110 }}>
                <label style={lbl}>ESTADO</label>
                <select value={f.estado} onChange={e => { setF(x => ({ ...x, estado: e.target.value })); setPg(1); }} style={{ ...inp, minWidth: 110 }}>
                  <option value="">Todos</option>
                  {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 95 }}>
                <label style={lbl}>MONTO MÍN</label>
                <input type="number" value={f.min} onChange={e => { setF(x => ({ ...x, min: e.target.value })); setPg(1); }} placeholder="0" style={{ ...inp, minWidth: 95 }} />
              </div>
              <div style={{ minWidth: 95 }}>
                <label style={lbl}>MONTO MÁX</label>
                <input type="number" value={f.max} onChange={e => { setF(x => ({ ...x, max: e.target.value })); setPg(1); }} placeholder="∞" style={{ ...inp, minWidth: 95 }} />
              </div>
              {hasFil && (
                <button onClick={() => { setF({ q: "", tipo: "", estado: "", min: "", max: "" }); setPg(1); }}
                  style={{ height: 32, padding: "0 10px", fontSize: 11, border: "1px solid #e5e7eb", borderRadius: 6, background: "white", cursor: "pointer", color: "#6b7280" }}>
                  Limpiar
                </button>
              )}
              <button onClick={exportCSV}
                style={{ height: 32, padding: "0 10px", fontSize: 11, border: "1px solid #e5e7eb", borderRadius: 6, background: "white", cursor: "pointer", color: "#111", whiteSpace: "nowrap" }}>
                ↓ CSV
              </button>
            </div>
          </div>

          {/* Tabla + panel */}
          <div style={{ display: "grid", gridTemplateColumns: sel ? "1fr 340px" : "1fr", gap: 8, alignItems: "start" }}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "white" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed", minWidth: sel ? 380 : 580 }}>
                  <colgroup>
                    <col style={{ width: sel ? "22%" : "13%" }} />
                    <col style={{ width: sel ? "42%" : "36%" }} />
                    <col style={{ width: "14%" }} />
                    {!sel && <col style={{ width: "7%" }} />}
                    <col style={{ width: sel ? "22%" : "18%" }} />
                    {!sel && <col style={{ width: "12%" }} />}
                  </colgroup>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Código", "Nombre", "Estado", ...(!sel ? ["Tipo"] : []), "Monto", ...(!sel ? ["Organismo"] : [])].map(h => (
                        <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontWeight: 600, fontSize: 10, color: "#6b7280", borderBottom: "1px solid #e5e7eb", letterSpacing: "0.04em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                        {data.Cantidad === 0 ? "La API no retornó resultados." : "Sin resultados con los filtros actuales."}
                      </td></tr>
                    )}
                    {items.map((l, i) => {
                      const isS = sel?.CodigoExterno === l.CodigoExterno;
                      return (
                        <tr key={l.CodigoExterno || i} onClick={() => selectRow(l)}
                          style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: isS ? "#eff6ff" : "white" }}
                          onMouseEnter={e => { if (!isS) e.currentTarget.style.background = "#f9fafb"; }}
                          onMouseLeave={e => { if (!isS) e.currentTarget.style.background = "white"; }}>
                          <td style={{ padding: "9px 10px", fontFamily: "monospace", fontSize: 10, color: "#9ca3af" }}>{l.CodigoExterno}</td>
                          <td style={{ padding: "9px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.Nombre}>{l.Nombre}</td>
                          <td style={{ padding: "9px 10px" }}><Badge c={l.CodigoEstado} /></td>
                          {!sel && (
                            <td style={{ padding: "9px 10px", fontFamily: "monospace", fontSize: 10, color: "#6b7280", cursor: "help" }}
                              title={TIPOS[l.Tipo] || l.Tipo}>{l.Tipo}</td>
                          )}
                          <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontSize: 11 }}>
                            {l.MontoEstimado > 0
                              ? fmtM(l.MontoEstimado, l.UnidadMonedaEstimadaDescripcion)
                              : <span style={{ color: "#d1d5db" }}>—</span>}
                          </td>
                          {!sel && (
                            <td style={{ padding: "9px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "#6b7280" }}>
                              {l.Organismo?.Nombre}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPg > 1 && (
                <div style={{ display: "flex", gap: 6, justifyContent: "center", padding: 10, borderTop: "1px solid #f3f4f6", alignItems: "center" }}>
                  <button onClick={() => setPg(1)} disabled={pg === 1} style={{ padding: "3px 8px", fontSize: 11 }}>«</button>
                  <button onClick={() => setPg(x => Math.max(1, x - 1))} disabled={pg === 1} style={{ padding: "3px 8px", fontSize: 11 }}>‹</button>
                  <span style={{ fontSize: 11, color: "#6b7280", minWidth: 130, textAlign: "center" }}>{pg} / {totalPg} · {filtered.length.toLocaleString("es-CL")} resultados</span>
                  <button onClick={() => setPg(x => Math.min(totalPg, x + 1))} disabled={pg === totalPg} style={{ padding: "3px 8px", fontSize: 11 }}>›</button>
                  <button onClick={() => setPg(totalPg)} disabled={pg === totalPg} style={{ padding: "3px 8px", fontSize: 11 }}>»</button>
                </div>
              )}
            </div>

            {/* Panel detalle */}
            {sel && (
              <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <Badge c={sel.CodigoEstado} />
                  <button onClick={() => { setSel(null); setDetail(null); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16 }}>✕</button>
                </div>
                <p style={{ margin: "0 0 3px", fontSize: 9, fontFamily: "monospace", color: "#9ca3af" }}>{sel.CodigoExterno}</p>
                <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{sel.Nombre}</p>
                {loadD && <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 8px" }}>Cargando detalle...</p>}
                <div style={{ fontSize: 12, marginBottom: 10 }}>
                  {[
                    [D?.Tipo ? `${D.Tipo} — ${TIPOS[D.Tipo] || D.Tipo}` : null, "Tipo"],
                    [D?.Organismo?.Nombre, "Organismo"],
                    [fmtM(D?.MontoEstimado, D?.UnidadMonedaEstimadaDescripcion), "Monto"],
                    [fmtD(D?.FechaPublicacion) !== "—" ? fmtD(D?.FechaPublicacion) : null, "Publicación"],
                    [fmtD(D?.FechaCierre) !== "—" ? fmtD(D?.FechaCierre) : null, "Cierre"],
                    [fmtD(D?.FechaAdjudicacion) !== "—" ? fmtD(D?.FechaAdjudicacion) : null, "Adjudicación"],
                    [D?.Regiones?.[0]?.NombreRegion || D?.RegionUnidad, "Región"],
                  ].filter(([v]) => v).map(([v, l]) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontSize: 11, color: "#6b7280", flexShrink: 0 }}>{l}</span>
                      <span style={{ fontSize: 11, textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                </div>
                {D?.Descripcion && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 9, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.06em", margin: "0 0 4px" }}>DESCRIPCIÓN</p>
                    <p style={{ fontSize: 11, lineHeight: 1.6, margin: 0, color: "#6b7280", maxHeight: 90, overflowY: "auto" }}>{D.Descripcion}</p>
                  </div>
                )}
                {D?.Items?.Listado?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 9, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.06em", margin: "0 0 4px" }}>ÍTEMS ({D.Items.Listado.length})</p>
                    <div style={{ maxHeight: 130, overflowY: "auto", border: "1px solid #f3f4f6", borderRadius: 6 }}>
                      {D.Items.Listado.slice(0, 8).map((it, i) => (
                        <div key={i} style={{ padding: "6px 8px", borderBottom: "1px solid #f9fafb" }}>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.NombreProducto || it.Nombre}</p>
                          <p style={{ margin: 0, fontSize: 10, color: "#6b7280" }}>Cant: {it.Cantidad} {it.UnidadMedida}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {D?.Adjudicacion?.Adjudicatarios?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 9, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.06em", margin: "0 0 4px" }}>ADJUDICATARIOS</p>
                    {D.Adjudicacion.Adjudicatarios.slice(0, 3).map((a, i) => (
                      <div key={i} style={{ padding: "5px 0", borderBottom: "1px solid #f3f4f6", fontSize: 11 }}>
                        <p style={{ margin: 0, fontWeight: 600 }}>{a.NombreProveedor || a.Nombre}</p>
                        {a.MontoTotal && <p style={{ margin: 0, fontSize: 10, color: "#6b7280", fontFamily: "monospace" }}>{fmtM(a.MontoTotal, D.UnidadMonedaEstimadaDescripcion)}</p>}
                      </div>
                    ))}
                  </div>
                )}
                <a href={`https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs=WgLuBLRjJcBU5dIg43fZAQ==&idlicitacion=${sel.CodigoExterno}`}
                  target="_blank"
                  style={{ display: "block", textAlign: "center", padding: 9, background: "#D52B1E", color: "white", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                  Ver en Mercado Público ↗
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {!data && !load && !err && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#9ca3af" }}>
          <p style={{ fontSize: 13, margin: 0 }}>Selecciona el tipo de búsqueda y presiona Buscar</p>
          <p style={{ fontSize: 11, marginTop: 6 }}>Datos públicos de <a href="https://www.mercadopublico.cl" target="_blank" style={{ color: "#3b82f6" }}>mercadopublico.cl</a></p>
        </div>
      )}

      {/* Modal de referencia de códigos */}
      {showRef && (
        <div onClick={() => setShowRef(false)}
          style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 640, width: "90%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>📋 Tabla de referencia de códigos</span>
              <button onClick={() => setShowRef(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>✕</button>
            </div>

            <p style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", margin: "0 0 8px" }}>TIPOS DE LICITACIÓN</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 20 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, color: "#6b7280", borderBottom: "1px solid #e5e7eb", width: "16%" }}>Código</th>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(TIPOS).map(([k, v], i) => (
                  <tr key={k} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>{k}</td>
                    <td style={{ padding: "7px 10px" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", margin: "0 0 8px" }}>ESTADOS</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 20 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, color: "#6b7280", borderBottom: "1px solid #e5e7eb", width: "16%" }}>Código</th>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ESTADOS).map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#6b7280" }}>{k}</td>
                    <td style={{ padding: "7px 10px" }}><Badge c={k} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", margin: "0 0 8px" }}>UNIDADES MONETARIAS</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 20 }}>
              <tbody>
                {[["CLP","Peso Chileno"],["CLF","Unidad de Fomento (UF)"],["UTM","Unidad Tributaria Mensual"],["USD","Dólar Americano"],["EUR","Euro"]].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#1d4ed8", width: "16%" }}>{k}</td>
                    <td style={{ padding: "7px 10px" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button onClick={() => setShowRef(false)}
              style={{ width: "100%", padding: 10, background: "#D52B1E", color: "white", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
