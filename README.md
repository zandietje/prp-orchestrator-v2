# PRP Orchestrator v2

**Stateless, multi-project orchestrator for automated development with Claude Code.**

## What It Does

1. You define **PRPs** (Problem Requirements Proposals) in a YAML file
2. The orchestrator **automatically**:
   - Enriches PRPs with codebase research
   - Executes PRPs using Claude Code
   - Creates Pull Requests
   - Handles revision requests
   - Merges approved PRs
3. **You only review PRs** - that's it!

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  STATELESS DESIGN - No manifest files, no daemon                │
│                                                                 │
│  State is DERIVED from:                                         │
│  • Git branches → Has PRP been executed?                        │
│  • GitHub PRs → Is there an open PR? What's the review status?  │
│  • File system → Is PRP enriched?                               │
│                                                                 │
│  Benefits:                                                      │
│  • No state files to corrupt                                    │
│  • No recovery logic needed                                     │
│  • Just re-run if anything fails                                │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Clone or download this repository
cd prp-orchestrator-v2

# Linux/Mac
chmod +x install.sh
./install.sh

# Windows (PowerShell)
.\install.ps1
```

### Prerequisites

- Node.js 18+
- Git
- GitHub CLI (`gh`) - authenticated
- Claude Code CLI - with active subscription

## Quick Start

```bash
# 1. Initialize your project
cd /path/to/your/project
prp init

# 2. Edit the master plan
nano PRPs/master-plan.yaml

# 3. Register the project
prp add myproject .

# 4. Install Claude Code skills (once)
prp install-skills

# 5. Run!
prp run
```

## Commands

| Command | Description |
|---------|-------------|
| `prp run` | Run for current directory |
| `prp run --all` | Run for all registered projects |
| `prp run -p <path>` | Run for specific project |
| `prp add <name> <path>` | Register a project |
| `prp remove <name>` | Remove a project |
| `prp list` | List registered projects |
| `prp enable <name>` | Enable a project |
| `prp disable <name>` | Disable a project |
| `prp status` | Show project status |
| `prp init` | Create master-plan.yaml template |
| `prp install-skills` | Install Claude Code skills |
| `prp check-skills` | Verify skills are installed |
| `prp config` | Show configuration |
| `prp cron` | Show cron setup instructions |

## Master Plan Format

```yaml
# PRPs/master-plan.yaml

name: My Feature

context: |
  Project uses TypeScript, Express, PostgreSQL.
  Follow existing patterns in the codebase.

constraints:
  - Write unit tests for new code
  - Follow existing naming conventions
  - Ensure all tests pass

prps:
  - id: PRP-001
    title: Create User Model
    scope: |
      Create the User model with fields:
      - id, email, passwordHash, createdAt
    acceptance_criteria:
      - User model exists
      - Migration runs successfully
    files_to_create:
      - path: src/models/User.ts
        purpose: User model definition

  - id: PRP-002
    title: Add Authentication
    depends_on: [PRP-001]  # Waits for PRP-001 to be merged
    scope: |
      Implement JWT authentication.
    acceptance_criteria:
      - Login endpoint works
      - Tokens are validated
```

## Multi-Project Setup

```bash
# Register multiple projects
prp add frontend ~/projects/frontend
prp add backend ~/projects/backend
prp add mobile ~/projects/mobile

# Run all at once
prp run --all

# Or set up cron
crontab -e
*/3 * * * * prp run --all >> /var/log/prp.log 2>&1
```

## How the Cron Works

```
Every 3 minutes, cron triggers:

┌──────────────────────────────────────────────────────┐
│ prp run --all                                        │
├──────────────────────────────────────────────────────┤
│                                                      │
│ For each project:                                    │
│   1. Acquire lock (skip if already running)          │
│   2. Derive state from git/GitHub                    │
│   3. Take ONE action:                                │
│      - Merge approved PR, OR                         │
│      - Run revision, OR                              │
│      - Enrich next PRP, OR                           │
│      - Execute next PRP                              │
│   4. Release lock                                    │
│                                                      │
│ Each run: ~seconds to ~20 minutes                    │
│ Lock prevents overlapping runs                       │
└──────────────────────────────────────────────────────┘
```

## PR Review Guide

When you get a PR notification:

| Your Action | What Happens |
|-------------|--------------|
| ✅ **Approve** | PR auto-merges, next PRP starts |
| 🔧 **Request Changes** | Claude reads feedback, pushes fixes |
| 💬 **Comment only** | Nothing automatic |

**Important:** Use "Request Changes" (not just "Comment") to trigger automatic revisions.

## Troubleshooting

### Skills not found
```bash
prp install-skills --force
```

### Project not running
```bash
# Check status
prp status

# Check if lock file is stale
ls -la /path/to/project/.prp-lock
rm /path/to/project/.prp-lock  # Remove if stale
```

### GitHub auth issues
```bash
gh auth status
gh auth login
```

## Directory Structure

```
~/.prp-orchestrator/           # Global config
└── config.yaml                # Registered projects, timeouts

your-project/
├── .claude/
│   └── commands/              # Claude Code skills (auto-installed)
│       ├── execute-prp.md
│       ├── generate-prp.md
│       └── verify-prp.md
├── PRPs/
│   ├── master-plan.yaml       # Your feature definition
│   └── enriched/              # Auto-generated detailed PRPs
└── .prp-lock                  # Lock file (auto-managed)
```

## How It Differs from v1

| Aspect | v1 | v2 |
|--------|----|----|
| State storage | Manifest JSON files | Derived from git/GitHub |
| Architecture | Daemon with polling | Stateless cron jobs |
| Recovery | Complex repair logic | Just re-run |
| Multi-project | Built into project | Standalone, manages many |
| Code size | ~3000 lines | ~1000 lines |
| Installation | Per-project | Global, once |

## License

MIT
