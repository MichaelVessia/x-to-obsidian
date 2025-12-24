# X Bookmarks → Obsidian

Scrape X bookmarks and save them to Obsidian vault with intelligent categorization via Claude CLI.

## Architecture

```
┌─────────────────┐     POST        ┌──────────────────┐     spawn       ┌─────────────────┐
│ Chrome Extension│ ───────────────▶│ Bun + Effect     │ ───────────────▶│ claude CLI      │
│ (scrape X DOM)  │  /api/bookmarks │ (orchestrator)   │   (subprocess)  │ (uses your sub) │
└─────────────────┘                 └────────┬─────────┘                 └─────────────────┘
                                             │ fs write
                                             ▼
                                    ┌──────────────────┐
                                    │ Obsidian Vault   │
                                    │ ~/obsidian/...   │
                                    └──────────────────┘
```

## Tech Stack

- **Runtime**: Bun
- **Backend Framework**: Effect (services, error handling, schema validation)
- **LLM**: Claude CLI (spawned subprocess, uses existing subscription)
- **Extension**: Chrome Manifest V3, TypeScript
- **Monorepo**: Bun workspaces

## Project Structure

```
x-to-obsidian/
├── package.json              # workspace root
├── tsconfig.base.json
├── biome.json
│
├── packages/
│   ├── core/                 # shared types & schemas
│   │   ├── package.json
│   │   └── src/
│   │       ├── schema.ts     # Effect Schema definitions
│   │       └── index.ts
│   │
│   ├── server/               # Bun + Effect backend
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts      # entry point (Bun.serve)
│   │       ├── services/
│   │       │   ├── Claude.ts         # Claude CLI subprocess service
│   │       │   ├── BookmarkAnalyzer.ts  # analyze & categorize
│   │       │   └── ObsidianWriter.ts    # write markdown files
│   │       ├── routes/
│   │       │   └── bookmarks.ts      # POST /api/bookmarks
│   │       └── config.ts             # vault path, etc.
│   │
│   └── extension/            # Chrome extension
│       ├── manifest.json
│       ├── package.json
│       └── src/
│           ├── background.ts     # service worker
│           ├── content.ts        # injected into x.com
│           ├── popup/
│           │   ├── popup.html
│           │   └── popup.ts
│           └── scraper.ts        # DOM scraping logic
│
└── README.md
```

## Phase 1: Core & Server Foundation

### 1.1 Project Scaffold
- [x] Init monorepo with Bun workspaces
- [x] Setup tsconfig, biome
- [x] Create packages/core, packages/server, packages/extension

### 1.2 Core Package - Schemas
- [x] Define `RawBookmark` schema (what extension sends)
  ```typescript
  // What the extension scrapes from X DOM
  interface RawBookmark {
    tweetId: string
    tweetUrl: string
    authorHandle: string
    authorDisplayName: string
    text: string
    timestamp: string
    media: Array<{
      type: "image" | "video" | "gif"
      url: string
      alt?: string
    }>
    quotedTweet?: RawBookmark
    isThread: boolean
    threadTweets?: string[]  // if thread, the full text of each tweet
    links: Array<{
      url: string
      displayUrl: string
    }>
  }
  ```

- [x] Define `AnalyzedBookmark` schema (after Claude processing)
  ```typescript
  interface AnalyzedBookmark {
    raw: RawBookmark
    category: "thread" | "link" | "image" | "quote" | "standalone"
    suggestedPath: string        // e.g. "programming/typescript"
    tags: string[]               // for Obsidian frontmatter
    summary?: string             // Claude-generated summary
    extractedContent?: string    // if link, fetched article summary
  }
  ```

- [x] Define `ObsidianNote` schema (final output)
  ```typescript
  interface ObsidianNote {
    path: string                 // relative to vault root
    frontmatter: Record<string, unknown>
    content: string              // markdown body
  }
  ```

### 1.3 Server - Claude Service
- [x] Create `ClaudeService` Effect service
  ```typescript
  interface ClaudeService {
    analyze: (prompt: string) => Effect<string, ClaudeError>
  }
  ```
- [x] Implement subprocess spawn with `claude --print --output-format json`
- [x] Handle timeouts, parse JSON response
- [x] Add retry logic with Effect

### 1.4 Server - Bookmark Analyzer
- [x] Create `BookmarkAnalyzerService`
- [x] Build prompt template for Claude:
  - Classify bookmark type
  - Suggest folder path based on content
  - Generate tags
  - Summarize threads
  - For links: decide if we need to fetch content
