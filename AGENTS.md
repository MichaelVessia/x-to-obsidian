# X Bookmarks to Obsidian

Export X/Twitter bookmarks to Obsidian with AI-powered categorization.

## Architecture

```
┌──────────────────┐     POST /api/bookmarks    ┌──────────────────┐
│ Chrome Extension │ ────────────────────────▶  │   Bun Server     │
│                  │                            │   (Effect-TS)    │
│ - Scrapes DOM    │  ◀────────────────────────  │                  │
│ - Popup UI       │     { results: [...] }     │ ┌──────────────┐ │
└──────────────────┘                            │ │ LLM Service  │ │
        │                                       │ │ Claude/Gemini│ │
        │ injected into                         │ └──────┬───────┘ │
        v                                       │        │         │
┌──────────────────┐                            │        v         │
│  x.com/i/        │                            │ ┌──────────────┐ │
│  bookmarks       │                            │ │ Analyzer     │ │
└──────────────────┘                            │ │ tags/category│ │
                                                │ └──────┬───────┘ │
                                                │        │         │
                                                │        v         │
                                                │ ┌──────────────┐ │
                                                │ │ Writer       │ │
                                                │ │ → vault/*.md │ │
                                                │ └──────────────┘ │
                                                └──────────────────┘
                                                         │
                                                         v
                                                ┌──────────────────┐
                                                │  Obsidian Vault  │
                                                │  Bookmarks/*.md  │
                                                └──────────────────┘
```

## Tech Stack

- **Runtime**: Bun
- **Backend**: Effect-TS (services, schemas, error handling)
- **LLM**: @effect/ai with Anthropic (Claude) or Google (Gemini)
- **Extension**: Chrome Manifest V3, TypeScript
- **Monorepo**: Bun workspaces

## Project Structure

```
packages/
├── core/           # Shared Effect schemas (RawBookmark, AnalyzedBookmark, ObsidianNote)
├── server/         # Bun HTTP server
│   └── services/
│       ├── LLM.ts              # Claude/Gemini abstraction
│       ├── BookmarkAnalyzer.ts # Prompt & response parsing
│       └── ObsidianWriter.ts   # Markdown generation
└── extension/      # Chrome extension (content script, popup, background)
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/schema.ts` | Effect schemas for bookmark data |
| `packages/server/src/index.ts` | HTTP server entry point |
| `packages/server/src/services/LLM.ts` | LLM provider abstraction |
| `packages/server/src/services/BookmarkAnalyzer.ts` | Builds prompts, parses LLM responses |
| `packages/server/src/services/ObsidianWriter.ts` | Generates markdown, handles dedup |
| `packages/extension/src/content.ts` | DOM scraper for X bookmarks |
| `packages/extension/src/popup/popup.ts` | Extension popup UI |

## Environment Variables

```bash
VAULT_PATH=/path/to/vault       # Required: Obsidian vault path
LLM_PROVIDER=google             # "google" or "anthropic"
GOOGLE_API_KEY=xxx              # If using Gemini
ANTHROPIC_API_KEY=xxx           # If using Claude
BOOKMARKS_FOLDER=Bookmarks      # Folder within vault
PORT=3000                       # Server port
```

## Commands

```bash
bun install                                    # Install dependencies
bun run dev                                    # Start server
bun run --filter @x-to-obsidian/extension build  # Build extension
bun run typecheck                              # Type check all packages
bun run lint                                   # Lint with oxlint
```

## Data Flow

1. Extension scrapes visible tweets from x.com/i/bookmarks
2. Sends `RawBookmark[]` to server via POST /api/bookmarks
3. Server checks dedup cache (skips existing tweets)
4. LLM analyzes each bookmark → category, tags, summary
5. Writer generates markdown with YAML frontmatter
6. File written to vault, tweet ID cached
7. Results returned to extension

## Output Format

```markdown
---
category:
  - "[[Bookmarks]]"
tags:
  - bookmarks
  - twitter
author:
  - "[[Author Name]]"
url: https://x.com/user/status/123
topics:
  - "[[Topic 1]]"
  - "[[Topic 2]]"
tweet_id: "123"
bookmark_type: standalone
---

# Tweet by @username

> Tweet content...

## Summary

LLM-generated summary.
```
