# Charlotte Personal App — Technical & Functional Specification
_Last updated: 2025-08-13 17:36 (local)_


## 0) Overview
A private, mobile‑first personal app for Charlotte to capture song ideas (voice + text), auto‑transcribe lyrics, organise a searchable “Lyric Book”, keep general voice notes with auto to‑do extraction, show a personal timetable/calendar, and surface motivational quotes — all in a purple, family‑themed UI.

**Stack**: Eleventy (11ty) + Netlify (CI/CD + Functions) + Supabase (Postgres + Storage [+ Auth if desired]) + OpenAI Whisper (transcription).  
**Primary user**: Charlotte. **Admin**: Mark (Supabase access).  
**Principles**: simple, calming, low‑friction, private by default, accessible, offline‑tolerant where sensible.

---

## 1) Goals & Non‑Functional Requirements
- **Mobile‑first**; desktop friendly for editing/heavier flows.
- **Privacy**: content is private to Charlotte (and optionally Mark). Public content is out of scope.
- **Low cognitive load**: short labels, uncluttered screens, clear calls to action.
- **Fast**: static 11ty pages; dynamic data fetched client‑side via Supabase or Netlify Functions.
- **Resilient audio capture**: support both in‑browser recording _and_ iPhone Voice Memos upload.
- **Auditable**: keep timestamps and versions for content edits where reasonable.
- **Accessible**: WCAG‑aligned colours/contrast; keyboard and screen‑reader friendly.

---

## 2) Information Architecture (Pages)
1. **Splash / Home**: “Hello, Charlotte” on purple, family‑photo hero. Random motivational quote.
2. **Song Snippets / Recorder**: record/upload, send for Whisper, save audio+transcript, tag, play.
3. **Lyric Book**: searchable, scrollable library of transcripts (verse/chorus friendly), filters/sorts.
4. **Notes & To‑Dos**: general voice notes + auto task extraction; manual checklist.
5. **Song Ideas**: quick text/voice ideas, theming/tags.
6. **Calendar**: private timetable (week & month); optional read‑only ICS feed for family.
7. **Productivity**: Pomodoro timer (configurable), simple “Today” overview (events + tasks).
8. **Links**: ACM Canvas, Spotify, other useful links.
9. **Help**: “How to use this app” with short, friendly instructions and FAQs.
10. **Settings** (optional): theme tweaks, durations, quote source (local/DB).

---

## 3) Data Model (Supabase)
### 3.1 Tables (DDL sketch)
```sql
-- users (optional if using Supabase Auth)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text,
  created_at timestamptz default now()
);

-- song_snippets: audio + transcript (lyrics)
create table if not exists song_snippets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  title text,
  transcript text,
  sections jsonb,               -- optional [{type:"verse|chorus", text:"..."}]
  theme text,                   -- free tag or enum
  tags text[],
  audio_path text not null,     -- supabase storage path e.g. audio-uploads/...m4a
  duration_seconds int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- voice_notes: general speech notes (non‑song)
create table if not exists voice_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  transcript text,
  audio_path text,
  created_at timestamptz default now()
);

-- todos: extracted or manual tasks
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  source_note_id uuid references voice_notes(id),
  text text not null,
  due_at timestamptz,
  is_done boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- song_ideas: freeform text ideas (text or dictated -> transcript)
create table if not exists song_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  title text,
  body text,
  theme text,
  tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- events: calendar items
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  color text,                   -- optional colour-code
  rrule text,                   -- optional RFC5545 recurrence
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- quotes: optional if storing in DB vs local JSON
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  author text,
  tags text[],
  created_at timestamptz default now()
);
```

### 3.2 Storage
- **Bucket**: `audio-uploads` (m4a/mp3/wav/ogg).  
  File naming: `song/{yyyy}/{mm}/{id}.m4a` and `notes/{yyyy}/{mm}/{id}.m4a`.

### 3.3 RLS (Row Level Security) — sketch
- Enable RLS on all user content tables.
- Policy: user can `select/insert/update/delete` rows where `user_id = auth.uid()`.
- Admin (Mark) role: allow full access via service key (server-side only).

