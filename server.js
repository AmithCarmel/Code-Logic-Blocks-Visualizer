require("dotenv").config();
const express = require("express");
const Groq    = require("groq-sdk");
const cors    = require("cors");
const path    = require("path");

const app  = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const CHAR_LIMIT_MAX = 80000;

/* ═══════════════════════════════════════════════════════════
   PASS 1 — STRUCTURAL ANALYSIS
   Understanding the code BEFORE trying to draw anything.
   Separates definitions from runtime execution.
═══════════════════════════════════════════════════════════ */
const PASS1_SYSTEM = `You are an expert code analyst. Your job is to deeply understand code structure.

Analyze the given code and output a JSON object with this EXACT shape:
{
  "language": "Python|JavaScript|Go|etc",
  "title": "short descriptive title",
  "entryPoint": "describe where execution actually starts (e.g. 'if __name__ == main block', 'top-level script', 'main() function')",
  "definitions": [
    {
      "name": "function or class name",
      "kind": "function|class|method",
      "purpose": "one sentence what it does",
      "params": ["param1", "param2"],
      "returns": "what it returns or empty string",
      "internalLogic": ["key step 1", "key step 2", "key loop/condition description"]
    }
  ],
  "executionFlow": [
    {
      "step": 1,
      "action": "exact description of what happens",
      "kind": "setup|call|condition|loop|assignment|io|error_handling",
      "detail": "variable names, condition text, loop range — be specific",
      "calls": ["function names called here"],
      "loopBody": ["step descriptions inside loop if this is a loop"],
      "branches": {
        "yes": "what happens if true",
        "no": "what happens if false"
      }
    }
  ]
}

CRITICAL RULES:
1. "definitions" = code that DEFINES things (def, class, function declarations). Do NOT include these in executionFlow.
2. "executionFlow" = ONLY what actually RUNS at runtime, in the correct ORDER.
3. For Python: executionFlow = what runs inside "if __name__ == '__main__'" or at module top-level (excluding defs).
4. For loops: include loopBody array with what happens INSIDE the loop each iteration.
5. For conditions: include branches.yes and branches.no.
6. Be SPECIFIC: use real variable names, real condition text, real function names from the code.
7. Return ONLY the raw JSON object.`;

/* ═══════════════════════════════════════════════════════════
   PASS 2 — EXECUTION TRACE
   Converting the structural analysis into a precise step-by-step
   trace that maps 1:1 to what happens at runtime.
═══════════════════════════════════════════════════════════ */
const PASS2_SYSTEM = `You are a runtime execution tracer. Given a structural analysis of code, produce a precise numbered execution trace.

Output a JSON array of trace steps:
[
  {
    "id": "t1",
    "description": "exact action taken",
    "type": "start|end|setup|call|condition|loop_start|loop_body|loop_end|assignment|io|error_handling|return",
    "conditionText": "exact condition string if type is condition",
    "loopText": "exact loop expression if type is loop_start",
    "children": ["t2", "t3"],
    "yes_child": "id of next step if condition is true",
    "no_child": "id of next step if condition is false",
    "loop_back_to": "id of loop_start node to loop back to",
    "after_loop": "id of first step after loop ends"
  }
]

RULES:
1. Start with {id:"t1", type:"start", description:"Start"}
2. End with {id:"tN", type:"end", description:"End"}
3. Definitions (def/class declarations) are NEVER trace steps — only their CALLS are.
4. When a function is CALLED, create a "call" step with the function name + args.
5. Loops: create loop_start → loop_body steps → loop_end, with loop_back_to pointing to loop_start id.
6. Conditions: create condition step, then yes_child and no_child branches that merge back.
7. Keep descriptions short (≤28 chars) but specific — use real names from the code.
8. Return ONLY the raw JSON array.`;

/* ═══════════════════════════════════════════════════════════
   PASS 3 — FLOWCHART LAYOUT
   Converting the execution trace into positioned SVG nodes+edges.
═══════════════════════════════════════════════════════════ */
const PASS3_SYSTEM = `You are a flowchart layout engine. Convert an execution trace into a positioned flowchart JSON.

Output this EXACT shape:
{
  "title": "short title",
  "language": "language",
  "nodes": [{"id":"n1","type":"start","label":"Start","x":400,"y":50}],
  "edges":  [{"from":"n1","to":"n2","label":""}]
}

NODE TYPES (use exactly):
  start | end | process | condition | loop | function | return | input

LAYOUT RULES — follow PRECISELY:
- Canvas: x 100–700, y 50–2200
- Main vertical flow: x=400, spacing 120px between nodes
- Condition node: x=400
  → YES branch: x=230, at y+120
  → NO branch:  x=570, at y+120
  → Both branches merge back to x=400 at y+(120 * branch_depth + 120)
- Loop node: x=400
  → Loop body nodes: x=400, each 110px lower
  → Loop back edge: curves from last body node back to loop node (label "loop back")
  → After loop: x=400, continues down
- function call nodes: use type "function"
- setup/assignment nodes: use type "process"
- io (print/read): use type "input"
- Never overlap nodes — ensure y increases monotonically on the main path
- Labels ≤ 26 chars

EDGES:
- "yes" / "no" for condition branches
- "loop back" for loop-back edges
- "" for all other edges

Return ONLY the raw JSON object.`;

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */
function extractJSON(raw, expectArray = false) {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  if (expectArray) {
    const start = s.indexOf("[");
    const end   = s.lastIndexOf("]");
    if (start === -1 || end === -1) throw new Error("No JSON array found in response");
    return s.slice(start, end + 1);
  }
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return s.slice(start, end + 1);
}

