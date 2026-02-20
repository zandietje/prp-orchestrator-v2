# PRP Orchestrator Installation Script for Windows
# Run this once to install the orchestrator globally

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗"
Write-Host "║           PRP ORCHESTRATOR - INSTALLATION                      ║"
Write-Host "╚════════════════════════════════════════════════════════════════╝"
Write-Host ""

# ============================================================================
# CHECK PREREQUISITES
# ============================================================================

Write-Host "Checking prerequisites..."
Write-Host ""

# Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js $nodeVersion"
} catch {
    Write-Host "❌ Node.js not found"
    Write-Host "   Install from: https://nodejs.org/"
    exit 1
}

# npm
try {
    $npmVersion = npm --version
    Write-Host "✅ npm $npmVersion"
} catch {
    Write-Host "❌ npm not found"
    exit 1
}

# Git
try {
    $gitVersion = git --version
    Write-Host "✅ $gitVersion"
} catch {
    Write-Host "❌ Git not found"
    Write-Host "   Install from: https://git-scm.com/"
    exit 1
}

# GitHub CLI
try {
    $ghVersion = gh --version | Select-Object -First 1
    Write-Host "✅ $ghVersion"
} catch {
    Write-Host "❌ GitHub CLI (gh) not found"
    Write-Host "   Install from: https://cli.github.com/"
    exit 1
}

# Check gh auth
try {
    gh auth status 2>&1 | Out-Null
} catch {
    Write-Host ""
    Write-Host "⚠️  GitHub CLI not authenticated"
    Write-Host "   Run: gh auth login"
    Write-Host ""
}

# Claude Code CLI
try {
    claude --version 2>&1 | Out-Null
    Write-Host "✅ Claude Code CLI found"
} catch {
    Write-Host "❌ Claude Code CLI not found"
    Write-Host "   Install with: npm install -g @anthropic-ai/claude-code"
    exit 1
}

Write-Host ""

# ============================================================================
# INSTALL DEPENDENCIES
# ============================================================================

Write-Host "Installing dependencies..."
npm install
Write-Host ""

# ============================================================================
# BUILD
# ============================================================================

Write-Host "Building TypeScript..."
npm run build
Write-Host ""

# ============================================================================
# LINK GLOBALLY
# ============================================================================

Write-Host "Linking globally..."
npm link
Write-Host ""

# ============================================================================
# INSTALL SKILLS
# ============================================================================

Write-Host "Installing Claude Code skills..."
node dist/cli.js install-skills
Write-Host ""

# ============================================================================
# VERIFY INSTALLATION
# ============================================================================

Write-Host "Verifying installation..."
try {
    prp --version | Out-Null
    Write-Host "✅ 'prp' command is available"
} catch {
    Write-Host "⚠️  'prp' command not found in PATH"
    Write-Host "   You may need to restart your terminal"
}

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗"
Write-Host "║                    INSTALLATION COMPLETE                       ║"
Write-Host "╠════════════════════════════════════════════════════════════════╣"
Write-Host "║                                                                ║"
Write-Host "║  QUICK START                                                   ║"
Write-Host "║  ───────────                                                   ║"
Write-Host "║                                                                ║"
Write-Host "║  1. Go to your project:                                        ║"
Write-Host "║     cd C:\path\to\your\project                                 ║"
Write-Host "║                                                                ║"
Write-Host "║  2. Initialize:                                                ║"
Write-Host "║     prp init                                                   ║"
Write-Host "║                                                                ║"
Write-Host "║  3. Edit the master plan:                                      ║"
Write-Host "║     notepad PRPs\master-plan.yaml                              ║"
Write-Host "║                                                                ║"
Write-Host "║  4. Register the project:                                      ║"
Write-Host "║     prp add myproject .                                        ║"
Write-Host "║                                                                ║"
Write-Host "║  5. Run the orchestrator:                                      ║"
Write-Host "║     prp run                                                    ║"
Write-Host "║                                                                ║"
Write-Host "║  6. Set up Task Scheduler:                                     ║"
Write-Host "║     prp cron                                                   ║"
Write-Host "║                                                                ║"
Write-Host "╚════════════════════════════════════════════════════════════════╝"
Write-Host ""
