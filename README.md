# Sparrow Technical Interview Preparation

> **Project:** WordSphere — 3D Article Visualiser  
> **Interview Date:** Upcoming  
> **Interviewers:**  
> - **Dave Luke Jr** — Lead Full Stack Engineer (React/TS, FastAPI, code quality)  
> - **Todd Eaglin** — Co-Founder & Chief AI Officer, PhD in Computer Vision/ML  
> **Company:** Sparrow (sparrowup.com) — AI Sports Coaching Startup

---

## Table of Contents

1. [Code Review](#1-code-review)
2. [Architecture Analysis](#2-architecture-analysis)
3. [Interview Questions & Answers](#3-interview-questions--answers)
4. [Extension Scenarios](#4-extension-scenarios)
5. [Sparrow-Specific System Design](#5-sparrow-specific-system-design)
6. [Quick Reference Sheet](#6-quick-reference-sheet)

---

## 1. Code Review

This section goes through every file in the project and identifies issues, improvements, and things you should be ready to discuss.

### 1.1 Backend — `backend/main.py` (42 lines)

**What it does:** Sets up the FastAPI app with CORS middleware, defines a Pydantic request model, and exposes two endpoints — `GET /health` and `POST /analyze`.

**What's Good:**
- Clean and minimal — the file does exactly what it needs to and nothing more
- Proper use of Pydantic `BaseModel` for request validation
- Good separation of concerns — business logic is in `services/`, not here
- Error handling converts `CrawlError` into appropriate HTTP responses

**Issues to Discuss:**

| Issue | Line(s) | Severity | Explanation |
|-------|---------|----------|-------------|
| **CORS hardcoded to localhost** | 12 | Medium | `allow_origins=["http://localhost:5173"]` works for development but breaks in production. Should use environment variables: `os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")` |
| **No URL validation on input** | 18-19 | High | The `AnalyzeRequest` model accepts any string as `url`. A user could pass `file:///etc/passwd` or an internal network URL like `http://169.254.169.254/latest/meta-data/` (AWS metadata endpoint). This is a **Server-Side Request Forgery (SSRF)** vulnerability. Fix: use Pydantic's `HttpUrl` type or add a custom validator. |
| **Synchronous endpoint** | 28 | Medium | `def analyze()` is synchronous, which means it blocks the event loop during the HTTP request to the target URL (up to 15 seconds). FastAPI runs sync functions in a threadpool, which is okay for low traffic but won't scale. Should be `async def analyze()` with `httpx.AsyncClient` instead of `requests`. |
| **No response model** | 28 | Low | The endpoint doesn't declare a `response_model`, so the OpenAPI docs won't show the response schema. Adding `response_model=AnalyzeResponse` would make the API self-documenting. |
| **top_n is hardcoded** | 37 | Low | `top_n=60` is baked in. Could be a query parameter with a sensible default to give the frontend flexibility. |

**How you'd explain this in an interview:**

> "I kept main.py deliberately thin — it's just the routing layer. Business logic lives in the services module so it can be tested independently. If I were hardening this for production, I'd add Pydantic URL validation, make the endpoint async, move CORS origins to environment config, and add a response model for API documentation."

---

### 1.2 Backend — `backend/services/crawler.py` (66 lines)

**What it does:** Fetches a webpage via HTTP, strips noise HTML tags (scripts, nav, footer, etc.), then extracts the article body text using a priority-based selector strategy.

**What's Good:**
- Smart multi-selector fallback strategy — tries `itemprop='articleBody'`, then `<article>`, then class names, then `<main>`, then `<p>` tags, then full body
- Proper noise tag removal before parsing (removes 10 tag types that add junk text)
- Custom `CrawlError` exception class — clean error hierarchy
- Sets `response.encoding = response.apparent_encoding` to handle non-UTF-8 pages correctly
- Realistic browser User-Agent header to avoid bot-blocking

**Issues to Discuss:**

| Issue | Line(s) | Severity | Explanation |
|-------|---------|----------|-------------|
| **SSRF vulnerability** | 27 | High | No URL scheme validation. Could fetch `file://`, `ftp://`, or internal network addresses. Should restrict to `http://` and `https://` only, and optionally block private IP ranges. |
| **No response size limit** | 27 | Medium | A malicious or huge page (100MB+) would eat server memory. Add `stream=True` and check `Content-Length` header, or read in chunks with a cap. |
| **Follows redirects blindly** | 27 | Medium | `allow_redirects=True` means a URL could redirect to an internal service. Should limit redirect count or validate each redirect target. |
| **Synchronous HTTP** | 27 | Medium | Uses `requests.get()` which blocks the thread. For async FastAPI, should use `httpx.AsyncClient`. |
| **No caching** | — | Medium | Same URL fetched repeatedly makes the same HTTP request every time. Could add an in-memory LRU cache or Redis. |

**The selector strategy is interview-gold — be ready to walk through it:**

```
Priority 1: [itemprop='articleBody']  ← Schema.org structured data (most reliable)
Priority 2: <article>                 ← HTML5 semantic element
Priority 3: .article-content          ← Common CMS class names
Priority 4: .post-content             ← WordPress-style class names
Priority 5: <main> / [role='main']    ← HTML5 landmark
Fallback A: all <p> tags              ← Brute-force paragraph collection
Fallback B: <body> text               ← Last resort — gets everything
```

This is a **graceful degradation pattern**. You chose reliability over perfection — if structured data exists, you use it; otherwise, you fall back to increasingly generic strategies. This is a great design decision to articulate in an interview.

---

### 1.3 Backend — `backend/services/keyword_extractor.py` (81 lines)

**What it does:** Takes raw article text, splits it into sentences, runs TF-IDF vectorization treating each sentence as a separate "document," sums the scores per term, normalizes to [0,1], and filters out noise words.

**What's Good:**
- Clever use of sentence-level TF-IDF — treating each sentence as a document gives meaningful IDF variance (a word that appears in every sentence gets penalized, mimicking "document frequency" behavior within a single article)
- Combined stopwords from two sources (scikit-learn + NLTK) for better coverage
- Post-TF-IDF blocklist catches domain-specific noise (Wikipedia artifacts like "isbn", month names)
- Clean return format — normalized weights make frontend rendering simple
- Good docstring explaining the algorithm rationale

**Issues to Discuss:**

| Issue | Line(s) | Severity | Explanation |
|-------|---------|----------|-------------|
| **Bare `except Exception: pass`** | 15-16 | Medium | The SSL/NLTK download block catches ALL exceptions silently. If NLTK stopwords aren't available and the download fails, the next line (`from nltk.corpus import stopwords`) will crash with an unhelpful error. Should at minimum log the exception. |
| **Module-level side effect** | 9-16 | Medium | Downloading NLTK data at import time is surprising. If this module is imported in tests, it tries to hit the network. Better to do this in a setup script (which you already have in `setup.sh`) or use a lazy-loading pattern. |
| **Unigrams only** | 47 | Low | `ngram_range=(1,1)` means "machine learning" becomes two separate words. For this project it's fine, but bigrams would capture compound terms. Worth mentioning as a future improvement. |
| **Redundant length filter** | 49, 77 | Low | `token_pattern=r"[a-zA-Z]{3,}"` already requires 3+ characters, but line 77 filters `len(term) >= 4`. The 4-char filter is stricter and intentional (removes "the", "and" that survive), but worth noting the slight overlap. |
| **Blocklist maintenance** | 67-72 | Low | Hardcoded blocklist won't adapt to non-Wikipedia content. Could externalize to a config file. |

**The key algorithmic insight to articulate:**

> "Traditional TF-IDF needs a corpus of multiple documents to compute IDF. Since I only have one article, I split it into sentences and treat each sentence as a mini-document. This lets IDF work naturally — a word appearing in every sentence gets a low IDF (it's 'common'), while a word appearing in just a few sentences gets a high IDF (it's 'distinctive'). It's a pragmatic adaptation of a well-understood algorithm to a single-document scenario."

---

### 1.4 Frontend — `frontend/src/App.tsx` (45 lines)

**What it does:** Root component that orchestrates the layout — header, URL input form, loading state, 3D cloud with sidebar, and empty state.

**What's Good:**
- Clean conditional rendering — loading overlay, content, and empty state are mutually exclusive
- Semantic HTML (`<header>`, `<section>`, `<main>`, `<aside>`)
- State management lifted into a custom hook (`useAnalyze`) — keeps this component focused on layout

**Issues to Discuss:**

| Issue | Severity | Explanation |
|-------|----------|-------------|
| **No Error Boundary** | High | If `WordCloud3D` throws (e.g., WebGL not supported), the entire app crashes with a white screen. Should wrap the 3D canvas in a React Error Boundary that shows a fallback message. |
| **No loading state for re-analysis** | Low | Line 20: `loading && keywords.length === 0` — the spinner only shows on the *first* load. On re-analysis, the old cloud stays visible with no loading indicator. Could add a subtle overlay or opacity change. |

---

### 1.5 Frontend — `frontend/src/components/WordCloud3D.tsx` (107 lines)

**What it does:** The core 3D visualization. Generates evenly-distributed points on a sphere using the Fibonacci golden-angle spiral, maps keyword weights to visual properties (color, size, boldness), and renders the Three.js scene.

**What's Good:**
- Fibonacci sphere algorithm is elegant and O(n) — produces visually even distribution
- Three mapping functions (weight→color, weight→size, weight→fontWeight) create clear visual hierarchy
- `OrbitControls` with damping gives a polished feel
- Zoom limits prevent users from clipping inside the sphere or losing it in the distance

**Issues to Discuss:**

| Issue | Line(s) | Severity | Explanation |
|-------|---------|----------|-------------|
| **No memoization of positions** | 67 | High | `fibonacciSphere(keywords.length)` runs on every render, including every frame during camera rotation. Should be: `const positions = useMemo(() => fibonacciSphere(keywords.length), [keywords.length])` |
| **Scene re-renders on every camera move** | 66-93 | Medium | The `Scene` component re-renders because it's inside the Canvas context. Each re-render recalculates positions and re-creates all JSX elements. `useMemo` for positions + `React.memo` on `WordLabel` would fix this. |
| **Inconsistent indentation** | 45-51 | Low | `weightToSize` has misaligned if-statements — looks like a copy-paste artifact. Not a bug, but hurts readability. |
| **Magic numbers everywhere** | 8, 44-60 | Low | Radius `4`, font sizes `0.14-0.55`, weight thresholds — these could be extracted to named constants for clarity. |
| **Only ambient light** | 71 | Low | A single ambient light with intensity 1 means there's no depth perception from lighting. Adding a directional light would give words subtle shadows and more visual depth. Not required, but a nice touch. |

**The Fibonacci sphere — be ready to explain this clearly:**

> "I needed to distribute N points evenly on a sphere surface. The Fibonacci spiral (or golden-angle method) does this by placing points at incremental heights from pole to pole, rotating each by the golden angle (approximately 137.5 degrees). This avoids clustering at the poles that you'd get with a simple latitude/longitude grid. It's the same pattern sunflower seeds use — it's mathematically proven to give near-optimal spacing in O(n) time."

**Why not random placement?**

> "Random placement would create visual clumps and gaps. The Fibonacci method is deterministic (same input always gives the same layout), evenly distributed, and fast. For a word cloud, even spacing is critical because overlapping words become unreadable."

---

### 1.6 Frontend — `frontend/src/components/WordLabel.tsx` (57 lines)

**What it does:** Renders a single word in 3D space using a Billboard (always faces camera), with hover interaction that scales the word up and shows a tooltip.

**What's Good:**
- `Billboard` from drei ensures text is always readable regardless of rotation
- `useCallback` on pointer handlers prevents unnecessary re-renders
- Hover effect (2x scale + white color + tooltip) gives clear feedback
- Outline on text (`outlineWidth`) ensures readability against any background

**Issues to Discuss:**

| Issue | Line(s) | Severity | Explanation |
|-------|---------|----------|-------------|
| **Missing `React.memo`** | 14 | High | This component re-renders whenever *any* keyword changes because the parent re-renders. With 60 words, that's 60 unnecessary re-renders per frame during interaction. Wrap with `React.memo` — props are simple and stable. |
| **Non-null assertion on ref** | 15 | Medium | `useRef<Mesh>(null!)` — the `!` tells TypeScript "trust me, this is never null." It works here because Three.js always assigns the ref, but it's a type-safety escape hatch. Better: `useRef<Mesh>(null)` and handle the null case, or just remove the ref since it's never read. |
| **`meshRef` is unused** | 15 | Low | The ref is assigned to the `<Text>` element but never actually read anywhere. It should be removed to avoid confusion (tsconfig has `noUnusedLocals: true`, but refs assigned via JSX don't trigger that warning). |
| **Global cursor mutation** | 20, 25 | Medium | `document.body.style.cursor = 'pointer'` is a side effect that modifies global state from within a component. If two WordLabels overlap, the cursor can flicker. Better: use CSS `:hover` or R3F's built-in cursor handling. |

---

### 1.7 Frontend — `frontend/src/hooks/useAnalyze.ts` (38 lines)

**What it does:** Custom hook that manages the analyze API call lifecycle — loading state, error state, keywords state.

**What's Good:**
- Clean separation of API logic from component logic
- Proper TypeScript interface for the hook's return type
- `finally` block ensures `loading` is always reset, even on error
- Axios error type-narrowing with `axios.isAxiosError()`

**Issues to Discuss:**

| Issue | Line(s) | Severity | Explanation |
|-------|---------|----------|-------------|
| **No request cancellation** | 24 | High | If a user submits a new URL while the previous request is still pending, both responses will race. The stale response could overwrite the fresh one. Fix: use `AbortController` or axios cancel tokens. |
| **No timeout** | 24 | Medium | Axios has no default timeout. If the backend hangs, the frontend spinner spins forever. Add `{ timeout: 30000 }` to the axios config. |
| **`analyze` not wrapped in `useCallback`** | 17 | Medium | The `analyze` function is recreated on every render. Since it's passed as a prop to `UrlInput`, this causes `UrlInput` to re-render unnecessarily. Should wrap in `useCallback`. |
| **Clears keywords before loading** | 20 | Low | `setKeywords([])` on line 20 clears the old cloud immediately. This could be a UX choice (show loading) or a missed opportunity (keep showing old cloud with a loading overlay). Worth discussing as a design decision. |

**How to fix request cancellation (good talking point):**

```typescript
const controllerRef = useRef<AbortController | null>(null)

async function analyze(url: string) {
  controllerRef.current?.abort()              // Cancel any in-flight request
  const controller = new AbortController()
  controllerRef.current = controller
  
  setLoading(true)
  setError(null)
  try {
    const response = await axios.post('/analyze', { url }, { 
      signal: controller.signal,
      timeout: 30000 
    })
    setKeywords(response.data.keywords)
  } catch (err) {
    if (axios.isCancel(err)) return           // Ignore cancelled requests
    // ... normal error handling
  } finally {
    setLoading(false)
  }
}
```

---

### 1.8 Frontend — `frontend/src/components/UrlInput.tsx` (59 lines)

**What's Good:**
- Controlled input with clear form handling
- Sample URL pills are a nice UX touch for demos
- Loading state properly disables all inputs

**Issues:**
- Sample pills call both `setUrl(s.url)` and `onSubmit(s.url)` — this works but bypasses the form's `handleSubmit` and its trim logic
- No URL sanitization beyond HTML5's `type="url"` attribute
- Default URL is hardcoded in `useState` — could be passed as a prop

---

### 1.9 Frontend — `frontend/src/components/KeywordList.tsx` (45 lines)

**Issues:**
- `[...keywords].sort(...)` creates a new sorted array on every render — should be wrapped in `useMemo(() => ..., [keywords])`
- Imports `weightToColor` and `weightToFontWeight` from `WordCloud3D` — these utility functions should probably live in a shared `utils.ts` file since they're used by two components

---

### 1.10 Security Summary

| Vulnerability | Where | Risk | Fix |
|--------------|-------|------|-----|
| **SSRF** | `crawler.py:27` + `main.py:19` | High | Validate URL scheme (http/https only), block private IPs |
| **No rate limiting** | `main.py` | High | Add `slowapi` or custom middleware — one IP crawling 1000 URLs could DDoS external sites |
| **No input size limit** | `main.py:19` | Medium | A 10MB URL string could waste memory. Add `max_length` to Pydantic model |
| **CORS in prod** | `main.py:12` | Medium | Use env vars for origin, not hardcoded localhost |
| **No response size limit** | `crawler.py:27` | Medium | Stream response, check Content-Length |
| **Dependency versions unpinned** | `requirements.txt` | Medium | Pin versions: `fastapi==0.109.0` to prevent supply-chain issues |

---

### 1.11 Performance Bottleneck Summary

| Bottleneck | Component | Impact | Fix |
|-----------|-----------|--------|-----|
| **Positions recalculated every render** | `WordCloud3D` | 60 trig operations per frame at 60fps | `useMemo` |
| **All 60 WordLabels re-render on any state change** | `WordLabel` | 60 component re-renders per interaction | `React.memo` |
| **Sort on every render** | `KeywordList` | O(n log n) per frame | `useMemo` |
| **Synchronous HTTP in backend** | `main.py` | Blocks thread for up to 15s per request | `async def` + `httpx` |
| **No caching** | `crawler.py` | Same URL re-fetched every time | LRU cache or Redis |
| **Three.js text is expensive** | `WordLabel` | Each `<Text>` generates geometry and a signed distance field | Consider instancing for 100+ words |

---

## 2. Architecture Analysis

### 2.1 Full Request Flow — From User Input to 3D Rendering

Here is the complete journey of a request, end to end. Read this like a story so you can narrate it naturally in the interview.

```
USER: Pastes a URL and clicks "Analyse"
  │
  ▼
[1] UrlInput.tsx — handleSubmit()
    • Trims the URL, calls onSubmit(url)
    • onSubmit is the `analyze` function from useAnalyze hook
  │
  ▼
[2] useAnalyze.ts — analyze(url)
    • Sets loading=true, clears error & keywords
    • Sends: POST /analyze { "url": "..." }
    • Axios sends to /analyze (Vite proxies to localhost:8000 in dev)
  │
  ▼
[3] main.py — POST /analyze
    • Pydantic validates the request body (checks url is a string)
    • Calls fetch_article_text(url)
  │
  ▼
[4] crawler.py — fetch_article_text(url)
    • Sends GET request with browser-like headers
    • Receives HTML, parses with BeautifulSoup + lxml
    • Strips noise tags (script, style, nav, footer, etc.)
    • Tries article selectors in priority order
    • Falls back to <p> tags or full body
    • Cleans whitespace, returns plain text string
    • If anything fails → raises CrawlError
  │
  ▼
[5] keyword_extractor.py — extract_keywords(text, top_n=60)
    • Splits text into sentences (each = a "document")
    • Builds combined stopword set (sklearn + NLTK)
    • Runs TF-IDF vectorization across all sentences
    • Sums scores per term, normalizes to [0.0, 1.0]
    • Filters: length >= 4, not in blocklist
    • Returns: [{"word": "learning", "weight": 1.0}, ...]
  │
  ▼
[6] main.py — Returns JSON response
    • { "keywords": [...] } with HTTP 200
    • Or HTTP 422 with error detail
  │
  ▼
[7] useAnalyze.ts — Receives response
    • Sets keywords state → triggers re-render
    • Sets loading=false
  │
  ▼
[8] App.tsx — Re-renders with keywords
    • Renders WordCloud3D + KeywordList
  │
  ▼
[9] WordCloud3D.tsx — Scene component
    • Calls fibonacciSphere(60) → generates 60 [x,y,z] positions
    • Maps each keyword to color, size, fontWeight via weight
    • Creates 60 WordLabel components at those positions
  │
  ▼
[10] WordLabel.tsx — Per-word rendering
    • Billboard ensures text faces camera
    • Three.js Text renders the word with outline
    • Hover listeners enable interaction
  │
  ▼
[11] KeywordList.tsx — Sidebar
    • Sorts keywords by weight descending
    • Renders ranked list with progress bars
    • Color coding matches the 3D sphere

USER SEES: Rotating 3D sphere with interactive word cloud + sidebar list
```

**Total latency breakdown for a typical request:**
- Network to target site: 200ms–2s
- HTML parsing + noise removal: 10–50ms
- TF-IDF computation: 5–20ms
- JSON serialization + network return: 5–10ms
- React re-render + Three.js scene creation: 50–100ms
- **Total: ~300ms to 2.5s** (dominated by the external HTTP request)

---

### 2.2 Scaling to 1000 Concurrent Users

If this project needed to handle 1000 concurrent users, here are the bottlenecks and solutions. This is the kind of question Todd would ask to see if you think beyond just "making it work."

**Bottleneck 1: External HTTP Requests (biggest issue)**

Each `/analyze` call makes an outbound HTTP request that blocks for up to 15 seconds. With 1000 users, that's potentially 1000 open connections to external sites.

*Solution:* 
- **Async I/O**: Switch from `requests` (synchronous) to `httpx.AsyncClient` (async). This lets a single server process handle many concurrent requests without blocking.
- **Caching with Redis**: Most users will paste popular URLs (Wikipedia, news sites). Cache the extracted text and keywords with a TTL (e.g., 1 hour). Cache hit rate for popular content could be 60-80%.
- **Connection pooling**: Use `httpx` connection pools to reuse TCP connections.

```python
# Before (blocking)
response = requests.get(url, timeout=15)

# After (async + cached)
@app.post("/analyze")
async def analyze(body: AnalyzeRequest):
    cache_key = f"analyze:{hashlib.sha256(body.url.encode()).hexdigest()}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)
    
    async with httpx.AsyncClient() as client:
        response = await client.get(body.url, timeout=15)
    # ... process and cache result
    await redis.setex(cache_key, 3600, json.dumps(result))
    return result
```

**Bottleneck 2: CPU-Bound TF-IDF Computation**

TF-IDF vectorization is CPU-intensive. With 1000 concurrent requests, the CPU becomes the bottleneck.

*Solution:*
- **Background task queue**: Offload TF-IDF to a Celery or ARQ worker. The API returns a task ID, and the frontend polls or uses WebSocket for the result.
- **Horizontal scaling**: Run multiple FastAPI workers behind a load balancer (Nginx or AWS ALB).
- **Cache computed keywords**: The same article always produces the same keywords.

**Bottleneck 3: Memory Usage**

Each request holds the full HTML response + parsed BeautifulSoup tree + TF-IDF matrix in memory.

*Solution:*
- **Streaming HTML parsing**: Process HTML in chunks instead of loading the full page.
- **Limit response size**: Reject pages larger than 5MB.
- **Worker isolation**: Use Uvicorn with multiple workers (`uvicorn main:app --workers 4`), each with its own memory space.

**Bottleneck 4: Frontend Bundle Size**

Three.js is ~600KB gzipped. For 1000 concurrent users, that's CDN bandwidth.

*Solution:*
- **CDN**: Serve static assets from CloudFront or Vercel's edge network.
- **Code splitting**: Lazy-load the 3D canvas only when keywords are available.
- **Tree shaking**: Vite already does this, but ensure only used Three.js modules are included.

---

### 2.3 Adding Caching (Redis)

Here is how you'd explain adding Redis caching to this project, layer by layer.

**Layer 1 — URL-level keyword cache (highest impact):**

```python
import hashlib, json, redis.asyncio as redis

redis_client = redis.from_url("redis://localhost:6379")

@app.post("/analyze")
async def analyze(body: AnalyzeRequest):
    cache_key = f"kw:{hashlib.sha256(body.url.encode()).hexdigest()}"
    
    # Check cache first
    cached = await redis_client.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # Cache miss — do the work
    text = await fetch_article_text(body.url)
    keywords = extract_keywords(text, top_n=60)
    
    # Store in cache with 1-hour TTL
    result = {"keywords": keywords}
    await redis_client.setex(cache_key, 3600, json.dumps(result))
    return result
```

**Layer 2 — Raw text cache (saves the HTTP request):**

Cache the crawled text separately so different `top_n` values can reuse it.

**Layer 3 — Rate limiting with Redis:**

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri="redis://localhost:6379")
app.state.limiter = limiter

@app.post("/analyze")
@limiter.limit("10/minute")  # 10 requests per minute per IP
async def analyze(request: Request, body: AnalyzeRequest):
    ...
```

---

### 2.4 Adding WebSocket Support for Real-Time Updates

The current flow is request-response: the user waits while everything happens. WebSockets would let you stream progress updates. Here is the design:

```
Client                          Server
  │                                │
  ├─── WS connect ──────────────► │
  │                                │
  ├─── { "url": "..." } ────────► │
  │                                │
  │ ◄── { "status": "crawling" }──┤  (immediate feedback)
  │                                │── fetches URL...
  │ ◄── { "status": "parsing" } ──┤
  │                                │── runs TF-IDF...
  │ ◄── { "status": "analyzing" }─┤
  │                                │
  │ ◄── { "keywords": [...] } ────┤  (final result)
  │                                │
  ├─── close ────────────────────► │
```

**Backend implementation:**

```python
from fastapi import WebSocket

@app.websocket("/ws/analyze")
async def ws_analyze(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_json()
    url = data["url"]
    
    await websocket.send_json({"status": "crawling", "message": "Fetching article..."})
    text = await fetch_article_text_async(url)
    
    await websocket.send_json({"status": "analyzing", "message": "Extracting keywords..."})
    keywords = extract_keywords(text, top_n=60)
    
    await websocket.send_json({"status": "complete", "keywords": keywords})
    await websocket.close()
```

**Frontend implementation:**

```typescript
function useAnalyzeWS() {
  const [status, setStatus] = useState<string>('')
  const [keywords, setKeywords] = useState<WordWeight[]>([])
  
  function analyze(url: string) {
    const ws = new WebSocket('ws://localhost:8000/ws/analyze')
    ws.onopen = () => ws.send(JSON.stringify({ url }))
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.status === 'complete') {
        setKeywords(data.keywords)
      } else {
        setStatus(data.message)  // Show "Fetching article..." etc.
      }
    }
  }
  return { status, keywords, analyze }
}
```

**Why this matters for Sparrow:** Video processing takes much longer than text analysis. Sparrow's product absolutely needs WebSockets (or SSE) to stream real-time progress during video upload and analysis. This shows you can design for that.

---

## 3. Interview Questions & Answers

### 3.1 Dave Luke Jr — Full Stack Engineer Questions (15)

These focus on code quality, React/TypeScript patterns, FastAPI architecture, and practical engineering judgment.

---

**Q1: "Walk me through the request flow from when a user clicks 'Analyse' to when they see the 3D cloud."**

> "When the user clicks Analyse, the `UrlInput` component calls `onSubmit(url)`, which triggers the `analyze` function from the `useAnalyze` hook. This sets `loading=true`, clears previous state, and fires an Axios POST to `/analyze` with the URL.
>
> On the backend, FastAPI validates the request body via Pydantic. The handler calls `fetch_article_text()` — this makes an HTTP GET with browser-like headers, parses the HTML with BeautifulSoup, strips noise tags, and extracts the article body using a priority-based selector chain. The cleaned text goes to `extract_keywords()`, which splits it into sentences, runs TF-IDF across those sentences, sums the scores per term, normalizes to [0,1], and returns the top 60 keywords.
>
> The response flows back to the frontend. React re-renders with the new keywords. `WordCloud3D` distributes the 60 keywords on a sphere using the Fibonacci golden-angle spiral, mapping each word's weight to color, size, and font weight. Each word is a `WordLabel` component using drei's Billboard (always faces camera) and Text (3D text with outline). The `KeywordList` sidebar renders the same data as a sorted ranked list with progress bars."

---

**Q2: "I see you're not using `useMemo` or `React.memo` in the 3D components. What's the performance impact?"**

> "It's significant. The `fibonacciSphere()` function in `WordCloud3D.tsx` runs on every render — that's 60 trigonometric calculations per frame during camera rotation (60fps). Since it only depends on `keywords.length`, wrapping it in `useMemo` would eliminate those wasted computations.
>
> More importantly, `WordLabel` isn't wrapped in `React.memo`, so all 60 word labels re-render whenever the parent `Scene` re-renders — even though their props haven't changed. With `React.memo` and stable props, only the specific label being hovered would re-render. Similarly, `KeywordList` does `[...keywords].sort()` on every render — an O(n log n) sort that should be memoized.
>
> For 60 words it's still smooth, but at 200+ words you'd start dropping below 60fps. These are all quick wins — `useMemo`, `React.memo`, and `useCallback` would bring unnecessary re-renders from ~60 per frame to ~1."

---

**Q3: "Why did you choose TF-IDF over simpler approaches like word frequency counting?"**

> "Raw word frequency would rank common filler words ('the', 'and', 'is') at the top, even after stopword removal. TF-IDF's IDF component penalizes terms that appear uniformly across all sentences — so a word that appears in every sentence scores lower than one concentrated in specific sentences.
>
> For example, in a machine learning article, the word 'data' might appear everywhere (low IDF), but 'reinforcement' might only appear in the section about RL (high IDF). TF-IDF naturally surfaces the more distinctive, interesting terms. It's a well-understood algorithm, computationally cheap, and doesn't require a pre-trained model or API calls."

---

**Q4: "Your `/analyze` endpoint is synchronous. What happens under load?"**

> "FastAPI runs synchronous endpoints in a threadpool (via `anyio`), so it doesn't completely block the event loop — but each request occupies a thread for the full duration of the external HTTP call, up to 15 seconds. With the default threadpool size of 40, that means only 40 concurrent analyses before requests queue up.
>
> To fix this, I'd make the endpoint `async def`, replace `requests` with `httpx.AsyncClient`, and make the crawler async. This way, while one request waits for an external HTTP response, the event loop can serve other requests. Combined with connection pooling, a single process could handle hundreds of concurrent requests."

---

**Q5: "How would you test this application?"**

> "I'd add three layers of tests:
>
> **Backend unit tests** (pytest): Test `extract_keywords()` with known input text and verify the output keywords are sensible. Test `_clean()` for whitespace normalization. Mock `requests.get` to test the crawler's selector chain with sample HTML. Test edge cases — empty text, non-English text, extremely short articles.
>
> **Backend integration tests**: Spin up the FastAPI app with TestClient, send POST requests to `/analyze` with real URLs (or mocked HTTP responses), and verify the full pipeline returns valid keyword arrays.
>
> **Frontend tests** (Vitest + React Testing Library): Test `useAnalyze` hook — mock Axios and verify state transitions (loading, error, success). Test `UrlInput` — simulate form submission and sample pill clicks. For `WordCloud3D`, test that it renders the correct number of word labels for a given keyword array.
>
> **E2E tests** (Playwright): Full flow — enter URL, wait for cloud to render, verify words are visible, click a sample pill. This catches integration issues between frontend and backend."

---

**Q6: "I notice there's no error boundary in the React app. What could go wrong?"**

> "If the Three.js canvas throws — for example, the browser doesn't support WebGL, or a `Text` component receives invalid props, or there's a memory issue with too many words — the error propagates up and crashes the entire React tree. The user sees a blank white page with no recovery option.
>
> I'd wrap the `WordCloud3D` component in an Error Boundary that catches render errors and shows a fallback message like 'Unable to render 3D visualization. Please try a different browser.' Error boundaries can't catch errors in event handlers or async code, but they handle the most critical case — render crashes."

---

**Q7: "Why axios instead of `fetch`? What would you change?"**

> "Axios was a quick choice for its cleaner API — automatic JSON parsing, typed responses, and `isAxiosError()` for error narrowing. But for a new project, I'd probably use `fetch` with a thin wrapper to avoid the extra dependency (15KB). Or even better, a library like `ky` or React Query (TanStack Query), which adds caching, retry logic, request deduplication, and stale-while-revalidate — things I'd otherwise have to build manually.
>
> If I were adding more API calls, React Query would be the clear choice because it handles all the state management that `useAnalyze` does manually — loading, error, caching, refetching."

---

**Q8: "Your CORS is hardcoded to localhost. How would you handle this in production?"**

> "I'd use environment variables:
>
> ```python
> import os
> origins = os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173').split(',')
> app.add_middleware(CORSMiddleware, allow_origins=origins, ...)
> ```
>
> In production, this would be set to the actual frontend domain. I'd also tighten `allow_methods` to just `['POST', 'GET']` and `allow_headers` to specific headers rather than wildcards. For added security, I'd set `allow_credentials=False` (it already defaults to that) and add proper CSP headers."

---

**Q9: "The crawler has a hardcoded User-Agent. Is that ethical? What are the alternatives?"**

> "Spoofing a browser User-Agent is a grey area. It helps avoid bot-blocking for legitimate crawling, but it misrepresents who's making the request. For production, I'd:
>
> 1. Set an honest User-Agent: `'WordSphere/1.0 (+https://wordsphere.app/bot)'`
> 2. Respect `robots.txt` — check it before crawling
> 3. Add a `Crawl-Delay` if specified in robots.txt
> 4. Cache results to minimize repeat requests to the same site
> 5. Add rate limiting per domain (not just per user)
>
> For a demo project, the current approach is fine. For Sparrow's production, you'd want to be a good web citizen."

---

**Q10: "How would you structure this project differently if you were starting from scratch?"**

> "A few things I'd change:
>
> **Backend**: Use Pydantic's `HttpUrl` type for URL validation from day one. Make everything async. Add structured logging with `structlog`. Use a `config.py` with Pydantic `BaseSettings` for environment-based configuration. Add a proper response model.
>
> **Frontend**: Use React Query for server state management instead of a custom hook. Add an Error Boundary. Put shared utility functions (color mapping, weight mapping) in a `utils/` folder instead of exporting them from `WordCloud3D`. Consider using CSS modules or Tailwind instead of a single global CSS file.
>
> **Testing**: Add pytest and Vitest from the start. Write tests as I go rather than after the fact.
>
> **DevOps**: Add a Dockerfile and docker-compose.yml for consistent development environments. Add a `.env.example` file documenting required environment variables.
>
> That said, for a take-home project on a timeline, I think the current structure is clean and appropriately scoped."

---

**Q11: "Explain the Fibonacci sphere algorithm. Why not random placement?"**

> "The Fibonacci sphere distributes points evenly on a sphere surface by placing them at incrementally descending latitudes (y goes from 1 to -1) and rotating each by the golden angle — approximately 137.5 degrees. This is the angle that avoids rational relationships between successive points, preventing visible patterns or clustering.
>
> Random placement has two problems: (1) points cluster at the poles due to the geometry of spherical coordinates, and (2) it's non-deterministic — the same keywords would appear in different positions on every render, which is disorienting. The Fibonacci method is O(n), deterministic, and produces near-optimal uniformity. It's the same algorithm used in particle simulations and astronomy for even sky sampling."

---

**Q12: "I see the blocklist in keyword_extractor.py. Isn't that brittle?"**

> "Yes, it's a maintenance burden. The blocklist catches Wikipedia-specific artifacts like 'isbn', 'archived', 'retrieved', and month names. It works for the demo but wouldn't generalize to other content types.
>
> A better approach would be: (1) externalize it to a JSON or YAML config file, (2) make it configurable per content source, or (3) use a more sophisticated NLP approach like Named Entity Recognition (NER) to classify and filter terms by type — keeping nouns and proper nouns while removing dates and common verbs. With an LLM-based approach, you wouldn't need a blocklist at all — you'd prompt the model to extract only semantically meaningful keywords."

---

**Q13: "What TypeScript improvements would you make to this codebase?"**

> "Several things:
>
> 1. **Stronger API types**: Add a response type for the backend — `interface AnalyzeResponse { keywords: WordWeight[] }` — and use it as the axios response type (already partially done).
>
> 2. **Validate the response at runtime**: TypeScript types are compile-time only. Use `zod` to validate that the API response actually matches the expected schema, catching backend bugs at the boundary.
>
> 3. **Remove the null assertion**: `useRef<Mesh>(null!)` should either be `useRef<Mesh | null>(null)` or the unused ref should be removed entirely.
>
> 4. **Stricter function types**: The `onSubmit` prop in `UrlInput` is typed as `(url: string) => void`, but the actual `analyze` function returns `Promise<void>`. These should match.
>
> 5. **Branded types**: `weight` is just `number`, but it's semantically a value in [0, 1]. A branded type or runtime validation would prevent accidentally passing a raw pixel value."

---

**Q14: "Why did you use React Three Fiber instead of plain Three.js?"**

> "React Three Fiber lets me manage the 3D scene declaratively using React's component model. Instead of imperative Three.js code — `scene.add(mesh)`, managing a render loop, handling cleanup — I write JSX components that automatically handle lifecycle, updates, and disposal.
>
> Specifically, it gives me: (1) React's diffing algorithm for efficient scene updates — only changed objects re-render, (2) Suspense for lazy-loaded assets, (3) hooks like `useFrame` for animation, (4) the drei utility library which has Billboard, Text, OrbitControls, and Html components ready to use.
>
> The tradeoff is bundle size (~50KB for R3F + ~100KB for drei on top of Three.js), but for a React app it's worth it for the developer experience and maintainability."

---

**Q15: "If you had to add dark/light mode support, how would you approach it?"**

> "The app is already dark-only. I'd:
>
> 1. Extract all colors from `index.css` into CSS custom properties (variables): `--bg-primary: #0d0d0d`, `--text-primary: #e0e0e0`, etc.
> 2. Create two themes using `[data-theme='light']` and `[data-theme='dark']` selectors that override those variables.
> 3. Add a toggle button in the header that sets `document.documentElement.dataset.theme`.
> 4. Persist the preference in `localStorage` and respect `prefers-color-scheme` media query for the default.
> 5. For the 3D scene, the word colors are weight-based and wouldn't change, but the canvas background and text outlines would need to adapt. Pass the theme as a prop or use a React context."

---

### 3.2 Todd Eaglin — AI/ML Questions (10)

These focus on NLP decisions, ML pipeline design, computer vision relevance, and how to integrate modern LLMs. Todd has a PhD in Computer Vision — he'll want depth.

---

**Q1: "Walk me through why you chose sentence-level TF-IDF. What are its limitations?"**

> "Standard TF-IDF requires a corpus of multiple documents to compute meaningful IDF scores. Since we have a single article, I needed to simulate a corpus. Splitting into sentences gives IDF variance — a word appearing in every sentence gets a low IDF (it's common within this article), while a word concentrated in a few sentences gets a high IDF (it's distinctive).
>
> **Limitations:**
> - **No semantic understanding**: TF-IDF treats words as independent tokens. It can't know that 'neural network' and 'deep learning' are related concepts.
> - **Sentence boundary dependency**: My sentence splitting is simplistic (split on period). Abbreviations like 'U.S.' or 'Dr.' create false splits.
> - **No phrase extraction**: Unigrams only — 'machine' and 'learning' are separate entries, not 'machine learning'.
> - **Frequency bias**: A long section about one subtopic inflates those terms even if the article isn't primarily about that.
> - **Language-dependent**: Stopword lists and tokenization are English-only.
>
> For a demo, these tradeoffs are fine. For production, I'd move to an embedding-based or LLM-based approach."

---

**Q2: "How would you replace TF-IDF with an LLM-based keyword extraction?"**

> "There are three approaches, increasing in sophistication:
>
> **Approach 1 — Direct prompting (simplest):**
> ```python
> import anthropic
> client = anthropic.Anthropic()
> response = client.messages.create(
>     model='claude-sonnet-4-20250514',
>     messages=[{
>         'role': 'user',
>         'content': f'''Extract the 60 most important keywords from this article.
>         Return JSON: [{{"word": "...", "weight": 0.0-1.0}}]
>         Weight should reflect how central the term is to the article's main topic.
>         Article: {text[:10000]}'''
>     }]
> )
> ```
> **Pros**: Understands context, catches compound phrases, no blocklist needed.
> **Cons**: API latency (~2-3s), cost per request, non-deterministic.
>
> **Approach 2 — Embedding-based (KeyBERT):**
> ```python
> from keybert import KeyBERT
> kw_model = KeyBERT()
> keywords = kw_model.extract_keywords(text, top_n=60, keyphrase_ngram_range=(1,2))
> ```
> Uses sentence-transformers to embed the document and candidate phrases, then picks the phrases whose embeddings are most similar to the full document embedding.
> **Pros**: Semantic understanding, captures bigrams, runs locally.
> **Cons**: Requires a GPU for fast inference, ~500MB model download.
>
> **Approach 3 — Hybrid (best for production):**
> Use TF-IDF as a fast first pass to get candidate terms, then re-rank them with an LLM or embedding model. This combines TF-IDF's speed with semantic understanding. The LLM only processes 60 candidates instead of the full article."

---

**Q3: "If Sparrow wanted to analyze coach feedback text (not articles), how would you adapt this pipeline?"**

> "Coach feedback is very different from articles — it's shorter, domain-specific, and uses sports jargon. I'd make these changes:
>
> 1. **Domain-specific stopwords**: Add sports terms that are too common to be useful ('player', 'game', 'practice') to the stoplist.
>
> 2. **Custom vocabulary**: Train TF-IDF on a corpus of coaching feedback rather than using general-purpose tokenization. This gives meaningful IDF scores for the domain.
>
> 3. **Entity extraction**: Use NER (Named Entity Recognition) to identify player names, drill names, and technical terms. SpaCy with a custom-trained model would work well.
>
> 4. **Sentiment integration**: Weight keywords by sentiment — 'improvement' and 'struggle' are more interesting than neutral terms.
>
> 5. **LLM-based extraction**: For Sparrow, I'd use Claude to extract structured insights rather than just keywords — 'areas of improvement', 'strengths', 'drills to recommend'. This is more actionable than a word cloud."

---

**Q4: "What are the tradeoffs between TF-IDF, Word2Vec, BERT embeddings, and LLMs for this task?"**

> | Method | Speed | Semantic Understanding | Cost | Setup |
> |--------|-------|----------------------|------|-------|
> | **TF-IDF** | Fastest (~5ms) | None — bag of words | Free | Minimal (scikit-learn) |
> | **Word2Vec** | Fast (~50ms) | Word-level similarity | Free | Need pre-trained vectors (~1GB) |
> | **BERT/KeyBERT** | Medium (~500ms) | Sentence-level context | Free (local) | GPU recommended, ~500MB model |
> | **LLM (Claude/GPT)** | Slow (~2-3s) | Full document understanding | $0.003-0.01/request | API key only |
>
> For this demo, TF-IDF is the right choice — zero cost, zero latency, no external dependencies. For a production app at Sparrow, I'd use the hybrid approach: TF-IDF for candidate generation + LLM for re-ranking and semantic filtering."

---

**Q5: "How would you handle non-English articles?"**

> "Several changes needed:
>
> 1. **Language detection**: Use `langdetect` or `fasttext` to identify the language before processing.
> 2. **Multilingual stopwords**: NLTK has stopword lists for 20+ languages. Select dynamically based on detected language.
> 3. **Tokenization**: For languages without space-separated words (Chinese, Japanese), use language-specific tokenizers like `jieba` (Chinese) or `MeCab` (Japanese).
> 4. **Character handling**: The current `token_pattern=r'[a-zA-Z]{3,}'` rejects non-Latin scripts entirely. Change to `r'\b\w{3,}\b'` or use language-aware tokenization.
> 5. **Stemming/Lemmatization**: The current pipeline doesn't stem, but if you add it, you need language-specific stemmers (Snowball supports 15+ languages).
>
> For Sparrow (sports coaching), you'd likely focus on specific target languages rather than universal support."

---

**Q6: "You mentioned you'd add caching. How would you handle cache invalidation for news articles that update?"**

> "There are three strategies:
>
> 1. **TTL-based (simplest)**: Cache with a 1-hour expiry. News articles rarely update their core content after the first hour. Simple, predictable, and good enough for 90% of cases.
>
> 2. **ETag/Last-Modified**: When crawling, store the HTTP `ETag` or `Last-Modified` header alongside the cached content. On subsequent requests, send a conditional request (`If-None-Match` / `If-Modified-Since`). If the server returns 304, use the cache; otherwise, re-process.
>
> 3. **Content-hash**: Hash the extracted text and compare to the cached hash. If it matches, serve cached keywords. This handles cases where the page changes but the article content doesn't (e.g., sidebar ads change).
>
> For Sparrow's use case (video analysis results), the cache key would be the video file hash — video content doesn't change after upload, so the cache never needs invalidation. That's simpler."

---

**Q7: "How would you evaluate the quality of the keyword extraction? What metrics would you use?"**

> "Keyword extraction evaluation is notoriously subjective, but there are approaches:
>
> 1. **Human evaluation (gold standard)**: Have annotators label 50 articles with 'ground truth' keywords. Compute precision (% of extracted keywords that are relevant), recall (% of relevant keywords that were extracted), and F1 score.
>
> 2. **Intrinsic metrics**: 
>    - **Coherence**: Measure whether the top keywords are semantically related to the article (using embedding similarity).
>    - **Coverage**: Check what percentage of the article's main topics are represented.
>    - **Diversity**: Ensure keywords aren't all synonyms of the same concept.
>
> 3. **A/B testing**: Show users two word clouds (TF-IDF vs. LLM) and ask which better represents the article. This is the most practical metric for a visual product.
>
> 4. **Proxy metrics**: For downstream tasks (search, recommendation), measure whether keywords improve task performance (click-through rate, relevance ranking).
>
> For this project, I'd start with a small human evaluation — have 5 people rate 10 articles and compute inter-annotator agreement."

---

**Q8: "Sparrow processes video for pose estimation. How does that compare architecturally to what you've built?"**

> "The architectures are structurally similar — both follow the pattern: **Ingest → Process → Visualize**. But the processing step is fundamentally different:
>
> | Aspect | WordSphere (text) | Sparrow (video) |
> |--------|-------------------|-----------------|
> | **Input** | URL → HTML text (~50KB) | Video file (~50-500MB) |
> | **Processing** | TF-IDF (~5ms, CPU) | Pose estimation model (~5-30s, GPU) |
> | **Output** | 60 keywords with weights | Skeleton keypoints per frame |
> | **Compute** | CPU-only, stateless | GPU-intensive, stateful |
> | **Latency** | ~2s total | 10-60s+ (depends on video length) |
> | **Scaling** | Horizontal CPU scaling | GPU cluster needed |
>
> Key architectural differences for video:
> 1. **File upload handling**: Need multipart upload, chunked transfer, progress tracking — can't just send a URL.
> 2. **Background processing**: Video analysis must be async — submit job, poll for results, or stream via WebSocket.
> 3. **GPU management**: Need to queue jobs and manage GPU allocation (Kubernetes + NVIDIA GPU operator, or AWS SageMaker endpoints).
> 4. **Storage**: Need object storage (S3) for videos and results, not just in-memory processing.
> 5. **Streaming results**: Show partial results as frames are processed rather than waiting for the full video."

---

**Q9: "How would you integrate an LLM to generate coaching feedback from pose estimation data?"**

> "This is a two-stage pipeline:
>
> **Stage 1 — Structured analysis (CV model output):**
> The pose estimation model outputs skeleton keypoints per frame. A post-processing step compares these to ideal form, producing structured metrics:
> ```json
> {
>   'hip_rotation_angle': 42,
>   'ideal_hip_rotation': 45,
>   'deviation': -3,
>   'shoulder_tilt_at_impact': 12,
>   'backswing_depth': 'shallow',
>   'tempo_ratio': 2.8
> }
> ```
>
> **Stage 2 — LLM coaching feedback:**
> Feed the structured metrics to an LLM with a coaching prompt:
>
> ```python
> response = client.messages.create(
>     model='claude-sonnet-4-20250514',
>     system='''You are an expert golf coach. Given swing analysis metrics, 
>     provide specific, actionable feedback. Reference the numbers.
>     Keep it encouraging but honest. Max 3 key points.''',
>     messages=[{
>         'role': 'user', 
>         'content': f'Swing analysis: {json.dumps(metrics)}'
>     }]
> )
> ```
>
> **Why this two-stage approach?**
> - The CV model is precise but not explainable — it outputs numbers
> - The LLM is explainable but can't analyze video directly (yet)
> - Together: CV provides the data, LLM provides the narrative
> - You can also use RAG (Retrieval-Augmented Generation) to pull in coaching tips from a knowledge base based on the specific issues detected"

---

**Q10: "If you had to scale the keyword extraction to process 10,000 articles per minute, how would you architect it?"**

> "That's ~167 articles per second — way beyond a single server. Here's the architecture:
>
> ```
> API Gateway (rate limiting, auth)
>      │
>      ▼
> Load Balancer (ALB/Nginx)
>      │
>      ├──► FastAPI Worker 1 ──► Redis (cache check) ──► If miss:
>      ├──► FastAPI Worker 2 ──►                              │
>      ├──► FastAPI Worker N ──►                              ▼
>      │                                              Message Queue (SQS/RabbitMQ)
>      │                                                     │
>      │                                   ┌─────────────────┼──────────────┐
>      │                                   ▼                 ▼              ▼
>      │                              Worker 1          Worker 2       Worker N
>      │                              (crawl+TF-IDF)   (crawl+TF-IDF) (crawl+TF-IDF)
>      │                                   │                 │              │
>      │                                   └────────┬────────┘              │
>      │                                            ▼                      │
>      │                                    Redis (store results) ◄────────┘
>      │                                            │
>      ▼                                            ▼
> WebSocket/SSE ◄──────────────── Result notification
> ```
>
> **Key components:**
> 1. **Redis cache**: 80%+ of popular URLs will be cache hits → instant response
> 2. **Message queue**: Decouples request acceptance from processing → handles spikes
> 3. **Horizontal workers**: Stateless crawl+TF-IDF workers scale independently
> 4. **Rate limiting per domain**: Don't DDoS external sites — max 10 req/s per domain
> 5. **Circuit breaker**: If an external site is down, fail fast instead of waiting 15s
>
> At this scale, I'd also pre-compute popular articles and use a CDN for static results."

---

## 4. Extension Scenarios

These are "live coding" scenarios they might ask you to extend the app with. For each, know the approach well enough to code it on the spot.

### 4.1 Adding User Authentication

**The question:** "How would you add user login so each person can save their word clouds?"

**Architecture:**

```
Frontend (React)                      Backend (FastAPI)
    │                                      │
    ├── Login form ──────────────────►  POST /auth/login
    │   (email + password)                 │
    │                                      ├── Verify credentials (bcrypt)
    │ ◄── JWT access token ──────────────┤  ├── Generate JWT (python-jose)
    │                                      │
    ├── Store token in memory/cookie       │
    │                                      │
    ├── POST /analyze ──────────────►     │
    │   Authorization: Bearer <token>      ├── Dependency: get_current_user()
    │                                      │   Decodes JWT, returns user
    │                                      │
    │ ◄── { keywords: [...] } ───────────┤
```

**Backend implementation sketch:**

```python
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from passlib.context import CryptContext

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
pwd_context = CryptContext(schemes=["bcrypt"])

async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(401, "Invalid token")
    return user

@app.post("/analyze")
async def analyze(body: AnalyzeRequest, user = Depends(get_current_user)):
    # user is now available — can save results to their account
    ...
```

**Key decisions to discuss:**
- **JWT vs. session cookies**: JWT is stateless (no server-side session store), but can't be revoked without a blocklist. For an API, JWT is standard. For Sparrow's web app, HTTP-only cookies with CSRF protection are more secure.
- **OAuth for production**: In production, use an auth provider (Auth0, Clerk, or Firebase Auth) instead of rolling your own — it handles password reset, MFA, social login, and security patches.

---

### 4.2 Replacing TF-IDF with LLM-Based Keyword Extraction

**The question:** "Show me how you'd swap the NLP pipeline to use Claude or GPT for keyword extraction."

**Step-by-step implementation:**

```python
# backend/services/llm_keyword_extractor.py
import json
import anthropic

client = anthropic.Anthropic()  # Reads ANTHROPIC_API_KEY from env

async def extract_keywords_llm(text: str, top_n: int = 60) -> list[dict]:
    """Extract keywords using Claude, with TF-IDF as fallback."""
    
    # Truncate to avoid token limits (Claude's context is large, but let's be efficient)
    truncated = text[:15000]
    
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": f"""Extract the {top_n} most important keywords from this article.

Rules:
- Return ONLY a JSON array of objects: [{{"word": "keyword", "weight": 0.85}}]
- weight should be 0.0 to 1.0, reflecting centrality to the article's main topic
- The most important keyword should have weight 1.0
- Include single words AND key phrases (2-3 words max)
- Focus on domain-specific, distinctive terms — not generic words
- No common words like "article", "according", "however"

Article text:
{truncated}"""
            }]
        )
        
        # Parse the JSON from the response
        result = json.loads(response.content[0].text)
        return sorted(result, key=lambda x: x["weight"], reverse=True)[:top_n]
        
    except Exception:
        # Fallback to TF-IDF if LLM fails
        from services.keyword_extractor import extract_keywords
        return extract_keywords(text, top_n)
```

**Key points to discuss:**
- **Fallback pattern**: Always have a fallback — LLM APIs can fail or be rate-limited
- **Structured output**: Claude supports JSON mode and tool use for more reliable structured output (no parsing failures)
- **Cost**: At ~$0.003 per request (Sonnet), 10,000 requests/day = ~$30/day. For a startup, this is fine.
- **Latency**: LLM adds ~2-3s. Could run TF-IDF immediately and upgrade with LLM results when ready (progressive enhancement).

---

### 4.3 Adding a Database to Store Past Word Clouds

**The question:** "How would you persist word clouds so users can revisit them?"

**Schema (PostgreSQL with SQLAlchemy):**

```python
# backend/models.py
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    clouds = relationship("WordCloud", back_populates="user")

class WordCloud(Base):
    __tablename__ = "word_clouds"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    url = Column(String, nullable=False)
    title = Column(String)
    keywords = Column(JSON)  # Store the full keyword array as JSON
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="clouds")
```

**New endpoints:**

```python
@app.post("/clouds")           # Save a word cloud
@app.get("/clouds")            # List user's saved clouds
@app.get("/clouds/{cloud_id}") # Get a specific cloud
@app.delete("/clouds/{cloud_id}") # Delete a cloud
```

**Frontend changes:**
- Add a "Save" button after analysis
- Add a "My Clouds" sidebar or page listing saved results
- Clicking a saved cloud loads it without re-analyzing

**Why JSON column for keywords?**
- The keywords array is always read/written as a whole — never queried by individual keyword
- Avoids a separate `keywords` table with a join
- PostgreSQL's native JSON type supports indexing if needed later

---

### 4.4 Deploying on AWS (ECS/Lambda)

**The question:** "Walk me through how you'd deploy this on AWS."

**Option A — ECS Fargate (recommended for this app):**

```
                    ┌────────────────────────────────┐
                    │         CloudFront CDN          │
                    │  (serves React static assets)   │
                    └──────────────┬─────────────────┘
                                   │
                    ┌──────────────▼─────────────────┐
                    │     Application Load Balancer    │
                    │      (routes /analyze to ECS)    │
                    └──────────────┬─────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │  ECS Fargate     │ │  ECS Fargate     │ │  ECS Fargate     │
    │  Task (FastAPI)  │ │  Task (FastAPI)  │ │  Task (FastAPI)  │
    └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
             │                    │                     │
             └────────────────────┼─────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │     ElastiCache (Redis)     │
                    │  (caching + rate limiting)  │
                    └────────────────────────────┘
```

**Steps:**
1. **Dockerize**: Create a `Dockerfile` for the FastAPI backend
2. **ECR**: Push the Docker image to Elastic Container Registry
3. **ECS Fargate**: Create a task definition (CPU: 0.5 vCPU, Memory: 1GB)
4. **ALB**: Route `/analyze` and `/health` to ECS
5. **S3 + CloudFront**: Build the React app (`npm run build`), upload to S3, serve via CloudFront
6. **ElastiCache**: Redis for caching and rate limiting
7. **RDS**: PostgreSQL if adding user accounts and saved clouds
8. **Auto-scaling**: Scale ECS tasks based on CPU/request count

**Option B — Lambda (if you want serverless):**
- Package the FastAPI app with Mangum (ASGI adapter for Lambda)
- API Gateway → Lambda → processes request
- Pros: Zero cost at low traffic, auto-scales to thousands of concurrent requests
- Cons: Cold starts (~2-5s), 15-minute timeout limit, no WebSocket support (would need separate Lambda + API Gateway WebSocket)

**Cost estimate (ECS Fargate, low traffic):**
- 1 Fargate task (0.5 vCPU, 1GB): ~$15/month
- ALB: ~$16/month
- ElastiCache (t3.micro): ~$12/month
- S3 + CloudFront: ~$1/month
- **Total: ~$44/month** for a production-ready deployment

---

## 5. Sparrow-Specific System Design

### 5.1 The Prompt

"Design a simplified version of Sparrow's core product: a user uploads a golf swing video, the backend processes it with a CV model for pose estimation, results are returned in real-time, and an LLM generates coaching feedback."

### 5.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REACT FRONTEND                                  │
│                                                                         │
│  ┌────────────┐   ┌────────────────┐   ┌──────────────────────────┐   │
│  │ Video      │   │ Upload         │   │ Analysis Dashboard       │   │
│  │ Capture/   │──►│ Progress       │──►│ • Skeleton overlay       │   │
│  │ Upload     │   │ (WebSocket)    │   │ • Metric cards           │   │
│  │ Component  │   │                │   │ • LLM coaching feedback  │   │
│  └────────────┘   └────────────────┘   │ • Historical comparison  │   │
│                                         └──────────────────────────┘   │
│         ▲                    ▲                       ▲                  │
│         │              WebSocket                     │                  │
│         │            progress events                 │                  │
└─────────┼────────────────────┼───────────────────────┼──────────────────┘
          │                    │                       │
          ▼                    │                       │
┌─────────────────────────────────────────────────────────────────────────┐
│                       AWS INFRASTRUCTURE                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    API Gateway / ALB                              │  │
│  └────────────┬──────────────┬──────────────────────────────────────┘  │
│               │              │                                         │
│  ┌────────────▼──────────┐   │                                         │
│  │  FastAPI Application  │   │                                         │
│  │  (ECS Fargate)        │   │                                         │
│  │                       │   │                                         │
│  │  POST /upload         │───┼──► S3 Bucket (video storage)            │
│  │    • Validate video   │   │       │                                 │
│  │    • Generate job ID  │   │       │ S3 Event Trigger                │
│  │    • Return job ID    │   │       ▼                                 │
│  │                       │   │  ┌────────────────────────────────┐     │
│  │  WS /ws/status/{id}  │◄──┼──│  Processing Queue (SQS)       │     │
│  │    • Stream progress  │   │  └───────────────┬────────────────┘     │
│  │                       │   │                  │                      │
│  │  GET /analysis/{id}   │   │                  ▼                      │
│  │    • Return results   │   │  ┌────────────────────────────────┐     │
│  └───────────────────────┘   │  │  GPU Worker (ECS + GPU)        │     │
│                              │  │                                │     │
│                              │  │  Step 1: Download from S3      │     │
│                              │  │  Step 2: Extract frames        │     │
│                              │  │  Step 3: Run pose estimation   │     │
│                              │  │    (MediaPipe / MoveNet /      │     │
│                              │  │     custom model)              │     │
│                              │  │  Step 4: Post-process          │     │
│                              │  │    (angles, tempo, positions)  │     │
│                              │  │  Step 5: Call LLM for coaching │     │
│                              │  │  Step 6: Store results in DB   │     │
│                              │  │  Step 7: Notify via WebSocket  │     │
│                              │  └────────────────────────────────┘     │
│                              │                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ PostgreSQL   │  │ Redis        │  │ S3           │                │
│  │ (RDS)        │  │ (ElastiCache)│  │ (Videos +    │                │
│  │ • Users      │  │ • Sessions   │  │  Results)    │                │
│  │ • Analyses   │  │ • Job status │  │              │                │
│  │ • History    │  │ • Rate limit │  │              │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Component-by-Component Explanation

**1. Video Upload (Frontend)**

The user either records a swing with their phone camera or uploads an existing video. The React component handles:
- Video preview before upload
- Chunked upload for large files (using `tus` protocol or multipart upload to S3 presigned URLs)
- Upload progress bar

Why chunked upload? A golf swing video can be 50-200MB. A single HTTP POST would time out or use too much memory. Instead, we get a presigned S3 upload URL from the backend and upload directly to S3, bypassing the API server entirely. This is critical for scaling.

```typescript
// Frontend: Get presigned URL, then upload directly to S3
const { uploadUrl, jobId } = await api.post('/upload/init', { filename, size })
await fetch(uploadUrl, { method: 'PUT', body: videoFile })
await api.post('/upload/complete', { jobId })
```

**2. FastAPI Application (Backend)**

The API server is thin — it handles auth, validation, and orchestration but does NOT process video itself. This is a key architectural decision: keeping the API server stateless and lightweight means it can scale independently from the GPU workers.

Endpoints:
- `POST /upload/init` — Generates S3 presigned URL + job ID
- `POST /upload/complete` — Marks upload as done, enqueues processing job
- `WS /ws/status/{job_id}` — WebSocket for real-time progress
- `GET /analysis/{job_id}` — Returns completed analysis results

**3. Processing Queue (SQS)**

When a video upload completes, an event is pushed to SQS. This decouples "accepting uploads" from "processing videos." Benefits:
- The API server never blocks waiting for GPU processing
- If GPUs are busy, jobs queue up rather than failing
- Failed jobs can be retried automatically
- You can scale GPU workers independently based on queue depth

**4. GPU Worker — Pose Estimation**

This is the core ML component. It runs on an EC2 instance or ECS task with an NVIDIA GPU.

**Step-by-step processing:**

```python
# 1. Download video from S3
video_path = download_from_s3(job.s3_key)

# 2. Extract key frames (don't process every frame — golf swings have ~5 key positions)
frames = extract_key_frames(video_path, positions=[
    'address', 'backswing_top', 'downswing_mid', 
    'impact', 'follow_through', 'finish'
])

# 3. Run pose estimation (MediaPipe Pose or custom model)
import mediapipe as mp
pose = mp.solutions.pose.Pose(model_complexity=2)
keypoints_per_frame = [pose.process(frame) for frame in frames]

# 4. Post-process: compute biomechanical metrics
metrics = compute_swing_metrics(keypoints_per_frame)
# Returns: hip_rotation, shoulder_tilt, spine_angle, tempo, etc.

# 5. Generate LLM coaching feedback
coaching = await generate_coaching_feedback(metrics)

# 6. Store results
await db.analyses.insert({
    'job_id': job.id,
    'keypoints': keypoints_per_frame,
    'metrics': metrics,
    'coaching': coaching,
    'status': 'complete'
})

# 7. Notify frontend via Redis pub/sub → WebSocket
await redis.publish(f'job:{job.id}', json.dumps({'status': 'complete'}))
```

**5. LLM Coaching Feedback**

After pose estimation, the structured metrics are sent to Claude for natural-language coaching:

```python
async def generate_coaching_feedback(metrics: dict) -> str:
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        system="""You are a PGA-certified golf coach. Analyze swing metrics 
        and provide 3 specific, actionable improvement tips. Be encouraging 
        but precise. Reference specific angles and positions.""",
        messages=[{
            "role": "user",
            "content": f"Here are the swing analysis results: {json.dumps(metrics)}"
        }]
    )
    return response.content[0].text
```

**Why not have the LLM analyze the video directly?**
- Current LLMs can process images but can't do precise pose estimation from video
- A specialized CV model (MediaPipe, MoveNet) gives exact joint coordinates
- The LLM's strength is turning numbers into human-friendly coaching language
- Separation of concerns: CV model = precision, LLM = communication

**6. Real-Time Progress (WebSocket)**

The frontend connects to a WebSocket after uploading:

```
Client ──WS──► /ws/status/abc123
                    │
Server listens on Redis pub/sub channel "job:abc123"
                    │
GPU Worker publishes: {"status": "extracting_frames", "progress": 0.2}
                    │
Server forwards ──► Client shows: "Extracting frames... 20%"
                    │
GPU Worker publishes: {"status": "analyzing_pose", "progress": 0.6}
                    │
Server forwards ──► Client shows: "Analyzing your swing... 60%"
                    │
GPU Worker publishes: {"status": "generating_feedback", "progress": 0.9}
                    │
Server forwards ──► Client shows: "Generating coaching tips... 90%"
                    │
GPU Worker publishes: {"status": "complete", "analysis_id": "xyz789"}
                    │
Server forwards ──► Client navigates to analysis results page
```

### 5.4 Scaling Considerations

| Concern | Solution |
|---------|----------|
| **Video storage costs** | S3 Intelligent-Tiering — move old videos to Glacier after 30 days |
| **GPU costs** | Spot instances for batch processing (70% cheaper), on-demand for real-time |
| **Cold start latency** | Keep at least 1 GPU worker warm; pre-load model on startup |
| **Global latency** | S3 Transfer Acceleration for uploads, CloudFront for results |
| **Model versioning** | SageMaker Model Registry or MLflow — track which model version produced each analysis |
| **A/B testing models** | Route 10% of traffic to new model, compare coaching quality metrics |

### 5.5 How This Connects to Your WordSphere Project

In the interview, draw the parallel:

> "WordSphere follows the same Ingest → Process → Visualize pattern. The URL input is analogous to video upload. The crawler + TF-IDF pipeline is analogous to frame extraction + pose estimation. The 3D word cloud visualization is analogous to the skeleton overlay and coaching dashboard. The main differences are scale (MB vs. KB), compute (GPU vs. CPU), and latency (seconds vs. milliseconds). But the architectural patterns — async processing, caching, real-time feedback, API separation — are directly transferable."

---

## 6. Quick Reference Sheet

### 6.1 FastAPI Patterns

**Dependency Injection — the core pattern:**

```python
# Dependencies are functions that run before your endpoint
async def get_db():
    db = SessionLocal()
    try:
        yield db       # Yielded value is injected into the endpoint
    finally:
        db.close()     # Cleanup runs after the endpoint returns

async def get_current_user(token: str = Depends(oauth2_scheme)):
    user = decode_jwt(token)
    return user

# Use with Depends()
@app.post("/analyze")
async def analyze(
    body: AnalyzeRequest,
    user: User = Depends(get_current_user),     # Auth
    db: Session = Depends(get_db),               # Database
):
    ...
```

Why this matters: Dependencies are composable, testable (just override them in tests), and handle their own cleanup. They replace decorators, middleware, and global state for cross-cutting concerns.

**Background Tasks — fire and forget:**

```python
from fastapi import BackgroundTasks

def send_email(to: str, subject: str):
    # This runs after the response is sent
    ...

@app.post("/analyze")
async def analyze(body: AnalyzeRequest, bg: BackgroundTasks):
    keywords = extract_keywords(...)
    bg.add_task(send_email, "user@example.com", "Your analysis is ready")
    return {"keywords": keywords}  # Returns immediately
```

When to use: Logging, notifications, cleanup — anything that shouldn't delay the response. For heavy work (video processing), use a proper task queue (Celery/ARQ) instead.

**Middleware — request/response pipeline:**

```python
from starlette.middleware.base import BaseHTTPMiddleware
import time

class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start
        response.headers["X-Process-Time"] = str(duration)
        return response

app.add_middleware(TimingMiddleware)
```

Common middleware: CORS, authentication, request logging, rate limiting, GZip compression.

**Async vs Sync — when to use which:**

```python
# Use async def when doing I/O (database, HTTP requests, file reads)
@app.get("/data")
async def get_data():
    result = await db.fetch("SELECT ...")  # Non-blocking
    return result

# Use def when doing CPU work or calling sync libraries
# FastAPI auto-runs sync endpoints in a threadpool
@app.post("/compute")
def compute():
    result = heavy_cpu_computation()  # Blocking but in threadpool
    return result
```

Rule of thumb: If you `await` anything inside, use `async def`. If everything is synchronous, plain `def` is fine — FastAPI handles it.

**Pydantic Models — request/response validation:**

```python
from pydantic import BaseModel, HttpUrl, Field, field_validator

class AnalyzeRequest(BaseModel):
    url: HttpUrl                                    # Validates URL format
    top_n: int = Field(default=60, ge=1, le=200)   # Bounded integer

    @field_validator('url')
    @classmethod
    def no_private_urls(cls, v):
        # Custom validation logic
        if 'localhost' in str(v):
            raise ValueError('Internal URLs not allowed')
        return v

class KeywordResponse(BaseModel):
    word: str
    weight: float = Field(ge=0.0, le=1.0)

class AnalyzeResponse(BaseModel):
    keywords: list[KeywordResponse]
```

---

### 6.2 React / TypeScript Patterns

**Custom Hooks — encapsulating logic:**

```typescript
// The pattern: state + logic + return interface
function useAnalyze(): UseAnalyzeResult {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (input: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.post('/endpoint', { input })
      setData(result.data)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, execute }
}
```

The hook owns its state and exposes a clean interface. The component just calls `execute()` and reads `data/loading/error`. This is the separation between "what data do I need" and "how do I get it."

**Performance — the three tools:**

```typescript
// 1. useMemo — memoize expensive computations
const sorted = useMemo(
  () => [...keywords].sort((a, b) => b.weight - a.weight),
  [keywords]  // Only recompute when keywords change
)

// 2. useCallback — memoize functions (for stable prop references)
const handleClick = useCallback((id: string) => {
  setSelected(id)
}, [])  // Never recreated

// 3. React.memo — skip re-renders when props haven't changed
const WordLabel = React.memo(function WordLabel({ entry, color }: Props) {
  // Only re-renders when entry or color actually changes
  return <Text color={color}>{entry.word}</Text>
})
```

When to use each:
- `useMemo`: For computations that are expensive (sorting, filtering, math)
- `useCallback`: For functions passed as props to memoized children
- `React.memo`: For components that re-render often with the same props (list items)

Don't memoize everything — the overhead of comparison can exceed the cost of re-rendering for simple components.

**Error Boundaries — catching render crashes:**

```typescript
class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Render error:', error, info)
  }
  
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// Usage
<ErrorBoundary fallback={<p>3D rendering failed. Try refreshing.</p>}>
  <WordCloud3D keywords={keywords} />
</ErrorBoundary>
```

**State Management decision tree:**

```
Is it server data (API responses)?
  → React Query (TanStack Query) — handles caching, refetching, stale data

Is it shared across many components?
  → React Context + useReducer (simple) or Zustand (complex)

Is it local to one component?
  → useState

Is it a form?
  → React Hook Form or just useState for simple forms
```

---

### 6.3 Three.js / React Three Fiber Key Concepts

**From this project — the patterns that matter:**

```
Canvas — The root Three.js renderer (creates WebGL context)
  │
  ├── Scene (implicit) — Container for all 3D objects
  │     │
  │     ├── ambientLight — Uniform lighting (no shadows)
  │     │
  │     ├── OrbitControls — Mouse-driven camera rotation/zoom
  │     │     enableDamping: smooth deceleration after drag
  │     │     minDistance/maxDistance: zoom limits
  │     │
  │     └── group — Container for positioning multiple objects
  │           │
  │           └── WordLabel (×60)
  │                 │
  │                 ├── Billboard — Auto-rotates to face camera
  │                 │     │
  │                 │     ├── Text — 3D text with SDF rendering
  │                 │     │    fontSize, fontWeight, color, outline
  │                 │     │
  │                 │     └── Html — DOM element in 3D space
  │                 │          (tooltip, distanceFactor for scaling)
  │                 │
  │                 └── position={[x, y, z]} — Fibonacci sphere coords
  │
  └── Suspense — Handles async asset loading (fonts, textures)
```

**Key concepts to explain:**

1. **React Three Fiber's reconciler**: R3F is a React renderer — just like ReactDOM renders to the browser DOM, R3F renders to a Three.js scene graph. JSX elements map to Three.js objects. This means React's diffing, lifecycle, and hooks all work for 3D.

2. **Billboard**: A `<Billboard>` wraps its children so they always face the camera. Without it, text on the far side of the sphere would appear backwards. It applies an inverse rotation matrix each frame.

3. **Text (SDF rendering)**: drei's `<Text>` uses signed distance field rendering — the font is converted to a mathematical representation that renders crisply at any zoom level. This is much better than texture-based text which gets pixelated.

4. **The render loop**: R3F runs a render loop at 60fps (requestAnimationFrame). Each frame, it traverses the React tree, updates Three.js objects, and renders to the WebGL canvas. `OrbitControls` modifies the camera matrix each frame based on user input.

---

### 6.4 LLM Integration Patterns

**Streaming — show tokens as they arrive:**

```python
# Backend (FastAPI + SSE)
from fastapi.responses import StreamingResponse

@app.post("/chat")
async def chat(body: ChatRequest):
    async def generate():
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            messages=[{"role": "user", "content": body.message}]
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")
```

```typescript
// Frontend (consuming SSE stream)
const response = await fetch('/chat', { method: 'POST', body: JSON.stringify(msg) })
const reader = response.body!.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value)
  // Parse SSE format and append to UI
  setOutput(prev => prev + parseSSE(text))
}
```

Why streaming matters: For coaching feedback, users see text appear word-by-word instead of waiting 3-5 seconds for the full response. This dramatically improves perceived latency.

**Function Calling / Tool Use — structured LLM output:**

```python
# Make the LLM call a "function" instead of generating free text
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    tools=[{
        "name": "extract_keywords",
        "description": "Extract keywords from article text",
        "input_schema": {
            "type": "object",
            "properties": {
                "keywords": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "word": {"type": "string"},
                            "weight": {"type": "number", "minimum": 0, "maximum": 1}
                        }
                    }
                }
            }
        }
    }],
    messages=[{"role": "user", "content": f"Extract keywords: {text}"}]
)
# The response is guaranteed to match the schema — no JSON parsing needed
```

Why tool use over raw text: The LLM's output is guaranteed to match the schema. No regex parsing, no "sometimes it returns markdown instead of JSON" issues. This is the production-grade approach.

**RAG (Retrieval-Augmented Generation) — grounding LLM in your data:**

```
User question: "How do I fix my slice?"
        │
        ▼
[1] Embed the question (text → vector)
        │
        ▼
[2] Search vector DB for similar coaching content
    • "A slice occurs when the clubface is open at impact..."
    • "To correct a slice, focus on grip and path..."
        │
        ▼
[3] Combine retrieved context + question → send to LLM
    Prompt: "Using the following coaching knowledge: {context}
             Answer the user's question: {question}"
        │
        ▼
[4] LLM generates answer grounded in your coaching database
    (not hallucinated from training data)
```

Why RAG matters for Sparrow: Coaching advice should be consistent, accurate, and based on established methodology — not made up by the LLM. RAG ensures the LLM's responses are grounded in Sparrow's actual coaching content while still sounding natural and personalized.

**Key LLM Integration Principles:**

1. **Always have a fallback**: LLM APIs can timeout, rate-limit, or return errors. Have a non-LLM path (like TF-IDF in this project).
2. **Cache aggressively**: Same input = same output (mostly). Cache LLM responses to reduce cost and latency.
3. **Validate output**: Even with tool use, validate the LLM's response against your business rules before showing it to users.
4. **Stream when possible**: Streaming responses feel 5-10x faster than waiting for the full response.
5. **Cost awareness**: Track token usage per request. Set max_tokens limits. Use cheaper models (Haiku) for simple tasks and expensive models (Opus) only when needed.

---

## Final Tips for the Interview

### For Dave (Full Stack Engineer):

1. **Lead with trade-offs**: Don't just say what you built — explain what you chose NOT to do and why. "I used TF-IDF instead of an LLM because it's zero-cost, zero-latency, and runs locally. For production, I'd use a hybrid approach."

2. **Know your performance story**: Be ready to profile the app live. Open React DevTools Profiler, show unnecessary re-renders, and fix them with `useMemo`/`React.memo`.

3. **Show testing awareness**: Even though there are no tests yet, have a testing strategy ready. Name specific tools (pytest, Vitest, Playwright) and specific tests you'd write.

4. **Talk about error handling**: The current app has gaps (no error boundary, no request cancellation). Acknowledge them proactively and explain the fix.

### For Todd (AI/ML PhD):

1. **Know your algorithm deeply**: Be able to explain TF-IDF from first principles — the math (tf * log(N/df)), why sentence-level IDF works, and when it breaks down.

2. **Bridge to computer vision**: Your project is NLP, but Sparrow is CV. Draw the parallel: "Both follow Ingest → Process → Visualize. The processing step changes (TF-IDF → pose estimation), but the architecture is the same."

3. **Show LLM sophistication**: Know the difference between prompting, function calling, RAG, and fine-tuning. Know when to use each. Todd will be impressed if you can discuss embedding models, vector databases, and grounding.

4. **Think about evaluation**: How do you know the keywords are good? How would you evaluate a coaching LLM's feedback? This is where ML PhDs separate strong candidates — showing you think about measurement, not just implementation.

5. **Scale thinking**: Be ready for "what if we had 1 million videos per day?" questions. Know the components: GPU clusters, job queues, model serving (SageMaker, TorchServe), data pipelines.

### General:

- **Be honest about gaps**: "I chose not to add tests for this demo, but here's my testing strategy" is better than pretending they're not needed.
- **Tie everything to Sparrow**: Every answer should end with "and here's how this applies to your product." They're hiring for their specific needs.
- **Show you can ship**: This project went from zero to deployed in one day (13 commits, all on the same date). That's a signal that you move fast and build complete features.

---

*Good luck with the interview! You built a solid project — now it's about showing you understand the decisions you made and can think beyond them.*
