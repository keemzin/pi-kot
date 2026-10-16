# Container environment context

You are running inside a containerized Linux environment (`pi-kot` Docker container).

## Network & Dev Servers (CRITICAL)
- **Host accessibility**: To make web apps or dev servers accessible to the user in their host machine's browser, you MUST bind the server to `0.0.0.0` (all network interfaces), NOT `127.0.0.1` or `localhost`.
  - Vite: `npm run dev -- --host 0.0.0.0`
  - Next.js: `npm run dev -- -H 0.0.0.0`
  - Python / Uvicorn: `uvicorn main:app --host 0.0.0.0 --port 8000`
  - Flask: `flask run --host=0.0.0.0 --port=5000`
- **Port usage**: Port `3000` is reserved for the pi-kot web UI server. Do NOT use port 3000 for user projects. Use standard forwarded dev ports such as `5173` (Vite), `3001` (Node/Next), `8000` (FastAPI), `8080` (HTTP), or `5000` (Flask).
- **Background services**: Always launch long-running servers and background watchers with the `process` tool (`action: "start"`) so the user can see live logs and stop them from the web UI.

## Installed Tools & MCP
- **Python 3.12**: Pre-installed with `pip`, `venv`.
- **Node.js 22**: Pre-installed with `npm`, `npx`.
- **Browser Automation & MCP**: Playwright Chromium and `hound-mcp` (Master-Fetch: fast web fetching, crawling, search, PDF, OCR) are pre-installed in this container environment.

## User & Permissions
- **User identity**: You run as non-root user `pi`.
- **Sudo access**: You have passwordless `sudo` available. If you need to install system packages or execute administrative tasks, prefix the command with `sudo` (e.g. `sudo apt-get update && sudo apt-get install -y <pkg>`).
- **Writable locations**: `/workspace`, `/opt`, and `/home/pi/.local/` are fully writable by user `pi`. For user CLI tools or Python packages, use `pip install --user <pkg>` (`~/.local/bin` is already in `$PATH`).

## Filesystem & Persistence (CRITICAL)
- **Host mounted workspace**: ONLY `/workspace` is mounted directly from the user's host machine (`$(pwd)/workspace`).
- **Where to create projects**: ALWAYS create projects, cloned repositories, and code files inside `/workspace/` (e.g. `/workspace/my-app/`).
- **Never create projects in `/home/pi/`**: The home directory `/home/pi/` is container-internal storage. Any files or folders created in `~` (outside `.pi` and `.pi-kot`) will NOT be visible on the host machine and will be lost if the container is recreated.
