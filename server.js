const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve la pagina web per smartphone
app.use(express.static(path.join(__dirname, 'public')));

// Stato connessioni
const clients = {
  pc: null,
  phones: new Set()
};

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  
  // Manda al PC
  if (clients.pc && clients.pc !== excludeWs && clients.pc.readyState === 1) {
    clients.pc.send(data);
  }
  
  // Manda a tutti i telefoni
  clients.phones.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(data);
    }
  });
}

function getStatus() {
  return {
    type: 'status',
    pcConnected: clients.pc !== null,
    phonesConnected: clients.phones.size,
    timestamp: new Date().toISOString()
  };
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientType = url.searchParams.get('type'); // 'pc' o 'phone'
  const clientName = url.searchParams.get('name') || 'Anonimo';

  console.log(`[+] Connesso: type=${clientType}, name=${clientName}`);

  if (clientType === 'pc') {
    // Se c'era già un PC connesso, disconnetti il vecchio
    if (clients.pc) {
      clients.pc.close();
    }
    clients.pc = ws;
    ws.clientName = 'PC';
    
    // Notifica a tutti
    broadcast({ type: 'system', text: '💻 PC connesso alla rete', timestamp: new Date().toISOString() }, ws);
    
    // Manda status aggiornato a tutti
    const status = getStatus();
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(status)); });

  } else {
    // È un telefono
    ws.clientName = clientName;
    clients.phones.add(ws);
    
    // Notifica a tutti
    broadcast({ type: 'system', text: `📱 ${clientName} connesso`, timestamp: new Date().toISOString() }, ws);
    
    // Manda status aggiornato a tutti
    const status = getStatus();
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(status)); });
  }

  // Manda status iniziale al nuovo client
  ws.send(JSON.stringify(getStatus()));
  ws.send(JSON.stringify({ 
    type: 'system', 
    text: `✅ Connesso come ${ws.clientName}`,
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      message.from = ws.clientName;
      message.timestamp = new Date().toISOString();
      
      console.log(`[MSG] ${message.from}: ${message.text}`);
      
      // Relay a tutti gli altri
      broadcast(message, ws);
      
      // Conferma al mittente
      ws.send(JSON.stringify({ 
        type: 'echo', 
        text: message.text, 
        timestamp: message.timestamp 
      }));
      
    } catch (e) {
      console.error('Errore parsing messaggio:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Disconnesso: ${ws.clientName}`);
    
    if (clientType === 'pc') {
      clients.pc = null;
    } else {
      clients.phones.delete(ws);
    }
    
    broadcast({ 
      type: 'system', 
      text: `🔌 ${ws.clientName} disconnesso`,
      timestamp: new Date().toISOString()
    });
    
    const status = getStatus();
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(status)); });
  });

  ws.on('error', (err) => {
    console.error(`Errore WebSocket (${ws.clientName}):`, err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
});
