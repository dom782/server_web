from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse

app = FastAPI()

private_client = None
web_clients = []

@app.websocket("/ws/private")
async def private_ws(ws: WebSocket):

    global private_client

    await ws.accept()
    private_client = ws

    print("PC privato connesso")

    try:
        while True:
            data = await ws.receive_text()

            for c in web_clients:
                await c.send_text("PC: " + data)

    except:
        print("PC privato disconnesso")
        private_client = None


@app.websocket("/ws/web")
async def web_ws(ws: WebSocket):

    await ws.accept()
    web_clients.append(ws)

    try:
        while True:

            msg = await ws.receive_text()

            if private_client:
                await private_client.send_text(msg)

    except:
        web_clients.remove(ws)


@app.get("/")
async def home():
    with open("static/index.html") as f:
        return HTMLResponse(f.read())