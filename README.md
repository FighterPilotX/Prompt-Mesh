# PromptMesh

> The AI pipeline platform — four products, one codebase.

## Products

| File | Product | Description |
|------|---------|-------------|
| `promptmesh-hub.html` | **Hub** | Landing page — links all four products |
| `promptmesh-studio.html` | **Studio** | One prompt → full product via 5-stage AI pipeline |
| `promptmesh-enterprise.html` | **Enterprise** | Intelligent agent routing for companies |
| `promptmesh-dev.html` | **Dev Arena** | Build bots, compete head-to-head, ELO leaderboard |
| `promptmesh-sysai.html` | **SysAI** | AI-powered PC optimizer — temps, drivers, PowerShell fixes |

## Running locally

Download all five `.html` files into the same folder, then open `promptmesh-hub.html` in your browser.

For real-time PC monitoring (temps, drivers, disk health), also run the local agent:
```
pip install psutil wmi requests flask flask-cors
python agent/promptmesh_agent.py
```

## Deploy to Netlify

This repo is configured for automatic Netlify deploys.  
Every push to `main` triggers a new deploy.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

## Stack

- Vanilla HTML, CSS, JavaScript — zero dependencies, zero build step
- Anthropic API (Claude Haiku) — bring your own key (BYOK)
- All API keys stored in `sessionStorage` only — never persisted

## Cost

~$0.004 per Studio pipeline run using Claude Haiku.  
~95% cheaper than running the same pipeline on GPT-4.
