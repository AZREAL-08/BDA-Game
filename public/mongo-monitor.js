// HexDominion: Live MongoDB Query Inspector & Telemetry Controller

const socket = io();

let isPaused = false;
let capturedQueries = [];
let activeDocCollection = 'tiles';
let collectionsData = null;

window.addEventListener('DOMContentLoaded', () => {
  bindControls();
  fetchInitialTelemetry();
  fetchCollectionDocs();

  // Socket.io real-time MongoDB query listener!
  socket.on('mongo:live_query', (query) => {
    if (isPaused) return;
    addQueryToStream(query);
  });

  // Refresh collection documents every 5 seconds
  setInterval(fetchCollectionDocs, 5000);
});

function bindControls() {
  document.getElementById('btnTogglePause').addEventListener('click', () => {
    isPaused = !isPaused;
    const btn = document.getElementById('btnTogglePause');
    const statusText = document.getElementById('streamStatusText');
    const pulseDot = document.querySelector('.pulse-dot');

    if (isPaused) {
      btn.textContent = '▶️ Resume';
      statusText.textContent = 'STREAM PAUSED';
      statusText.style.color = '#f59e0b';
      pulseDot.style.background = '#f59e0b';
    } else {
      btn.textContent = '⏸️ Pause';
      statusText.textContent = 'LIVE STREAMING';
      statusText.style.color = 'var(--mongo-green)';
      pulseDot.style.background = 'var(--mongo-green)';
    }
  });

  document.getElementById('btnClearLogs').addEventListener('click', async () => {
    capturedQueries = [];
    document.getElementById('queryTerminal').innerHTML = `
      <div class="empty-terminal-prompt">
        <span class="mongo-icon-large">🍃</span>
        <p>Log buffer cleared. Waiting for new game operations...</p>
      </div>
    `;
    document.getElementById('logsCountBadge').textContent = '0 Queries';
    await fetch('/api/mongodb/clear', { method: 'POST' });
  });

  // Filters
  document.getElementById('filterCommand').addEventListener('change', renderFilteredQueries);
  document.getElementById('filterCollection').addEventListener('change', renderFilteredQueries);

  // Document Tabs
  document.querySelectorAll('.doc-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.doc-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeDocCollection = tab.dataset.col;
      renderActiveCollection();
    });
  });

  document.getElementById('btnRefreshDocs').addEventListener('click', fetchCollectionDocs);
}

async function fetchInitialTelemetry() {
  try {
    const res = await fetch('/api/mongodb/telemetry?limit=40');
    const data = await res.json();
    if (data.success) {
      updateMetrics(data.metrics);
      if (data.logs && data.logs.length > 0) {
        capturedQueries = data.logs;
        renderFilteredQueries();
      }
    }
  } catch (err) {
    console.error('Failed to fetch telemetry:', err);
  }
}

async function fetchCollectionDocs() {
  try {
    const res = await fetch('/api/mongodb/collections');
    const data = await res.json();
    if (data.success) {
      collectionsData = data;
      document.getElementById('countTiles').textContent = data.stats.collections.tiles;
      document.getElementById('countMatches').textContent = data.stats.collections.matches;
      document.getElementById('countPlayers').textContent = data.stats.collections.players;
      renderActiveCollection();
    }
  } catch (err) {
    console.error('Failed to fetch collections:', err);
  }
}

function updateMetrics(metrics) {
  if (!metrics) return;
  document.getElementById('metricTotalQueries').textContent = metrics.totalOperations;
  document.getElementById('metricAvgLatency').textContent = `${metrics.avgLatencyMs} ms`;
}

function addQueryToStream(query) {
  capturedQueries.unshift(query);
  if (capturedQueries.length > 200) capturedQueries.pop();

  // Increment total query count metric
  const totalElem = document.getElementById('metricTotalQueries');
  const currentTotal = parseInt(totalElem.textContent, 10) || 0;
  totalElem.textContent = currentTotal + 1;

  renderFilteredQueries();
}

function renderFilteredQueries() {
  const cmdFilter = document.getElementById('filterCommand').value;
  const colFilter = document.getElementById('filterCollection').value;

  const filtered = capturedQueries.filter((q) => {
    const matchesCmd =
      cmdFilter === 'ALL' || q.commandName.toLowerCase().includes(cmdFilter.toLowerCase());
    const matchesCol = colFilter === 'ALL' || q.collectionName === colFilter;
    return matchesCmd && matchesCol;
  });

  const terminal = document.getElementById('queryTerminal');
  document.getElementById('logsCountBadge').textContent = `${filtered.length} Queries`;

  if (filtered.length === 0) {
    terminal.innerHTML = `
      <div class="empty-terminal-prompt">
        <span class="mongo-icon-large">🍃</span>
        <p>No queries matching the selected filter criteria.</p>
      </div>
    `;
    return;
  }

  terminal.innerHTML = filtered
    .slice(0, 50)
    .map((q) => {
      const timeStr = new Date(q.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      });

      let cardType = 'find';
      if (q.commandName.toLowerCase().includes('update')) cardType = 'update';
      else if (q.commandName.toLowerCase().includes('insert')) cardType = 'insert';

      return `
      <div class="query-card ${cardType}">
        <div class="query-meta">
          <div class="meta-left">
            <span class="cmd-badge ${cardType}">${q.commandName.toUpperCase()}</span>
            <span class="coll-badge">db.${q.collectionName}</span>
            <span class="query-time">${timeStr}</span>
          </div>
          <div class="meta-right">
            <span class="latency-badge">⚡ ${q.durationMs}ms</span>
          </div>
        </div>

        <div class="query-context">${q.gameContext}</div>

        <pre class="code-snippet"><code>${escapeHtml(q.mongoShellCode)}</code></pre>
      </div>
    `;
    })
    .join('');
}

function renderActiveCollection() {
  if (!collectionsData) return;

  const viewer = document.getElementById('jsonViewer');
  const hint = document.getElementById('schemaHint');

  if (activeDocCollection === 'tiles') {
    hint.innerHTML = `<strong>Compound Primary Key:</strong> <code>_id: "match_id:q:X,r:Y,s:Z"</code> guarantees direct $O(1)$ spatial point queries. Fast atomic <code>$set</code> and <code>$inc</code> mutations.`;
    viewer.textContent = JSON.stringify(collectionsData.samples.tiles, null, 2);
  } else if (activeDocCollection === 'matches') {
    hint.innerHTML = `<strong>Arena Match State:</strong> Stores active player objects, live <code>ap_current</code>, timestamp <code>last_ap_tick</code> for lazy Elixir evaluation, and winner status.`;
    viewer.textContent = JSON.stringify(collectionsData.samples.matches, null, 2);
  } else if (activeDocCollection === 'players') {
    hint.innerHTML = `<strong>Global Commanders:</strong> Tracks registered profiles, unique username index, and lifetime territory conquests.`;
    viewer.textContent = JSON.stringify({ message: "Player documents loaded on-demand from db.players collection." }, null, 2);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
