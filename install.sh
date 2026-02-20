#!/bin/bash

# PRP Orchestrator Installation Script
# Run this once to install the orchestrator globally

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           PRP ORCHESTRATOR - INSTALLATION                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# CHECK PREREQUISITES
# ============================================================================

echo "Checking prerequisites..."
echo ""

# Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    echo "   Install from: https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js $(node --version)"

# npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "✅ npm $(npm --version)"

# Git
if ! command -v git &> /dev/null; then
    echo "❌ Git not found"
    echo "   Install from: https://git-scm.com/"
    exit 1
fi
echo "✅ Git $(git --version | cut -d' ' -f3)"

# GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found"
    echo "   Install from: https://cli.github.com/"
    exit 1
fi
echo "✅ GitHub CLI $(gh --version | head -1 | cut -d' ' -f3)"

# Check gh auth
if ! gh auth status &> /dev/null 2>&1; then
    echo ""
    echo "⚠️  GitHub CLI not authenticated"
    echo "   Run: gh auth login"
    echo ""
fi

# Claude Code CLI
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code CLI not found"
    echo "   Install with: npm install -g @anthropic-ai/claude-code"
    echo "   Then authenticate with your Claude subscription"
    exit 1
fi
echo "✅ Claude Code CLI found"

echo ""

# ============================================================================
# INSTALL DEPENDENCIES
# ============================================================================

echo "Installing dependencies..."
npm install
echo ""

# ============================================================================
# BUILD
# ============================================================================

echo "Building TypeScript..."
npm run build
echo ""

# ============================================================================
# LINK GLOBALLY
# ============================================================================

echo "Linking globally (may require sudo)..."
npm link 2>/dev/null || sudo npm link
echo ""

# ============================================================================
# INSTALL SKILLS
# ============================================================================

echo "Installing Claude Code skills..."
node dist/cli.js install-skills
echo ""

# ============================================================================
# VERIFY INSTALLATION
# ============================================================================

echo "Verifying installation..."
if command -v prp &> /dev/null; then
    echo "✅ 'prp' command is available"
else
    echo "⚠️  'prp' command not found in PATH"
    echo "   You may need to add npm global bin to your PATH"
    echo "   Try: export PATH=\"\$PATH:\$(npm bin -g)\""
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    INSTALLATION COMPLETE                       ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║                                                                ║"
echo "║  QUICK START                                                   ║"
echo "║  ───────────                                                   ║"
echo "║                                                                ║"
echo "║  1. Go to your project:                                        ║"
echo "║     cd /path/to/your/project                                   ║"
echo "║                                                                ║"
echo "║  2. Initialize:                                                ║"
echo "║     prp init                                                   ║"
echo "║                                                                ║"
echo "║  3. Edit the master plan:                                      ║"
echo "║     nano PRPs/master-plan.yaml                                 ║"
echo "║                                                                ║"
echo "║  4. Register the project:                                      ║"
echo "║     prp add myproject .                                        ║"
echo "║                                                                ║"
echo "║  5. Run the orchestrator:                                      ║"
echo "║     prp run                                                    ║"
echo "║                                                                ║"
echo "║  6. Set up cron for automation:                                ║"
echo "║     prp cron                                                   ║"
echo "║                                                                ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║                                                                ║"
echo "║  COMMANDS                                                      ║"
echo "║  ────────                                                      ║"
echo "║                                                                ║"
echo "║  prp run              Run for current directory                ║"
echo "║  prp run --all        Run for all registered projects          ║"
echo "║  prp run -p <path>    Run for specific project                 ║"
echo "║  prp add <n> <path>   Register a project                       ║"
echo "║  prp list             List registered projects                 ║"
echo "║  prp status           Show status of current project           ║"
echo "║  prp init             Create master-plan.yaml template         ║"
echo "║  prp cron             Show cron setup instructions             ║"
echo "║  prp --help           Show all commands                        ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
