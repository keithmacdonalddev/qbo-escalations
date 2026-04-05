---
name: api-test
description: Test an API endpoint against the running server. Use when verifying API behavior.
argument-hint: "[method] [path] [options]"
allowed-tools: Bash, Read
---

# API Test

Test the server API. The server runs on localhost (check .env for port, typically :3000 or :4000).

If no arguments provided, run a basic health check:
```bash
curl -s http://localhost:3000/api/health 2>/dev/null | jq . || echo "Server not running"
```

If arguments are provided ($ARGUMENTS), construct the appropriate curl command.

Always:
- Show the full response with status code
- For authenticated routes, note that a session cookie is needed
- Format JSON output with jq when available
