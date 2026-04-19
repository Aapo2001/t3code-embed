$env:HOST = "127.0.0.1"
$env:PORT = "5733"
$env:VITE_HTTP_URL = "http://127.0.0.1:3773"
$env:VITE_WS_URL = "ws://127.0.0.1:3773"

bun run dev:web