---

## 4) Flows
### 4.1 Record Song Snippet (Web)
1) User taps **Record** → MediaRecorder starts (mono, 44.1k, opus/wav).  
2) Stop → show preview, duration; user adds optional title/tags/theme.  
3) Upload audio to Supabase Storage → receive `audio_path`.  
4) Call **`/api/transcribe`** (Netlify Function) with `audio_path` → Whisper → transcript.  
5) Save row in `song_snippets` with transcript + metadata.  
6) Show in **Lyric Book**; enable playback and edit.

### 4.2 Upload from iPhone Voice Memos
1) Tap **Upload** → choose `.m4a` file from device.  
2) Steps 3–6 as above.

### 4.3 General Note → To‑Dos
1) Record/upload as note → transcribe → save in `voice_notes`.  
2) Run lightweight task extraction (regex + optional AI) → create `todos`.  
3) Display checklist; allow manual add/edit/complete.

### 4.4 Calendar + ICS
1) CRUD events in app (recurrence optional).  
2) GET **`/api/ics`** returns RFC5545 feed (private token in URL).  
3) Family can subscribe read‑only to this ICS in their calendar apps.

---

## 5) Netlify Functions (API)
**Path prefix**: `/api/*`

### 5.1 POST `/api/transcribe`
- **Input**: `{{ audioPath: string, type: "song"|"note" }}`
- **Process**: fetch file from Supabase → call OpenAI Whisper → text → (optional) structure into sections.  
- **Output**: `{{ text, sections? }}`
- **Side‑effects**: function can also upsert DB row if you prefer server‑side writes.

_Skeleton (Node, TypeScript-ish):_
```js
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

export async function handler(event) {
  try {
    const { audioPath, type, userId } = JSON.parse(event.body || '{}')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    // get signed URL or download file buffer
    const { data: signed } = await supabase.storage.from('audio-uploads').createSignedUrl(audioPath, 60)
    const audioRes = await fetch(signed.signedUrl)
    const audioBuf = Buffer.from(await audioRes.arrayBuffer())

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const resp = await openai.audio.transcriptions.create({
      file: new File([audioBuf], 'audio.m4a', { type: 'audio/m4a' }),
      model: 'whisper-1', // or latest Whisper model id
      response_format: 'json'
    })

    const text = resp.text || ''
    // optional: simple verse/chorus heuristic or leave for manual edit

    return {
      statusCode: 200,
      body: JSON.stringify({ text })
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) }
  }
}
```

### 5.2 GET `/api/ics?token=...`
- **Auth**: token maps to userId (store a per-user secret).  
- **Output**: `text/calendar` ICS of upcoming events.  
_Skeleton:_
```js
export async function handler(event) {
  const token = event.queryStringParameters.token
  // lookup userId by token, query events, build ICS
  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CharlotteApp//EN',
    /* VEVENTs... */,'END:VCALENDAR'
  ].join('\\r\\n')
  return { statusCode: 200, headers: { 'Content-Type': 'text/calendar' }, body: ics }
}
```

### 5.3 POST `/api/extract-todos` (optional)
- **Input**: `{ text }`
- **Output**: `[ { text, due_at? } ]`
- **Impl**: simple regex + (optional) GPT call for refinement.

---

## 6) Front‑End (11ty) Structure
```
/src
  /_data
    quotes.json           # or fetched via Supabase at runtime
    site.json             # title, colours, links
  /includes
    layout.njk            # base layout
    nav.njk               # top nav / drawer
    card.njk, list.njk    # reusable bits
  /pages
    index.njk             # splash + quote
    recorder.njk          # song snippets recorder
    lyrics.njk            # lyric book
    notes.njk             # general notes + todos
    ideas.njk             # song ideas
    calendar.njk
    productivity.njk
    links.njk
    help.njk
  /assets
    /css                  # purple theme, variables
    /js
      supabase.js         # init client
      recorder.js         # MediaRecorder + upload
      lyrics.js           # search/sort UI
      notes.js            # todo extraction UI
      calendar.js         # timetable UI
      timer.js            # pomodoro
      quotes.js           # random quote picker
/netlify/functions        # api routes
```

