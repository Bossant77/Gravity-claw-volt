---
description: Push code to GitHub and deploy Gravity Claw to the Hetzner VPS
---

# Deploy Gravity Claw

// turbo-all

## 1. Check for uncommitted changes
```
git status --short
```
If there are no changes, skip to step 4.

## 2. Stage all changes
```
git add -A
```

## 3. Commit with a descriptive message
```
git commit -m "<describe the changes>"
```
Use a conventional commit message (fix:, feat:, refactor:, etc.)

## 4. Push to GitHub
```
git push origin main
```

## 5. SSH into VPS and deploy
```
ssh molt_user@91.99.225.220 "cd ~/gravity-claw; git pull origin main; docker compose up -d --build"
```
This will:
- Pull latest code from GitHub
- Rebuild the Docker image with the new code
- Restart the container with zero downtime (detached mode)

## 6. Verify deployment
```
ssh molt_user@91.99.225.220 "docker compose -f ~/gravity-claw/docker-compose.yml logs --tail=20"
```
Check the last 20 log lines to confirm the bot started successfully. Look for:
- "✅ Database initialized successfully"
- "Bot is running"
- No crash errors

## Troubleshooting
- If `docker compose` fails, try: `sudo docker compose up -d --build`
- If SSH fails, check that the key is loaded: `ssh-add -l`
- If the build fails, check TypeScript errors locally first: `npx tsc --noEmit`
