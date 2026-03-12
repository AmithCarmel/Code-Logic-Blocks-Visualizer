# Logic Blocks — Local Web App

AI-powered code logic visualizer. Paste any code → get an interactive flowchart.
Runs locally on your machine. Uses "Groq AI" (completely free, no credit card).

## Quick view of the app before building:
### 1. https://amithcarmel.github.io/Code-Logic-Blocks-Visualizer/
### 2. Add your gsk_api_key
### 3. Add the code
### 4. Click Vizualize
   
<img width="1918" height="862" alt="image" src="https://github.com/user-attachments/assets/427f6f13-c8f1-4832-b84b-41a688e31b4e" />

## Quick Start

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Get your FREE Groq API key
1. Go to https://console.groq.com
2. Sign up (free, no credit card)
3. Click "API Keys" → "Create API Key"
4. Copy the key (starts with "gsk_...")

### 3. Set up the project
```bash
# Install dependencies
npm install

# Create your .env file
copy .env.example .env        # Windows
# cp .env.example .env        # Mac/Linux

# Open .env and paste your Groq key:
# GROQ_API_KEY=gsk_your_key_here
```

### 4. Run it
```bash
npm start
```

Open http://localhost:3000 in your browser. Done! 

---

##  Dev mode (auto-restarts on file changes)
```bash
npm run dev
```

---

## Project Structure
```
logic-blocks-app/
├── server.js          ← Express server + Groq API call
├── public/
│   └── index.html     ← Full frontend (HTML + CSS + JS)
├── .env               ← Your API key (never commit this!)
├── .env.example       ← Template
├── .gitignore
└── package.json
```

---

## How it works
1. You paste code into the editor
2. Frontend sends it to `POST /api/analyze` on the local server
3. Server calls Groq (Llama 3.3 70B) with a prompt to return JSON flowchart data
4. Frontend renders the flowchart as an interactive SVG

---

## Customization ideas
- **Change AI model**: Edit `model` in `server.js` — try `"mixtral-8x7b-32768"` for longer code
- **Add syntax highlighting**: Drop in CodeMirror or Monaco editor
- **Export to PNG**: Add html2canvas
- **Support file upload**: Add multer for drag-and-drop .py/.js files

---

## Groq Free Tier Limits
- 30 requests/minute
- 14,400 requests/day
- More than enough for personal use!