function validateGraph(parsed) {
  if (!parsed?.nodes?.length) throw new Error("Model returned no nodes");
  if (!Array.isArray(parsed.edges)) parsed.edges = [];

  parsed.nodes = parsed.nodes.map((n, i) => ({
    id:    String(n.id   || `n${i}`),
    type:  String(n.type || "process"),
    label: String(n.label || "—").slice(0, 30),
    x:     Math.max(80,  Math.min(720, Number(n.x) || 400)),
    y:     Math.max(40,  Math.min(2200, Number(n.y) || 50 + i * 120)),
  }));

  // Remove duplicate nodes by id
  const seen = new Set();
  parsed.nodes = parsed.nodes.filter(n => {
    if (seen.has(n.id)) return false;
    seen.add(n.id); return true;
  });

  const nodeIds = new Set(parsed.nodes.map(n => n.id));
  parsed.edges = parsed.edges
    .filter(e => e.from && e.to && nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)))
    .map(e => ({ from: String(e.from), to: String(e.to), label: e.label || "" }));

  // Remove duplicate edges
  const edgeSeen = new Set();
  parsed.edges = parsed.edges.filter(e => {
    const key = `${e.from}→${e.to}`;
    if (edgeSeen.has(key)) return false;
    edgeSeen.add(key); return true;
  });

  return parsed;
}

async function callGroq(messages, maxTokens = 2000, attempt = 1) {
  try {
    const completion = await groq.chat.completions.create({
      model:       "llama-3.3-70b-versatile",
      temperature: 0.05,   // very low — we want deterministic structured output
      max_tokens:  maxTokens,
      messages,
    });
    return completion.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    if (err.status === 429 && attempt === 1) {
      console.log("  ⏳ Rate limited — retrying in 15s…");
      await new Promise(r => setTimeout(r, 15000));
      return callGroq(messages, maxTokens, 2);
    }
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════
   HEALTH CHECK
═══════════════════════════════════════════════════════════ */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", keySet: !!process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile", passes: 3 });
});

/* ═══════════════════════════════════════════════════════════
   MAIN ANALYZE ENDPOINT — 3-Pass Pipeline
═══════════════════════════════════════════════════════════ */
app.post("/api/analyze", async (req, res) => {
  const { code } = req.body;

  if (!code?.trim())             return res.status(400).json({ error: "No code provided" });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set in .env file" });
  if (code.length > CHAR_LIMIT_MAX) return res.status(400).json({
    error: `File too large (${Math.round(code.length/1000)}KB). Max ~2000 lines — paste one class or module at a time.`
  });

  const lines = code.split("\n").length;
  console.log(`\n📥 Analyzing ${lines} lines (${code.length} chars)`);

  // For very large files, trim to keep within Groq context limits
  const codeForAnalysis = code.length > 20000 ? code.slice(0, 20000) + "\n# ... (truncated)" : code;

  try {
    /* ── PASS 1: Structural Analysis ── */
    console.log("  🔍 Pass 1: Structural analysis…");
    const pass1Raw = await callGroq([
      { role: "system", content: PASS1_SYSTEM },
      { role: "user",   content: `Analyze this code:\n\n${codeForAnalysis}` }
    ], 2000);

    let structure;
    try {
      structure = JSON.parse(extractJSON(pass1Raw));
    } catch {
      throw new Error("Pass 1 failed to return valid JSON — model may be overloaded, try again");
    }
    console.log(`     → Found ${structure.definitions?.length || 0} definitions, entry: ${structure.entryPoint}`);

    /* ── PASS 2: Execution Trace ── */
    console.log("  🗺  Pass 2: Building execution trace…");
    const pass2Raw = await callGroq([
      { role: "system", content: PASS2_SYSTEM },
      { role: "user",   content: `
Build a runtime execution trace from this structural analysis.

STRUCTURE:
${JSON.stringify(structure, null, 2)}

ORIGINAL CODE (for reference):
${codeForAnalysis.slice(0, 6000)}
` }
    ], 2500);

    let trace;
    try {
      trace = JSON.parse(extractJSON(pass2Raw, true));
    } catch {
      throw new Error("Pass 2 failed to return valid JSON — try again");
    }
    console.log(`     → Trace has ${trace.length} steps`);

    /* ── PASS 3: Flowchart Layout ── */
    console.log("  🎨 Pass 3: Generating flowchart layout…");
    const pass3Raw = await callGroq([
      { role: "system", content: PASS3_SYSTEM },
      { role: "user",   content: `
Convert this execution trace into a positioned flowchart.

LANGUAGE: ${structure.language}
TITLE: ${structure.title}

EXECUTION TRACE:
${JSON.stringify(trace, null, 2)}
` }
    ], 3000);

    let graph;
    try {
      graph = JSON.parse(extractJSON(pass3Raw));
    } catch {
      throw new Error("Pass 3 failed to return valid JSON — try again");
    }

    graph = validateGraph(graph);
    console.log(`   Done: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    res.json(graph);

  } catch (err) {
    console.error("   Error:", err.message);
    if (err.status === 401) return res.status(401).json({ error: "Invalid GROQ_API_KEY — check your .env file" });
    if (err.status === 429) return res.status(429).json({ error: "Groq rate limit — wait 30 seconds and try again" });
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
});

/* ── Start ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n Logic Blocks running at http://localhost:${PORT}`);
  console.log(`   API key : ${process.env.GROQ_API_KEY ? " set" : " missing"}`);
  console.log(`   Mode    : 3-pass pipeline (structural → trace → layout)\n`);
});
