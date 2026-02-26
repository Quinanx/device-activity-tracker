# Deployment Guide - Device Activity Tracker

## One-Click Deploy to Railway

Railway is the easiest option for deploying this app. Here's how:

### Prerequisites
- GitHub account with your repository
- Railway account (free at https://railway.app)

### Steps to Deploy

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Prepare for deployment"
   git push
   ```

2. **Deploy to Railway**
   - Go to https://railway.app
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect it's a Node.js app
   - Click "Deploy"

3. **Configure Environment Variables**
   Railway's dashboard → Your Project → Variables:
   ```
   SIGNAL_API_URL=http://localhost:8080
   PORT=3000
   ```

   **Note:** The `SIGNAL_API_URL` should point to a Signal API instance. You have options:
   - Keep a local Signal container running and use a tunnel (ngrok)
   - Deploy signal-cli-rest-api separately
   - Disable Signal features and use WhatsApp only

4. **Domain Setup**
   Railway will automatically assign you a `.railway.app` domain
   Example: `https://device-activity-tracker-production.railway.app`

### For Signal Integration in Production

Option A: Using ngrok tunnel (recommended for testing)
```bash
# On your machine with signal-cli container running:
ngrok http 8080
# Use the ngrok URL in SIGNAL_API_URL environment variable
```

Option B: Deploy signal-cli-rest-api separately
- Deploy another service on Railway that runs signal-cli-rest-api
- Use its Railway internal URL

### Troubleshooting

- **WhatsApp auth fails on deployment**: Auth state is stored locally. On first run, scan QR code via the web UI
- **Port issues**: Railway manages port automatically via `PORT` environment variable
- **Build fails**: Check that client dependencies are installed (postinstall handles this)

### Accessing Your Live App

Once deployed:
1. Go to Railway dashboard → Your Project
2. Click the URL under "Deployments"
3. Use your public domain to access from anywhere

### Auto-Deploy on Git Push

Railway automatically redeploys when you push to your repository's main branch!

