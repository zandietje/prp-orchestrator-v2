import { MasterPlan, PRPState, ProjectContext } from './types';
import { loadMasterPlan, deriveAllStates, findApprovedPRP, findChangesRequestedPRP, findPendingReviewPRP, findNextPRP, isComplete } from './state';
import { mergeApprovedPR, runRevision, enrichPRP, executePRP } from './actions';
import { acquireLock, releaseLock, log, exec, getDefaultBranch } from './utils';
import { ensureProjectSkills } from './skills';

/**
 * Run orchestration for a single project
 */
export async function runProject(ctx: ProjectContext): Promise<void> {
  log(`Project: ${ctx.name}`, 'header');
  log(`Path: ${ctx.path}`);

  // Check prerequisites
  const prereqResult = checkPrerequisites(ctx);
  if (!prereqResult.ok) {
    log(prereqResult.error!, 'error');
    return;
  }

  // Acquire lock
  if (!acquireLock(ctx.lockFile)) {
    log('Another instance is running for this project', 'warn');
    return;
  }

  try {
    await runOrchestration(ctx);
  } catch (error: any) {
    log(`Error: ${error.message}`, 'error');
  } finally {
    releaseLock(ctx.lockFile);
  }
}

/**
 * Check all prerequisites before running
 */
function checkPrerequisites(ctx: ProjectContext): { ok: boolean; error?: string } {
  // Ensure skills are installed in the project (auto-install if missing)
  ensureProjectSkills(ctx.path);

  // Check gh auth
  try {
    exec('gh auth status', { cwd: ctx.path, silent: true });
  } catch {
    return {
      ok: false,
      error: 'GitHub CLI not authenticated. Run: gh auth login',
    };
  }

  // Check git repo
  try {
    exec('git status', { cwd: ctx.path, silent: true });
  } catch {
    return {
      ok: false,
      error: 'Not a git repository',
    };
  }

  return { ok: true };
}

/**
 * Main orchestration logic
 * Keeps running until it needs human input (PR review) or completes
 */
async function runOrchestration(ctx: ProjectContext): Promise<void> {
  // Load master plan
  const master = loadMasterPlan(ctx);
  if (!master) {
    log('No master-plan.yaml found', 'warn');
    log(`Expected at: ${ctx.masterFile}`);
    return;
  }

  log(`Feature: ${master.name}`);
  log(`PRPs: ${master.prps.length}`);
  console.log('');

  // Ensure we're on default branch and up to date
  const defaultBranch = getDefaultBranch(ctx.path);
  try {
    exec(`git checkout ${defaultBranch}`, { cwd: ctx.path, silent: true });
    exec('git pull', { cwd: ctx.path, silent: true });
  } catch {
    // May fail if already on default branch or no upstream
  }

  // Keep running until we need human input
  while (true) {
    // Derive current state for all PRPs
    const states = await deriveAllStates(master, ctx);
    console.log('');

    // Check if complete
    if (isComplete(states)) {
      log('All PRPs have been merged! Feature complete.', 'success');
      return;
    }

    // Execute the next action - returns true if we should continue
    const shouldContinue = await executeNextAction(states, master, ctx);

    if (!shouldContinue) {
      // Waiting for human input (PR review) or no work to do
      return;
    }

    // Small delay between actions
    log('Continuing to next action...', 'info');
    console.log('');
  }
}

/**
 * Determine and execute the next action
 * Returns true if orchestrator should continue, false if waiting for human input
 */
async function executeNextAction(
  states: PRPState[],
  master: MasterPlan,
  ctx: ProjectContext
): Promise<boolean> {
  // Priority 1: Merge any approved PRs
  const approved = findApprovedPRP(states);
  if (approved) {
    log(`Found approved PR #${approved.prNumber} for ${approved.id}`, 'info');
    await mergeApprovedPR(approved, ctx);
    return true; // Continue - check for more work
  }

  // Priority 2: Handle revision requests
  const changesRequested = findChangesRequestedPRP(states);
  if (changesRequested) {
    log(`Found changes requested on PR #${changesRequested.prNumber} for ${changesRequested.id}`, 'info');
    await runRevision(changesRequested, ctx);
    return false; // Stop - wait for human to review the revision
  }

  // Priority 3: Wait if any PR is pending review
  const pendingReview = findPendingReviewPRP(states);
  if (pendingReview) {
    log(`Waiting for review on PR #${pendingReview.prNumber} (${pendingReview.id})`);
    log(`Review at: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/pull/${pendingReview.prNumber}`);
    return false; // Stop - waiting for human review
  }

  // Priority 4: Find next PRP to work on
  const nextPRP = findNextPRP(states, master.completed);
  if (!nextPRP) {
    log('No PRPs ready (waiting for dependencies to be merged)');
    return false; // Stop - nothing to do
  }

  // Enrich if needed, then execute
  if (!nextPRP.isEnriched) {
    log(`Next: Enrich ${nextPRP.id}`, 'info');
    await enrichPRP(nextPRP, master, ctx);
    return true; // Continue - now execute it
  } else {
    log(`Next: Execute ${nextPRP.id}`, 'info');
    await executePRP(nextPRP, ctx);
    return false; // Stop - PR created, wait for review
  }
}

/**
 * Run orchestration for all enabled projects
 */
export async function runAllProjects(projects: ProjectContext[]): Promise<void> {
  if (projects.length === 0) {
    log('No projects registered', 'warn');
    log('Add a project with: prp add <name> <path>');
    return;
  }

  for (const ctx of projects) {
    await runProject(ctx);
  }
}