### 6.1 Theme (Purple + Photos)
- Use CSS variables: `--bg`, `--bg-hero`, `--primary`, `--accent`, `--text`.
- Hero sections accept a rotating family photo (local `/assets/img/hero/*`).

### 6.2 Example: Nav (Nunjucks)
```njk
<nav class="nav">
  <a href="/">Home</a>
  <a href="/recorder/">Snippets</a>
  <a href="/lyrics/">Lyric Book</a>
  <a href="/notes/">Notes & To‑Dos</a>
  <a href="/ideas/">Ideas</a>
  <a href="/calendar/">Calendar</a>
  <a href="/productivity/">Productivity</a>
  <a href="/links/">Links</a>
  <a href="/help/">Help</a>
</nav>
```

### 6.3 Supabase Init (client)
```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
  window.supabase = createClient(
    '{{ env.SUPABASE_URL }}',
    '{{ env.SUPABASE_ANON_KEY }}'
  )
</script>
```

### 6.4 MediaRecorder (client sketch)
```js
let mediaRecorder, chunks=[]
async function startRec() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  mediaRecorder = new MediaRecorder(stream)
  mediaRecorder.ondataavailable = e => chunks.push(e.data)
  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'audio/webm' }) // or wav
    chunks = []
    // upload blob to Supabase Storage, then call /api/transcribe
  }
  mediaRecorder.start()
}
function stopRec(){ mediaRecorder?.stop() }
```

---

## 7) Search, Filter, Sort (Lyric Book)
- **Search**: client query → Supabase RPC/text search or client filter.
- **Filters**: by `theme`, by `tag`, by date range.
- **Sort**: newest, oldest, title A‑Z.
- **Display**: collapse/expand entries; show audio player per item.
- **Edit**: in‑place editing; save -> update `updated_at`.

---

## 8) Calendar UX
- **Views**: Week timetable (hour grid), Month grid, Today agenda.
- **Event form**: title, date/time, optional recurrence (RRULE text), colour, notes.
- **ICS**: one private tokenised URL for family read‑only view.
- **Reminders**: optional (later via push or rely on subscriber app).

---

## 9) Productivity
- **Pomodoro**: default 25/5 with configurable long break every 4 sessions.
- **Today View**: aggregates today’s events + due todos.
- **Manual Tasks**: quick add; satisfying check‑off animation.
- **Brain‑dump**: simple textarea that saves as a note (optional).

---

## 10) Quotes Engine
- **Source**: `/src/_data/quotes.json` or Supabase `quotes` table.
- **Display**: random on splash; “another quote” button.
- **Format**:
```json
[
  { "text": "When you put your mind to it, you can do anything.", "author": "Michelle Carter", "tags": ["motivation"] },
  { "text": "Different wiring, different superpowers.", "author": "—", "tags": ["adhd","self‑acceptance"] }
]
```

---

## 11) Auth & Security
- **Public vs Private**: keep private pages gated. Either:
  - Simple password gate (fastest) _or_
  - Supabase Auth (email/magic link). Recommended if multi‑device.
- **RLS** on all tables; service key only in Netlify Functions.
- **Env vars** only in Netlify dashboard; never commit secrets.

