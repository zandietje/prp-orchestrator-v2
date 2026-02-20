#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  addProject,
  removeProject,
  listProjects,
  getProjectContext,
  getEnabledProjects,
  loadGlobalConfig,
  saveGlobalConfig,
  enableProject,
  disableProject,
} from './config';
import { runProject, runAllProjects } from './orchestrator';
import { installSkillsToProject, checkProjectSkills, getProjectSkillsDir, listProjectSkills } from './skills';
import { log, getConfigDir, ensureDir } from './utils';

const program = new Command();

program
  .name('prp')
  .description('PRP Orchestrator - Automated development with Claude Code')
  .version('2.0.0');

// ============================================================================
// RUN COMMAND
// ============================================================================

program
  .command('run')
  .description('Run orchestration cycle')
  .option('-p, --project <path>', 'Run for a specific project path')
  .option('-a, --all', 'Run for all registered projects')
  .option('-w, --watch', 'Keep running continuously (check every 3 minutes)')
  .option('-i, --interval <minutes>', 'Check interval in minutes (default: 3)', '3')
  .action(async (options) => {
    const runOnce = async () => {
      console.log('');
      console.log('═'.repeat(60));
      console.log('  PRP Orchestrator');
      console.log(`  ${new Date().toISOString()}`);
      console.log('═'.repeat(60));

      if (options.project) {
        const ctx = getProjectContext(options.project);
        await runProject(ctx);
      } else if (options.all) {
        const projects = getEnabledProjects();
        await runAllProjects(projects);
      } else {
        const ctx = getProjectContext(process.cwd());
        await runProject(ctx);
      }

      console.log('');
      console.log('═'.repeat(60));
    };

    if (options.watch) {
      const intervalMinutes = parseInt(options.interval, 10) || 3;
      const intervalMs = intervalMinutes * 60 * 1000;

      console.log('');
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║  PRP Orchestrator - WATCH MODE                             ║');
      console.log(`║  Checking every ${intervalMinutes} minutes. Press Ctrl+C to stop.           ║`);
      console.log('╚════════════════════════════════════════════════════════════╝');

      // Run immediately
      await runOnce();

      // Then run on interval forever
      while (true) {
        console.log(`\n⏳ Waiting ${intervalMinutes} minutes before next check...\n`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        await runOnce();
      }
    } else {
      await runOnce();
    }
  });

// ============================================================================
// PROJECT MANAGEMENT
// ============================================================================

program
  .command('add <name> <path>')
  .description('Register a project')
  .action((name, projectPath) => {
    try {
      addProject(name, projectPath);
      log(`Added project: ${name}`, 'success');
      log(`Path: ${path.resolve(projectPath)}`);
    } catch (error: any) {
      log(error.message, 'error');
      process.exit(1);
    }
  });

program
  .command('remove <name-or-path>')
  .description('Remove a registered project')
  .action((nameOrPath) => {
    try {
      removeProject(nameOrPath);
      log('Project removed', 'success');
    } catch (error: any) {
      log(error.message, 'error');
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List registered projects')
  .action(() => {
    const projects = listProjects();

    if (projects.length === 0) {
      console.log('\nNo projects registered.\n');
      console.log('Add one with: prp add <name> <path>');
      console.log('');
      return;
    }

    console.log('\nRegistered Projects:\n');
    for (const p of projects) {
      const status = p.enabled ? '✅' : '⏸️ ';
      console.log(`  ${status} ${p.name}`);
      console.log(`     ${p.path}`);
    }
    console.log('');
  });

program
  .command('enable <name>')
  .description('Enable a project')
  .action((name) => {
    try {
      enableProject(name);
      log(`Enabled: ${name}`, 'success');
    } catch (error: any) {
      log(error.message, 'error');
      process.exit(1);
    }
  });

program
  .command('disable <name>')
  .description('Disable a project (skip during --all)')
  .action((name) => {
    try {
      disableProject(name);
      log(`Disabled: ${name}`, 'success');
    } catch (error: any) {
      log(error.message, 'error');
      process.exit(1);
    }
  });

// ============================================================================
// STATUS COMMAND
// ============================================================================

program
  .command('status [path]')
  .description('Show status of a project')
  .action(async (projectPath) => {
    const ctx = getProjectContext(projectPath || process.cwd());

    // Just run - it will show the status
    console.log('');
    await runProject(ctx);
    console.log('');
  });

// ============================================================================
// INIT COMMAND
// ============================================================================

program
  .command('init [path]')
  .description('Initialize a project with master-plan.yaml template')
  .action((projectPath = '.') => {
    const fullPath = path.resolve(projectPath);
    const prpDir = path.join(fullPath, 'PRPs');
    const masterFile = path.join(prpDir, 'master-plan.yaml');

    ensureDir(prpDir);
    ensureDir(path.join(prpDir, 'enriched'));

    if (fs.existsSync(masterFile)) {
      log('master-plan.yaml already exists', 'warn');
      return;
    }

    const template = `# Master Plan
# Define your feature and PRPs here
# Only edit this file - everything else is automatic!

name: My Feature

# Describe your project context - technologies, patterns, conventions
context: |
  This project uses [your tech stack].
  Follow existing patterns in the codebase.

# Global constraints applied to all PRPs
constraints:
  - Follow existing code patterns and conventions
  - Write unit tests for new functionality
  - Ensure all existing tests pass
  - Use descriptive variable and function names

# Define your PRPs (Problem Requirements Proposals)
# Each PRP is an atomic unit of work that results in one PR
prps:
  - id: PRP-001
    title: First Task
    scope: |
      Describe what this PRP should accomplish.
      Be specific about the requirements.
      Include any important details.
    acceptance_criteria:
      - First criterion that must be met
      - Second criterion that must be met
    files_to_create:
      - path: src/example.ts
        purpose: Description of what this file does
    files_to_modify:
      - path: src/index.ts
        changes: What changes are needed

  - id: PRP-002
    title: Second Task (depends on first)
    depends_on: [PRP-001]  # This waits for PRP-001 to be merged
    scope: |
      This task builds on the first task.
      It will only start after PRP-001 is merged.
    acceptance_criteria:
      - Criterion 1
      - Criterion 2

  # Add more PRPs as needed...
`;

    fs.writeFileSync(masterFile, template);
    log(`Created: ${masterFile}`, 'success');
    log('');
    log('Next steps:');
    log('1. Edit PRPs/master-plan.yaml with your requirements');
    log('2. Run: prp run');
    log('');
  });

// ============================================================================
// SKILLS COMMAND
// ============================================================================

program
  .command('install-skills [path]')
  .description('Install Claude Code skills to a project\'s .claude/commands/')
  .option('-f, --force', 'Overwrite existing skills')
  .action((projectPath, options) => {
    const targetPath = path.resolve(projectPath || '.');

    log(`Installing Claude Code skills to project...`, 'header');
    log(`Project: ${targetPath}`);
    console.log('');

    installSkillsToProject(targetPath, options.force || false);

    console.log('');
    log(`Skills directory: ${getProjectSkillsDir(targetPath)}`);
    log('');
    log('Skills are also auto-installed when running the orchestrator.');
    log('');
  });

program
  .command('check-skills [path]')
  .description('Check if required skills are installed in a project')
  .action((projectPath) => {
    const targetPath = path.resolve(projectPath || '.');
    const result = checkProjectSkills(targetPath);

    console.log('');
    log(`Project: ${targetPath}`);

    if (result.installed) {
      log('All required skills are installed', 'success');
    } else {
      log(`Missing skills: ${result.missing.join(', ')}`, 'error');
      log('Run: prp install-skills');
    }

    console.log('');
    log('Installed skills:');
    for (const skill of listProjectSkills(targetPath)) {
      console.log(`  - ${skill}`);
    }
    console.log('');
  });

// ============================================================================
// CONFIG COMMAND
// ============================================================================

program
  .command('config')
  .description('Show configuration')
  .action(() => {
    const config = loadGlobalConfig();

    console.log('');
    console.log('PRP Orchestrator Configuration');
    console.log('─'.repeat(40));
    console.log('');
    console.log(`Config directory: ${getConfigDir()}`);
    console.log(`Skills directory: <project>/.claude/commands/ (per-project)`);
    console.log('');
    console.log('Timeouts:');
    console.log(`  Enrichment: ${config.defaults.enrichmentTimeoutMinutes} minutes`);
    console.log(`  Execution:  ${config.defaults.executionTimeoutMinutes} minutes`);
    console.log(`  Revision:   ${config.defaults.revisionTimeoutMinutes} minutes`);
    console.log('');
    console.log(`Registered projects: ${config.projects.length}`);
    console.log('');
  });

// ============================================================================
// CRON COMMAND
// ============================================================================

program
  .command('cron')
  .description('Show cron setup instructions')
  .action(() => {
    const prpCmd = 'prp';

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                        CRON SETUP                              ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  The orchestrator should run every few minutes via cron.       ║
║  Each run checks state and performs ONE action, then exits.    ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║  LINUX/MAC                                                     ║
║  ─────────                                                     ║
║                                                                ║
║  Edit crontab:                                                 ║
║    crontab -e                                                  ║
║                                                                ║
║  Add this line (runs every 3 minutes):                         ║
║    */3 * * * * ${prpCmd} run --all >> /var/log/prp.log 2>&1
║                                                                ║
║  Or for a specific project:                                    ║
║    */3 * * * * ${prpCmd} run -p /path/to/project >> /var/log/prp.log 2>&1
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║  WINDOWS                                                       ║
║  ───────                                                       ║
║                                                                ║
║  Use Task Scheduler:                                           ║
║  1. Open Task Scheduler                                        ║
║  2. Create Basic Task                                          ║
║  3. Trigger: Daily, repeat every 3 minutes                     ║
║  4. Action: Start a program                                    ║
║     Program: cmd                                               ║
║     Arguments: /c ${prpCmd} run --all >> C:\\prp.log 2>&1
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║  MANUAL/TESTING                                                ║
║  ──────────────                                                ║
║                                                                ║
║  Run once:                                                     ║
║    ${prpCmd} run --all                                         ║
║                                                                ║
║  Watch mode (continuous):                                      ║
║    while true; do ${prpCmd} run --all; sleep 180; done         ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
  });

// ============================================================================
// HELP ADDITIONS
// ============================================================================

program.addHelpText('after', `

Examples:
  $ prp init                    Initialize current directory
  $ prp add myapp ./my-app      Register a project
  $ prp run                     Run for current directory
  $ prp run --all               Run for all registered projects
  $ prp run -p ./my-app         Run for specific project
  $ prp status                  Show current status
  $ prp install-skills          Install Claude Code skills
  $ prp cron                    Show cron setup instructions

Workflow:
  1. prp init                   Create master-plan.yaml
  2. Edit PRPs/master-plan.yaml Define your PRPs
  3. prp add myapp .            Register the project
  4. prp install-skills         Install Claude skills (once)
  5. Set up cron (prp cron)     Automate the orchestrator
  6. Review PRs when notified   That's all you do!
`);

// Parse and run
program.parse();