- [x] Parse Claude's structured response

### 1.5 Server - Obsidian Writer
- [x] Create `ObsidianWriterService`
- [x] Configure vault path (env var or config file)
- [x] Generate markdown with YAML frontmatter
- [x] Handle file naming (slugify tweet text or use ID)
- [x] Create folders if needed
- [x] Handle duplicates (skip or update)

### 1.6 Server - HTTP Endpoint
- [x] Setup Bun.serve with Effect
- [x] `POST /api/bookmarks` - receive array of RawBookmark
- [x] Process each bookmark through pipeline
- [x] Return success/failure status per bookmark

## Phase 2: Chrome Extension

### 2.1 Extension Scaffold
- [x] Create manifest.json (Manifest V3)
- [x] Setup build with Bun (bundle for extension)
- [x] Permissions: `activeTab`, `storage`, host permission for x.com

### 2.2 Content Script - Scraper
- [x] Inject into x.com/i/bookmarks
- [x] Parse tweet DOM structure
  - Tweet text, author, timestamp
  - Media (images, videos)
  - Quoted tweets
  - External links
- [x] Detect threads (self-replies)
- [x] Handle infinite scroll / pagination

### 2.3 Popup UI
- [x] Simple popup with:
  - Server URL config (default localhost:3000)
  - "Scrape Current Page" button
  - "Scrape All Bookmarks" button (scroll + scrape)
  - Status/progress indicator

### 2.4 Background Service Worker
- [x] Receive scraped bookmarks from content script
- [x] POST to server endpoint
- [x] Handle response, show notification

## Phase 3: Enhancements

### 3.1 Link Expansion
- [ ] For bookmarks with links, optionally fetch & summarize the linked content
- [ ] Use Claude to extract key info from articles

### 3.2 Thread Handling
- [ ] Detect full threads
- [ ] Scrape all tweets in thread
- [ ] Combine into single note with proper formatting

### 3.3 Image Handling
- [ ] Option to download images locally to vault
- [ ] Or embed X image URLs (may break if tweet deleted)

### 3.4 Deduplication
- [ ] Track processed tweet IDs
- [ ] Skip already-processed bookmarks
- [ ] Option to re-process/update

### 3.5 Batch Processing
- [ ] Queue system for large bookmark collections
- [ ] Progress tracking
- [ ] Resume interrupted imports

## Configuration

```typescript
// server config
interface Config {
  vaultPath: string           // e.g. "/home/user/obsidian/vault"
  bookmarksFolder: string     // e.g. "bookmarks" or "twitter"
  claudeModel?: string        // optional model override
  claudeTimeout: number       // ms, default 30000
  downloadImages: boolean     // save images locally
  expandLinks: boolean        // fetch linked content
}
```

## Obsidian Note Template

```markdown
---
source: x/twitter
tweet_id: "1234567890"
author: "@username"
author_name: "Display Name"
date: 2024-01-15
url: https://x.com/username/status/1234567890
tags:
  - twitter
  - programming
  - typescript
category: thread
---

# Thread by @username

> Original tweet text here...

## Summary

Claude-generated summary of the thread content.

## Full Thread

1. First tweet in thread...
2. Second tweet...
3. ...

## Links

- [Article Title](https://example.com/article)

## Media

![[image-1234567890-1.jpg]]
```

## Open Questions

1. **X DOM stability** - X changes their DOM frequently. Need strategy for resilience.
2. **Rate limiting** - How many Claude calls per minute? May need throttling.
3. **Vault structure** - Flat vs nested folders? User preference?
4. **Existing notes** - Link to existing notes if topics match?

## Commands

```bash
# Development
bun install                    # install all workspaces
bun run --filter server dev    # start server with watch
bun run --filter extension build  # build extension

# Extension
# Load unpacked from packages/extension/dist in chrome://extensions
```

## Next Steps

1. ~~Create monorepo scaffold~~ Done
2. ~~Implement core schemas~~ Done
3. ~~Build Claude service + test with hardcoded bookmark~~ Done
4. ~~Build Obsidian writer + verify output~~ Done
5. ~~Build extension scraper~~ Done
6. ~~Wire it all together~~ Done
7. ~~Add placeholder icons to extension (16/48/128px)~~ Done
8. End-to-end test with real bookmarks
9. Phase 3 enhancements (link expansion, thread handling, etc.)