**Environment Variables**
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...            # client
SUPABASE_SERVICE_KEY=...         # server (functions only)
OPENAI_API_KEY=...               # functions only
ICS_TOKEN=...                    # per-user or static; store in DB if per-user
```

---

## 12) Dev & Deploy
- **Local dev**: `npm run dev` for 11ty; `netlify dev` to run functions locally.
- **Branching**: feature branches → PR → merge to main → Netlify build.
- **Supabase**: use SQL editor to run DDL; create storage bucket; set RLS policies.
- **Seeding**: add a few quotes, a sample event, and a test audio.

---

## 13) Testing & Acceptance
### 13.1 Acceptance Criteria (high‑level)
- Record, upload, and transcribe a 30–90s snippet; transcript visible in Lyric Book; playback works.
- Search returns snippets containing keyword; filter by theme works.
- Record a general note; at least one to‑do is extracted; can mark done.
- Add recurring class to calendar; visible in week + month; ICS renders in Apple/Google Calendar.
- Pomodoro counts down and signals break; settings persist (localStorage).

### 13.2 Test Plan
- **Devices**: iPhone Safari (recent iOS), Android Chrome, Desktop Chrome/Firefox/Safari.
- **Audio**: quiet vs noisy, speaking vs singing; upload `.m4a` from Voice Memos.
- **Offline**: attempt record without network → handle gracefully; queue upload if feasible.
- **Security**: private pages inaccessible without auth; direct file URLs require auth/signed URL.
- **ICS**: validate file with calendar clients; timezones correct (Europe/London).

---

## 14) iPhone Voice Memos vs Web Recorder (Guidance)
- **Quality**: Voice Memos (AAC ~96kbps) vs browser (Opus/WAV). Both adequate for Whisper.
- **Reliability**: native app is robust offline; web needs page open & upload path.
- **Workflow**: web is frictionless (auto‑transcribe); keep **Upload** to support native capture.
- **Recommendation**: default to web recorder; fall back to iPhone app + upload when needed.

---

## 15) Backlog / Nice‑to‑Haves
- AI “Lyric helper” (suggest next line/rhymes); AI summary of notes.
- Rich text lyric editor with version history.
- Tag management UI and colour-coded themes.
- Push notifications for Pomodoro/Calendar.
- Spotify “focus playlist” embed on Productivity page.
- Canvas API integration to surface upcoming assignments (if feasible).

---

## 16) Copy Guidelines (Help Page)
- Use short, friendly sentences.
- Max 5 bullets per section.
- Include tiny tips: recording best‑practice, how to search, how to share ICS.
- Reassure about privacy and that edits are non-destructive.

---

## 17) Example “How To” Snippets
**Recording a song idea**
1. Tap **Record** → sing/speak your idea.  
2. Tap **Stop** → name it and choose a theme.  
3. It uploads and transcribes automatically.  
4. Find it in **Lyric Book**; tap to play; edit lines if you like.

**Adding a class to your calendar**
1. Go to **Calendar** → **Add**.  
2. Enter title + start time; add **repeat** rule if weekly.  
3. Save. It will appear in Week & Month views.  
4. Want family to see it? Share the **Subscribe** link.

---

## 18) Minimal Styling Tokens
```css
:root{
  --bg:#0f0a1f; --panel:#1a1035; --primary:#7b5cff; --accent:#c6b4ff; --text:#f7f4ff;
  --ok:#44c08a; --warn:#f6b44d; --danger:#ff6b6b;
}
```

---

## 19) Risks & Mitigations
- **API failures** (Whisper/Supabase): show friendly retry; queue transcription.
- **Large audio**: cap duration (e.g., 5 min) and warn user.
- **Auth fatigue**: keep session; magic-link or simple gate.
- **Overwhelm**: progressive disclosure; keep pages focused.

---

## 20) Quick TODO (Dev Checklist)
- [ ] Create Supabase project: tables, RLS, storage bucket.
- [ ] Netlify site + env vars; scaffold functions (`transcribe`, `ics`).
- [ ] 11ty scaffolding; base layout; purple theme; nav.
- [ ] Recorder UI + upload + `/api/transcribe` integration.
- [ ] Lyric Book list + search/filter + playback + edit.
- [ ] Notes capture + to‑do extraction + checklist UI.
- [ ] Calendar CRUD + views + `/api/ics` feed.
- [ ] Productivity page (Pomodoro + Today view).
- [ ] Help page content + screenshots.
- [ ] Final accessibility & device tests.

---

## 21) License & Ownership
Private, personal project. All content belongs to Charlotte. Keep repository private unless instructed otherwise.
