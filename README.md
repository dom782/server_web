# LinkPC – Guida al Deploy

Architettura: **Smartphone** ↔ **Render (relay)** ↔ **PC locale**

---

## 1. Deploy del Server su Render

### Prerequisiti
- Account gratuito su [render.com](https://render.com)
- Repository GitHub con i file della cartella `server/`

### Struttura cartella `server/`
```
server/
├── server.js
├── package.json
└── public/
    └── index.html
```

### Passi
1. Push la cartella `server/` su GitHub
2. Vai su Render → **New → Web Service**
3. Collega il repo GitHub
4. Imposta:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. Clicca **Deploy**
6. Copia l'URL del servizio (es. `https://mio-relay.onrender.com`)

---

## 2. Aggiorna il Client PC

Apri `pc_client/client_pc.py` e modifica riga 17:

```python
SERVER_URL = "wss://mio-relay.onrender.com"   # <-- il tuo URL
PC_NAME    = "PC-Casa"                          # <-- nome del PC
```

Oppure usa variabili d'ambiente:
```bash
export RELAY_SERVER="wss://mio-relay.onrender.com"
export PC_NAME="PC-Casa"
```

---

## 3. Avvia il Client PC

```bash
# Installa dipendenza
pip install websockets

# Avvia
python client_pc.py

# Oppure passando URL come argomento
python client_pc.py wss://mio-relay.onrender.com
```

---

## 4. Connetti lo Smartphone

Apri il browser sul telefono e vai su:
```
https://mio-relay.onrender.com
```

Inserisci il tuo nome → **Connetti** → inizia a chattare!

---

## Flusso di Comunicazione

```
[Smartphone]  ---WebSocket--->  [Render Server]  ---WebSocket--->  [PC Python]
    |                                   |                               |
    |   <-- relay messaggio ----------- |  <-- messaggio ------------- |
```

- Il server fa da **relay puro**: riceve da uno, manda a tutti gli altri
- La connessione è **bidirezionale** e **persistente**
- Il client PC si **riconnette automaticamente** in caso di caduta

---

## Note sul Piano Gratuito di Render

⚠️ Il piano free mette in sleep il servizio dopo 15 minuti di inattività.
- Il primo messaggio potrebbe richiedere 30-60 secondi (cold start)
- Per evitarlo: usa un cron job che fa ping ogni 10 minuti, oppure aggiorna al piano Starter ($7/mese)

---

## Comandi Client PC

| Comando | Azione |
|---------|--------|
| Testo + INVIO | Invia messaggio |
| `/quit` o `/q` | Disconnetti |
| `Ctrl+C` | Esci |
