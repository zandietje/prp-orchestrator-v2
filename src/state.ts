import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { MasterPlan, PRPState, ProjectContext } from './types';
import { exec, log, safeJsonParse } from './utils';
import { getBotCredentials } from './config';

/**
 * Run gh command with bot token if available
 */
function ghExec(command: string, options: { cwd: string; silent?: boolean }): string {
  const bot = getBotCredentials();
  if (bot) {
    process.env.GH_TOKEN = bot.token;
  }
  return exec(command, options);
}

/**
 * Load master plan from project
 */
export function loadMasterPlan(ctx: ProjectContext): MasterPlan | null {
  if (!fs.existsSync(ctx.masterFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(ctx.masterFile, 'utf-8');
    return yaml.parse(content) as MasterPlan;
  } catch (error) {
    log(`Failed to parse master plan: ${error}`, 'error');
    return null;
  }
}

/**
 * Derive the current state of a single PRP from git/GitHub
 * No manifest files - state is computed fresh each time
 */
export async function derivePRPState(
  prp: MasterPlan['prps'][0],
  ctx: ProjectContext
): Promise<PRPState> {
  const state: PRPState = {
    id: prp.id,
    title: prp.title,
    scope: prp.scope,
    dependsOn: prp.depends_on || [],
    masterPrp: prp,
    isEnriched: false,
  };

  // Check if enriched file exists
  const enrichedFile = path.join(ctx.enrichedDir, `${prp.id}.md`);
  if (fs.existsSync(enrichedFile)) {
    state.isEnriched = true;
    state.enrichedFile = enrichedFile;
  }

  // Check for existing branch
  const branchPrefix = `auto/${prp.id.toLowerCase()}-`;
  try {
    const branches = exec(
      `git branch -r --list "origin/${branchPrefix}*"`,
      { cwd: ctx.path, silent: true }
    );
    if (branches) {
      // Get first matching branch
      state.branch = branches.split('\n')[0].trim().replace('origin/', '');
    }
  } catch {
    // No branch found
  }

  // Check for PR if we have a branch
  if (state.branch) {
    try {
      const prJson = ghExec(
        `gh pr list --head "${state.branch}" --json number,state,reviewDecision,labels --limit 1`,
        { cwd: ctx.path, silent: true }
      );
      const prs = safeJsonParse<any[]>(prJson, []);

      if (prs.length > 0) {
        state.prNumber = prs[0].number;
        state.prState = prs[0].state.toLowerCase() as 'open' | 'merged' | 'closed';

        // Check labels first (for self-review workflow)
        const labels = (prs[0].labels || []).map((l: any) => l.name.toLowerCase());
        if (labels.includes('approved') || labels.includes('lgtm')) {
          state.reviewState = 'approved';
        } else if (labels.includes('changes-requested') || labels.includes('needs-changes')) {
          state.reviewState = 'changes_requested';
        } else {
          // Fall back to review decision (for external reviewers)
          const decision = prs[0].reviewDecision?.toUpperCase();
          if (decision === 'APPROVED') {
            state.reviewState = 'approved';
          } else if (decision === 'CHANGES_REQUESTED') {
            state.reviewState = 'changes_requested';
          } else if (decision === 'REVIEW_REQUIRED') {
            state.reviewState = 'pending';
          } else {
            state.reviewState = 'none';
          }
        }
      }
    } catch {
      // PR check failed
    }
  }

  // Check for merged PR (branch might have been deleted)
  if (!state.prNumber) {
    try {
      const mergedJson = ghExec(
        `gh pr list --search "head:${branchPrefix}" --state merged --json number --limit 1`,
        { cwd: ctx.path, silent: true }
      );
      const merged = safeJsonParse<any[]>(mergedJson, []);

      if (merged.length > 0) {
        state.prNumber = merged[0].number;
        state.prState = 'merged';
      }
    } catch {
      // Merged PR check failed
    }
  }

  return state;
}

/**
 * Derive state for all PRPs in a master plan
 */
export async function deriveAllStates(
  master: MasterPlan,
  ctx: ProjectContext
): Promise<PRPState[]> {
  const states: PRPState[] = [];

  for (const prp of master.prps) {
    const state = await derivePRPState(prp, ctx);
    states.push(state);

    // Display status
    let status: string;
    if (state.prState === 'merged') {
      status = '✅ merged';
    } else if (state.prState === 'open') {
      const icons: Record<string, string> = {
        approved: '👍',
        changes_requested: '🔧',
        pending: '⏳',
        none: '👀',
      };
      const icon = icons[state.reviewState || 'none'];
      status = `PR #${state.prNumber} ${icon} ${state.reviewState}`;
    } else if (state.isEnriched) {
      status = '📝 ready to execute';
    } else {
      status = '⏳ pending enrichment';
    }

    log(`${prp.id}: ${status}`);
  }

  return states;
}

/**
 * Check if all PRPs are complete (merged)
 */
export function isComplete(states: PRPState[]): boolean {
  return states.every((s) => s.prState === 'merged');
}

/**
 * Get IDs of all merged PRPs (including pre-completed ones from master plan)
 */
export function getMergedIds(states: PRPState[], completed?: string[]): Set<string> {
  const merged = new Set(
    states.filter((s) => s.prState === 'merged').map((s) => s.id)
  );

  // Add pre-completed PRPs from master plan
  if (completed) {
    for (const id of completed) {
      merged.add(id);
    }
  }

  return merged;
}

/**
 * Find the next PRP that is ready to work on
 */
export function findNextPRP(states: PRPState[], completed?: string[]): PRPState | null {
  const mergedIds = getMergedIds(states, completed);

  return (
    states.find((s) => {
      // Skip if already has PR or is merged
      if (s.prState === 'merged' || s.prState === 'open') return false;

      // Check all dependencies are met
      return s.dependsOn.every((dep) => mergedIds.has(dep));
    }) || null
  );
}

/**
 * Find a PRP with approved PR (ready to merge)
 */
export function findApprovedPRP(states: PRPState[]): PRPState | null {
  return (
    states.find(
      (s) => s.prState === 'open' && s.reviewState === 'approved'
    ) || null
  );
}

/**
 * Find a PRP with changes requested (needs revision)
 */
export function findChangesRequestedPRP(states: PRPState[]): PRPState | null {
  return (
    states.find(
      (s) => s.prState === 'open' && s.reviewState === 'changes_requested'
    ) || null
  );
}

/**
 * Find a PRP with pending review
 */
export function findPendingReviewPRP(states: PRPState[]): PRPState | null {
  return (
    states.find(
      (s) =>
        s.prState === 'open' &&
        (s.reviewState === 'pending' || s.reviewState === 'none')
    ) || null
  );
}
