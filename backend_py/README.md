Python backend for the workspace API.

Run locally:

```powershell
py -m pip install -r requirements.txt
$env:AGNES_API_KEY="your-key"
$env:WORKSPACE_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/workbench"
py scripts/start-workspace-api.py
```

Default port: `8787`

The backend now prefers PostgreSQL via `WORKSPACE_DATABASE_URL`.
If `WORKSPACE_DATABASE_URL` is unset, it falls back to local `workspace.sqlite3`.
