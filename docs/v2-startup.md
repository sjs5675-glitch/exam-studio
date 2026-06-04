# V2 Startup

V2 is a local-only prototype copied from the current app.

## Ports

- UI: `http://localhost:3030`
- Job/SSE server: `http://localhost:3031`

These ports are intentionally different from the current app:

- Current app UI: `3020`
- Current app Job/SSE: `3021`

## First Setup

From `D:\OneDrive\학원 자료 모음\exam-studio-v2\studio`:

```powershell
pnpm install
```

Python dependencies can be installed later when V2 needs PDF rendering, image processing, or HWPX building.

## Run

Terminal 1:

```powershell
cd "D:\OneDrive\학원 자료 모음\exam-studio-v2\studio"
pnpm dev:sse
```

Terminal 2:

```powershell
cd "D:\OneDrive\학원 자료 모음\exam-studio-v2\studio"
pnpm dev
```

Open:

```text
http://localhost:3030/create
```

## GitHub Rule

Do not push this folder or its V2 work to GitHub. Treat it as a local prototype until the workflow is proven.

