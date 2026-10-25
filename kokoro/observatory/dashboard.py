# -*- coding: utf-8 -*-
"""
SAORI KOKORO â€” NEURAL OBSERVATORY: Dashboard Web UI (PWA)
=========================================================
Panel visual reactivo y autocontenido (SPA) para observar la cogniciÃ³n de SAORI,
examinar cajas negras (Flight Recorder), trazas causales y salud de la flota.
"""

from __future__ import annotations

def render_observatory_html() -> str:
    """Genera el HTML/CSS/JS completo sin dependencias externas ni CDN."""
    return """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SAORI Kokoro â€” Neural Observatory & Flight Recorder</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #131b2e;
      --card-hover: #1e293b;
      --border: #223049;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --green: #22c55e;
      --yellow: #eab308;
      --red: #ef4444;
      --purple: #a855f7;
      --cyan: #06b6d4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      line-height: 1.5;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .badge-kokoro {
      background: linear-gradient(135deg, #0284c7, #6366f1);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    h1 { font-size: 20px; font-weight: 700; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: var(--green);
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
    .pulse {
      width: 8px; height: 8px; border-radius: 50%; background: var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }
    .grid-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .metric-title { font-size: 11px; color: var(--muted); text-transform: uppercase; font-weight: 600; }
    .metric-val { font-size: 20px; font-weight: 700; margin-top: 4px; }
    .metric-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }

    h2 { font-size: 16px; margin-bottom: 12px; font-weight: 600; display: flex; align-items: center; gap: 8px; }

    .agents-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .agent-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      position: relative;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .agent-card:hover { border-color: var(--accent); }
    .agent-card.running { border-left: 4px solid var(--green); }
    .agent-card.idle { border-left: 4px solid var(--accent); }
    .agent-card.blocked { border-left: 4px solid var(--red); }
    .agent-card.stuck { border-left: 4px solid var(--yellow); }
    .agent-card.orphaned { border-left: 4px solid var(--purple); }
    .agent-card.retry_loop { border-left: 4px solid var(--red); }

    .agent-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    .agent-name { font-weight: 700; font-size: 15px; }
    .state-tag {
      font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
      text-transform: uppercase;
    }
    .state-RUNNING { background: rgba(34, 197, 94, 0.2); color: var(--green); }
    .state-IDLE { background: rgba(56, 189, 248, 0.2); color: var(--accent); }
    .state-BLOCKED { background: rgba(239, 68, 68, 0.2); color: var(--red); }
    .state-RATE_LIMITED { background: rgba(234, 179, 8, 0.2); color: var(--yellow); }
    .state-STUCK { background: rgba(234, 179, 8, 0.3); color: var(--yellow); }
    .state-ORPHANED { background: rgba(168, 85, 247, 0.2); color: var(--purple); }
    .state-RETRY_LOOP { background: rgba(239, 68, 68, 0.3); color: var(--red); }

    .agent-meta { font-size: 12px; color: var(--muted); margin-bottom: 4px; display: flex; justify-content: space-between; }
    .agent-task { font-size: 12px; font-weight: 600; color: #e2e8f0; margin-top: 6px; background: rgba(0,0,0,0.25); padding: 5px 8px; border-radius: 4px; }

    .liveness-bar {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed rgba(255,255,255,0.08);
      font-size: 11px;
      color: var(--muted);
    }
    .liveness-item strong { color: var(--text); }

    .blockade-alert {
      margin-top: 10px;
      font-size: 11px;
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      padding: 8px;
      border-radius: 6px;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Tabs & Panels */
    .tabs-nav {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      padding: 6px 12px;
      cursor: pointer;
      border-radius: 6px;
    }
    .tab-btn.active {
      background: var(--card-bg);
      color: var(--accent);
      border: 1px solid var(--border);
    }

    .panel-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }

    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px; color: var(--muted); border-bottom: 1px solid var(--border); }
    td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.04); }
    tr:hover td { background: rgba(255,255,255,0.02); }

    .clickable-row { cursor: pointer; }
    .trace-btn {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid var(--accent);
      color: var(--accent);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }

    /* Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75);
      z-index: 100;
      justify-content: center;
      align-items: center;
      padding: 16px;
    }
    .modal-content {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      max-width: 800px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      padding: 20px;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    .close-btn { background: none; border: none; color: var(--muted); font-size: 18px; cursor: pointer; }

    .span-step {
      display: flex;
      gap: 12px;
      padding: 10px;
      margin-bottom: 8px;
      background: #0f172a;
      border-radius: 6px;
      border-left: 3px solid var(--accent);
      font-size: 12px;
    }
    .span-step.DECISION { border-color: var(--purple); }
    .span-step.TOOL { border-color: var(--green); }
    .span-step.INCIDENT { border-color: var(--red); }
    .span-step.BLOCKADE { border-color: var(--yellow); }

    footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="badge-kokoro">KOKORO 3.0</span>
      <h1>Neural Observatory & Flight Recorder</h1>
      <span class="status-pill"><span class="pulse"></span> LIVE SRE</span>
    </div>
    <div style="font-size: 12px; color: var(--muted);">
      Distributed Mesh Â· Local Swarm Node Â· Ready
    </div>
  </header>

  <div class="grid-metrics">
    <div class="metric-card">
      <div class="metric-title">Flota de Agentes</div>
      <div class="metric-val" id="metric-agents">8</div>
      <div class="metric-sub" id="metric-agents-sub">Nominal</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Caja Negra (Flight Spans)</div>
      <div class="metric-val" id="metric-traces">...</div>
      <div class="metric-sub">Trazas causales activas</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Almacenamiento SQLite WAL</div>
      <div class="metric-val" id="metric-db-size">...</div>
      <div class="metric-sub">LÃ­mite estricto: 30 MB</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">DiagnÃ³stico de Bloqueos</div>
      <div class="metric-val" style="color: var(--green);" id="metric-blockades">Nominal</div>
      <div class="metric-sub" id="metric-blockades-sub">0 incidentes crÃ­ticos</div>
    </div>
  </div>

  <h2>ðŸ¤– Flota de Agentes en Vivo</h2>
  <div class="agents-grid" id="agents-container">
    <!-- Renderizado dinÃ¡micamente -->
  </div>

  <div class="tabs-nav">
    <button class="tab-btn active" onclick="switchTab('traces')">âœˆï¸� Flight Recorder (Trazas Causales)</button>
    <button class="tab-btn" onclick="switchTab('events')">âš¡ Eventos en Vivo</button>
    <button class="tab-btn" onclick="switchTab('incidents')">âš ï¸� Incidentes y Bloqueos</button>
    <button class="tab-btn" onclick="switchTab('retention')">ðŸ—„ï¸� RetenciÃ³n Diferenciada</button>
  </div>

  <!-- Panel: Flight Recorder -->
  <div class="panel-container" id="panel-traces">
    <table>
      <thead>
        <tr>
          <th>ID de Traza</th>
          <th>Agente</th>
          <th>Proyecto</th>
          <th>Tarea</th>
          <th>Modelo</th>
          <th>Estado</th>
          <th>Tramos</th>
          <th>Tokens</th>
          <th>DuraciÃ³n</th>
          <th>AcciÃ³n</th>
        </tr>
      </thead>
      <tbody id="traces-table-body">
        <tr><td colspan="10" style="color:var(--muted);">Cargando trazas del Flight Recorder...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Panel: Eventos -->
  <div class="panel-container" id="panel-events" style="display:none;">
    <div style="display:flex; gap:10px; margin-bottom:12px;">
      <select id="filter-event-agent" onchange="loadData()">
        <option value="">Todos los Agentes</option>
        <option value="claude-code">claude-code</option>
        <option value="codex">codex</option>
        <option value="codex2">codex2</option>
        <option value="antigravity">antigravity</option>
        <option value="antigravity2">antigravity2</option>
        <option value="opencode">opencode</option>
        <option value="freebuff">freebuff</option>
        <option value="saori-executive">saori-executive</option>
      </select>
      <select id="filter-event-cat" onchange="loadData()">
        <option value="">Todas las CategorÃ­as</option>
        <option value="decision">Decisiones</option>
        <option value="operation">Operaciones</option>
        <option value="telemetry">TelemetrÃ­a</option>
        <option value="incident">Incidentes</option>
      </select>
    </div>
    <table>
      <thead>
        <tr>
          <th>Hora</th>
          <th>Agente</th>
          <th>CategorÃ­a</th>
          <th>Tipo</th>
          <th>Resumen Operativo</th>
          <th>Riesgo</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody id="events-table-body">
        <tr><td colspan="7" style="color:var(--muted);">Cargando eventos...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Panel: Incidentes -->
  <div class="panel-container" id="panel-incidents" style="display:none;">
    <table>
      <thead>
        <tr>
          <th>Hora</th>
          <th>Agente</th>
          <th>Causa Diagnosticada</th>
          <th>Detalle Verificado</th>
          <th>CondiciÃ³n de RecuperaciÃ³n</th>
        </tr>
      </thead>
      <tbody id="incidents-table-body">
        <tr><td colspan="5" style="color:var(--muted);">Sin incidentes registrados.</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Panel: RetenciÃ³n -->
  <div class="panel-container" id="panel-retention" style="display:none;">
    <div style="margin-bottom:12px; font-size:13px; color:var(--muted);">
      Estrategia de retenciÃ³n estratificada activa para garantizar almacenamiento controlado (&lt;30 MB) en Star VPS.
    </div>
    <table>
      <thead>
        <tr>
          <th>CategorÃ­a</th>
          <th>Volumen MÃ¡ximo</th>
          <th>TTL (Tiempo de Vida)</th>
          <th>PropÃ³sito Operativo</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong style="color:var(--cyan)">telemetry</strong></td>
          <td>1.000 eventos</td>
          <td>24 Horas</td>
          <td>Heartbeats de agentes, ticks de progreso, latencias de proveedor.</td>
        </tr>
        <tr>
          <td><strong style="color:var(--accent)">operation</strong></td>
          <td>3.000 eventos</td>
          <td>7 DÃ­as</td>
          <td>EjecuciÃ³n de herramientas Hermes, subprocesos, transpilaciones AST.</td>
        </tr>
        <tr>
          <td><strong style="color:var(--purple)">decision</strong></td>
          <td>10.000 eventos</td>
          <td>30 DÃ­as</td>
          <td>Arranque, decisiones arquitectÃ³nicas, conmutaciÃ³n de modelos JEV, handoffs.</td>
        </tr>
        <tr>
          <td><strong style="color:var(--red)">incident</strong></td>
          <td>10.000 eventos</td>
          <td>90 DÃ­as</td>
          <td>Bloqueos LÃ­mite 6, cuotas agotadas, bucles de reintento, procesos colgados.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Modal Detalle Traza -->
  <div class="modal-backdrop" id="trace-modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="modal-trace-title">Detalle de Traza Causal</h3>
        <button class="close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div id="modal-trace-body">
        <!-- Renderizado de spans -->
      </div>
    </div>
  </div>

  <footer>
    SAORI Kokoro Autonomous SRE Engine Â· JackStar Systems Â· OperaciÃ³n Soberana Supervisada
  </footer>

  <script>
    let currentTab = 'traces';

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel-container').forEach(p => p.style.display = 'none');

      event.target.classList.add('active');
      document.getElementById('panel-' + tab).style.display = 'block';
      loadData();
    }

    async function showTrace(traceId) {
      try {
        const res = await fetch('/observatory/trace?id=' + encodeURIComponent(traceId));
        if (!res.ok) return;
        const t = await res.json();
        
        document.getElementById('modal-trace-title').innerText = 'âœˆï¸� ' + t.trace_id + ' (' + t.agent + ' Â· ' + t.status + ')';
        const body = document.getElementById('modal-trace-body');
        
        let html = `
          <div style="margin-bottom:14px; font-size:12px; color:var(--muted);">
            <strong>Tarea:</strong> ${t.task} | <strong>DuraciÃ³n:</strong> ${t.duration_seconds}s | <strong>Tokens:</strong> ${t.tokens_used}
          </div>
          <h4 style="margin-bottom:10px; font-size:13px;">Secuencia de Tramos Operativos (Causal Timeline):</h4>
        `;

        if (!t.spans || t.spans.length === 0) {
          html += '<div style="color:var(--muted);">Sin tramos registrados en esta pasada.</div>';
        } else {
          html += t.spans.map(s => `
            <div class="span-step ${s.category}">
              <div style="min-width:70px; color:var(--muted); font-size:10px;">${s.phase}<br>+${s.duration_ms}ms</div>
              <div style="flex:1;">
                <strong>${s.name}</strong> <span style="font-size:10px; opacity:0.8;">(${s.category} Â· ${s.status})</span>
                <div style="color:var(--muted); margin-top:2px;">In: ${s.input_summary}</div>
                <div style="color:#e2e8f0; margin-top:1px;">Out: ${s.output_summary}</div>
              </div>
            </div>
          `).join('');
        }

        body.innerHTML = html;
        document.getElementById('trace-modal').style.display = 'flex';
      } catch (err) {
        console.error("Error abriendo traza:", err);
      }
    }

    function closeModal() {
      document.getElementById('trace-modal').style.display = 'none';
    }

    async function loadData() {
      try {
        const [resAgents, resStats, resTraces] = await Promise.all([
          fetch('/observatory/agents').then(r => r.json()).catch(() => []),
          fetch('/observatory/stats').then(r => r.json()).catch(() => ({})),
          fetch('/observatory/traces').then(r => r.json()).catch(() => [])
        ]);

        // 1. Render Agents Grid
        const agentsDiv = document.getElementById('agents-container');
        agentsDiv.innerHTML = resAgents.map(a => `
          <div class="agent-card ${a.state.toLowerCase()}">
            <div class="agent-header">
              <span class="agent-name">${a.agent_id}</span>
              <span class="state-tag state-${a.state}">${a.state}</span>
            </div>
            <div class="agent-meta">
              <span><strong>Modelo:</strong> ${a.model}</span>
              <span style="color:var(--cyan);">${a.latency_ms}ms Â· ${a.tokens_consumed} tok</span>
            </div>
            <div class="agent-meta">
              <span><strong>Rol:</strong> ${a.role}</span>
              <span style="color:var(--green);">${a.success_rate}% OK</span>
            </div>
            <div class="agent-task">ðŸ“Œ ${a.task}</div>
            
            <div class="liveness-bar">
              <div class="liveness-item">PID: <strong>${a.pid || '-'}</strong></div>
              <div class="liveness-item">CPU: <strong>${a.liveness.cpu_ticks}t</strong></div>
              <div class="liveness-item">RSS: <strong>${a.liveness.rss_mb}MB</strong></div>
              <div class="liveness-item">Log: <strong>${a.liveness.log_age_seconds !== null ? a.liveness.log_age_seconds + 's' : '-'}</strong></div>
            </div>

            ${a.blockade ? `
              <div class="blockade-alert">
                âš ï¸� <strong>${a.blockade.cause_code}:</strong> ${a.blockade.reason}
                <div style="font-size:10px; margin-top:2px;">â†³ ${a.blockade.recovery_condition}</div>
              </div>` : ''}
          </div>
        `).join('');

        // 2. Metrics Bar
        document.getElementById('metric-agents').innerText = resAgents.length;
        document.getElementById('metric-traces').innerText = (resTraces || []).length;
        document.getElementById('metric-db-size').innerText = (resStats.db_size_mb || 0) + ' MB';
        
        const blockades = resAgents.filter(a => a.blockade !== null);
        const blockPill = document.getElementById('metric-blockades');
        if (blockades.length > 0) {
          blockPill.innerText = `${blockades.length} Alerta(s)`;
          blockPill.style.color = 'var(--yellow)';
          document.getElementById('metric-blockades-sub').innerText = 'IntervenciÃ³n o espera activa';
        } else {
          blockPill.innerText = 'Nominal (0)';
          blockPill.style.color = 'var(--green)';
          document.getElementById('metric-blockades-sub').innerText = '0 incidentes crÃ­ticos';
        }

        // 3. Tab Specific Render
        if (currentTab === 'traces') {
          const tbody = document.getElementById('traces-table-body');
          if (!resTraces || resTraces.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="color:var(--muted);">Sin trazas registradas en Flight Recorder.</td></tr>';
          } else {
            tbody.innerHTML = resTraces.map(t => `
              <tr>
                <td><code>${t.trace_id.substring(0, 18)}â€¦</code></td>
                <td><strong>${t.agent}</strong></td>
                <td>${t.project}</td>
                <td>${t.task}</td>
                <td style="color:var(--muted);">${t.model || 'default'}</td>
                <td><span class="state-tag state-${t.status}">${t.status}</span></td>
                <td>${t.total_spans}</td>
                <td>${t.tokens_used}</td>
                <td>${t.duration_seconds}s</td>
                <td><button class="trace-btn" onclick="showTrace('${t.trace_id}')">Examinar</button></td>
              </tr>
            `).join('');
          }
        } else if (currentTab === 'events') {
          const agentFilt = document.getElementById('filter-event-agent').value;
          const catFilt = document.getElementById('filter-event-cat').value;
          let url = '/observatory/events?limit=30';
          if (agentFilt) url += '&agent=' + encodeURIComponent(agentFilt);
          if (catFilt) url += '&category=' + encodeURIComponent(catFilt);

          const events = await fetch(url).then(r => r.json()).catch(() => []);
          const tbody = document.getElementById('events-table-body');
          tbody.innerHTML = events.map(e => {
            const timeStr = new Date(e.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `
              <tr>
                <td style="color:var(--muted);">${timeStr}</td>
                <td><strong>${e.agent}</strong></td>
                <td><span style="color:var(--cyan); font-weight:600;">${e.category}</span></td>
                <td><code>${e.event_type}</code></td>
                <td>${e.summary}</td>
                <td>${e.risk_level}</td>
                <td><span class="state-tag state-${e.status}">${e.status}</span></td>
              </tr>
            `;
          }).join('');
        } else if (currentTab === 'incidents') {
          const incs = await fetch('/observatory/incidents').then(r => r.json()).catch(() => []);
          const tbody = document.getElementById('incidents-table-body');
          if (incs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="color:var(--green);">0 incidentes o bloqueos activos.</td></tr>';
          } else {
            tbody.innerHTML = incs.map(i => {
              const timeStr = new Date(i.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              return `
                <tr>
                  <td style="color:var(--muted);">${timeStr}</td>
                  <td><strong>${i.agent}</strong></td>
                  <td><span class="state-tag state-BLOCKED">${i.event_type}</span></td>
                  <td>${i.summary}</td>
                  <td style="color:var(--yellow);">${i.details && i.details.recovery ? i.details.recovery : 'Espera de timer o intervenciÃ³n'}</td>
                </tr>
              `;
            }).join('');
          }
        }
      } catch (err) {
        console.error("Error cargando dashboard:", err);
      }
    }

    loadData();
    setInterval(loadData, 4000); // Polling live cada 4 segundos
  </script>
</body>
</html>
"""
