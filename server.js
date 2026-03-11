const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
//  VAPID – configura su Render come env vars:
//  VAPID_PUBLIC, VAPID_PRIVATE, VAPID_EMAIL
// ─────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'BLMHRq1reRHpv7hXBcHU0n0230KHthyZt6iH9mw9e-d1ZqHY2YqfnWwXHCbTmI4aIgBy3MQ4_Czh-4cSOK0QUxc';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'KM9FgT-B5OZBkeEjSwbdF687X34Ms-7WRoFDFCUy5Z0';
const VAPID_EMAIL   = process.env.VAPID_EMAIL   || 'mailto:admin@linkpc.local';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

// ─────────────────────────────────────────────
//  CODA MESSAGGI
//  Quando un telefono è offline, i messaggi dal PC
//  vengono accodati. Al riconnessione vengono
//  scaricati tutti in ordine e la coda svuotata.
// ─────────────────────────────────────────────
const MAX_QUEUE = 100;
// Map: phoneName → [ {from, text, timestamp}, ... ]
const messageQueues = new Map();

function enqueue(phoneName, message) {
  if (!messageQueues.has(phoneName)) messageQueues.set(phoneName, []);
  const q = messageQueues.get(phoneName);
  q.push({ from: message.from, text: message.text, timestamp: message.timestamp });
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
  console.log(`[QUEUE] +1 per "${phoneName}" (totale: ${q.length})`);
}

function flushQueue(phoneName, ws) {
  const q = messageQueues.get(phoneName);
  if (!q || q.length === 0) return;
  console.log(`[QUEUE] Flush ${q.length} msg → "${phoneName}"`);
  ws.send(JSON.stringify({ type: 'queued', messages: q }));
  messageQueues.set(phoneName, []);
}

// ─────────────────────────────────────────────
//  PUSH SUBSCRIPTIONS
// ─────────────────────────────────────────────
const pushSubscriptions = new Map();

app.get('/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

app.post('/subscribe', (req, res) => {
  const { subscription, name } = req.body;
  if (!subscription || !name) return res.status(400).json({ error: 'subscription e name obbligatori' });
  pushSubscriptions.set(name, subscription);
  console.log(`[PUSH] Sottoscrizione salvata per: ${name}`);
  res.json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  const { name } = req.body;
  if (name) pushSubscriptions.delete(name);
  res.json({ ok: true });
});

async function sendPush(targetName, payload) {
  const sub = pushSubscriptions.get(targetName);
  if (!sub) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    console.log(`[PUSH] ✓ Notifica → ${targetName}`);
  } catch (err) {
    console.error(`[PUSH] ✗ Errore → ${targetName}: ${err.statusCode || err.message}`);
    if (err.statusCode === 410 || err.statusCode === 404) pushSubscriptions.delete(targetName);
  }
}

// ─────────────────────────────────────────────
//  WEBSOCKET RELAY
// ─────────────────────────────────────────────
const clients = { pc: null, phones: new Set() };

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  if (clients.pc && clients.pc !== excludeWs && clients.pc.readyState === 1) clients.pc.send(data);
  clients.phones.forEach(ws => { if (ws !== excludeWs && ws.readyState === 1) ws.send(data); });
}

function getStatus() {
  return { type: 'status', pcConnected: clients.pc !== null, phonesConnected: clients.phones.size, timestamp: new Date().toISOString() };
}

function broadcastStatus() {
  const s = JSON.stringify(getStatus());
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(s); });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientType = url.searchParams.get('type');
  const clientName = url.searchParams.get('name') || 'Anonimo';

  console.log(`[+] Connesso: type=${clientType}, name=${clientName}`);

  if (clientType === 'pc') {
    if (clients.pc) clients.pc.close();
    clients.pc = ws;
    ws.clientName = 'PC';
    broadcast({ type: 'system', text: '💻 PC connesso alla rete', timestamp: new Date().toISOString() }, ws);
  } else {
    ws.clientName = clientName;
    clients.phones.add(ws);
    broadcast({ type: 'system', text: `📱 ${clientName} connesso`, timestamp: new Date().toISOString() }, ws);
  }

  broadcastStatus();
  ws.send(JSON.stringify(getStatus()));
  ws.send(JSON.stringify({ type: 'system', text: `✅ Connesso come ${ws.clientName}`, timestamp: new Date().toISOString() }));

  // ── Scarica subito la coda se è un telefono che si (ri)connette ──
  if (clientType !== 'pc') {
    flushQueue(clientName, ws);
  }

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      message.from = ws.clientName;
      message.timestamp = new Date().toISOString();
      console.log(`[MSG] type=${message.type} from=${message.from}`);

      // ── Ricerca: telefono → PC ──────────────────────────────────────────
      if (message.type === 'search') {
        if (clients.pc && clients.pc.readyState === 1) {
          clients.pc.send(JSON.stringify(message));
        } else {
          ws.send(JSON.stringify({ type: 'error', requestId: message.requestId || '', message: 'PC non connesso' }));
        }
        return;
      }

      // ── Risultato ricerca: PC → telefoni ───────────────────────────────
      if (message.type === 'search_result' || (message.type === 'error' && clientType === 'pc')) {
        clients.phones.forEach(phone => {
          if (phone.readyState === 1) phone.send(JSON.stringify(message));
        });
        return;
      }

      // ── Messaggio di testo normale ─────────────────────────────────────
      broadcast(message, ws);
      ws.send(JSON.stringify({ type: 'echo', text: message.text, timestamp: message.timestamp }));

      // Solo per messaggi provenienti dal PC
      if (clientType === 'pc') {
        const connectedPhoneNames = new Set([...clients.phones].map(p => p.clientName));

        for (const [phoneName] of pushSubscriptions) {
          if (!connectedPhoneNames.has(phoneName)) {
            // Accoda il messaggio per quando si riconnette
            enqueue(phoneName, message);

            // Invia push come "campanello" — i dati arrivano via WS alla riapertura
            await sendPush(phoneName, {
              title: `💻 ${message.from}`,
              body: message.text.length > 80 ? message.text.slice(0, 77) + '…' : message.text,
              icon: '/icons/icon-192.png',
              badge: '/icons/badge-72.png',
              tag: 'linkpc-msg',
              renotify: true,
              data: { url: '/' }
            });
          }
        }
      }

    } catch (e) {
      console.error('Errore parsing messaggio:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Disconnesso: ${ws.clientName}`);
    if (clientType === 'pc') clients.pc = null;
    else clients.phones.delete(ws);
    broadcast({ type: 'system', text: `🔌 ${ws.clientName} disconnesso`, timestamp: new Date().toISOString() });
    broadcastStatus();
  });

  ws.on('error', (err) => console.error(`Errore WS (${ws.clientName}):`, err));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 LinkPC PWA server → porta ${PORT}`);
});
