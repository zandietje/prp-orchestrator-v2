import * as fs from 'fs';
import * as path from 'path';
import { MasterPlan, PRPState, ProjectContext, ValidationResult } from './types';
import { exec, runClaude, log, ensureDir, getDefaultBranch } from './utils';
import { getTimeouts, getBotCredentials } from './config';

/**
 * Run a command with bot credentials (for git/gh operations)
 */
function execWithBot(
  command: string,
  options: { cwd: string; silent?: boolean }
): string {
  const bot = getBotCredentials();
  if (bot) {
    // Set GH_TOKEN for gh CLI
    process.env.GH_TOKEN = bot.token;
  }
  return exec(command, options);
}

/**
 * Configure git to use bot credentials for a repo
 */
function configureGitBot(cwd: string): void {
  const bot = getBotCredentials();
  if (!bot) return;

  // Set bot as committer
  exec(`git config user.name "${bot.username}"`, { cwd, silent: true });
  exec(`git config user.email "${bot.username}@users.noreply.github.com"`, { cwd, silent: true });

  // Update remote URL to include token for push
  try {
    const remoteUrl = exec('git remote get-url origin', { cwd, silent: true });
    if (remoteUrl.includes('github.com') && !remoteUrl.includes('@')) {
      const newUrl = remoteUrl.replace(
        'https://github.com/',
        `https://${bot.username}:${bot.token}@github.com/`
      );
      exec(`git remote set-url origin "${newUrl}"`, { cwd, silent: true });
    }
  } catch {
    // Ignore remote URL errors
  }
}

// ============================================================================
// MERGE
// ============================================================================

/**
 * Merge an approved PR
 */
export async function mergeApprovedPR(
  prp: PRPState,
  ctx: ProjectContext
): Promise<void> {
  log(`Merging PR #${prp.prNumber}...`, 'success');

  try {
    execWithBot(`gh pr merge ${prp.prNumber} --squash --delete-branch`, {
      cwd: ctx.path,
    });
    log(`PR #${prp.prNumber} merged successfully`, 'success');
  } catch (error: any) {
    log(`Failed to merge PR: ${error.message}`, 'error');
    throw error;
  }
}

// ============================================================================
// REVISION
// ============================================================================

/**
 * Run a revision based on review feedback
 */
export async function runRevision(
  prp: PRPState,
  ctx: ProjectContext
): Promise<void> {
  log(`Running revision for PR #${prp.prNumber}...`);

  // Configure git to use bot credentials
  configureGitBot(ctx.path);

  // Collect all feedback
  const feedbackJson = exec(
    `gh pr view ${prp.prNumber} --json reviews,comments`,
    { cwd: ctx.path }
  );
  const prData = JSON.parse(feedbackJson);

  // Get review comments (the "Request Changes" reviews)
  const reviewFeedback =
    prData.reviews
      ?.filter((r: any) => r.state === 'CHANGES_REQUESTED')
      .map((r: any) => r.body || '')
      .filter(Boolean)
      .join('\n\n') || '';

  // Get inline comments
  let inlineComments = '';
  try {
    inlineComments = exec(
      `gh api repos/{owner}/{repo}/pulls/${prp.prNumber}/comments --jq '.[] | "- **\\(.path):\\(.line // .original_line)**: \\(.body)"'`,
      { cwd: ctx.path, silent: true }
    );
  } catch {
    // No inline comments
  }

  // Get general PR comments
  const prComments =
    prData.comments?.map((c: any) => `- ${c.body}`).join('\n') || '';

  const allFeedback = [
    reviewFeedback ? `## Review Feedback\n${reviewFeedback}` : '',
    inlineComments ? `## Inline Comments\n${inlineComments}` : '',
    prComments ? `## Discussion\n${prComments}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!allFeedback.trim()) {
    log('No feedback found - cannot run revision', 'warn');
    return;
  }

  // Checkout branch
  exec('git fetch origin', { cwd: ctx.path });
  exec(`git checkout ${prp.branch}`, { cwd: ctx.path });

  try {
    exec(`git pull origin ${prp.branch}`, { cwd: ctx.path, silent: true });
  } catch {
    // Pull might fail if no upstream
  }

  // Write feedback to temp file
  const feedbackFile = path.join(ctx.path, '.prp-revision-feedback.md');
  fs.writeFileSync(
    feedbackFile,
    `# Revision Required for ${prp.id}

${allFeedback}

## Instructions

1. Read ALL feedback carefully
2. Address EVERY point mentioned
3. Focus ONLY on the requested changes
4. Do not refactor or change unrelated code
5. Ensure tests still pass

## Original PRP

The original requirements are in: ${prp.enrichedFile}
`
  );

  log('Running Claude Code for revision...');

  const timeouts = getTimeouts();
  const result = await runClaude(
    `Read the revision feedback at "${feedbackFile}" and address all the requested changes. The original PRP is at "${prp.enrichedFile}". Focus ONLY on addressing the feedback - do not make unrelated changes.`,
    ctx.path,
    timeouts.revision
  );

  // Cleanup temp file
  try {
    fs.unlinkSync(feedbackFile);
  } catch {}

  if (!result.success) {
    log('Revision execution failed', 'error');
    exec(`git checkout ${getDefaultBranch(ctx.path)}`, { cwd: ctx.path });
    throw new Error('Revision failed');
  }

  // Commit and push (exclude Windows reserved filenames)
  exec('git add .', { cwd: ctx.path });
  const hasChanges = exec('git status --porcelain', {
    cwd: ctx.path,
    silent: true,
  });

  if (hasChanges) {
    exec('git commit -m "fix: Address review feedback"', { cwd: ctx.path });
    exec(`git push origin ${prp.branch}`, { cwd: ctx.path });

    // Add comment to PR
    exec(
      `gh pr comment ${prp.prNumber} --body "🤖 Revision pushed addressing the feedback. Please review again."`,
      { cwd: ctx.path }
    );

    log('Revision pushed - PR updated', 'success');
  } else {
    log('No changes made during revision', 'warn');
  }

  // Return to main branch
  exec(`git checkout ${getDefaultBranch(ctx.path)}`, { cwd: ctx.path });
}

// ============================================================================
// ENRICH
// ============================================================================

/**
 * Enrich a PRP using /generate-prp skill
 */
export async function enrichPRP(
  prp: PRPState,
  master: MasterPlan,
  ctx: ProjectContext
): Promise<void> {
  log(`Enriching ${prp.id}: ${prp.title}...`);

  // Configure git to use bot credentials
  configureGitBot(ctx.path);

  ensureDir(ctx.enrichedDir);

  // Build initial PRP content
  const initialContent = buildInitialPRP(prp.masterPrp, master);
  const initialFile = path.join(ctx.path, `.prp-initial-${prp.id}.md`);
  fs.writeFileSync(initialFile, initialContent);

  log('Running /generate-prp skill (10-20 min)...');

  const timeouts = getTimeouts();
  const result = await runClaude(
    `/generate-prp "${initialFile}"`,
    ctx.path,
    timeouts.enrichment
  );

  // Cleanup initial file
  try {
    fs.unlinkSync(initialFile);
  } catch {}

  if (!result.success) {
    log('Enrichment failed', 'error');
    throw new Error('Enrichment failed');
  }

  // Find the generated file
  const generatedFile = findGeneratedPRP(prp.id, ctx.path);

  if (!generatedFile) {
    log('Could not find generated PRP file', 'error');
    throw new Error('Generated PRP file not found');
  }

  // Move to enriched directory (if not already there)
  const enrichedFile = path.join(ctx.enrichedDir, `${prp.id}.md`);
  if (generatedFile !== enrichedFile) {
    ensureDir(ctx.enrichedDir);
    fs.renameSync(generatedFile, enrichedFile);
  }

  log(`Saved enriched PRP: ${enrichedFile}`, 'success');

  // Commit the enriched file to main branch
  exec(`git add "${ctx.enrichedDir}"`, { cwd: ctx.path });
  exec(`git commit -m "chore(prp): Enrich ${prp.id}"`, { cwd: ctx.path });
  exec('git push', { cwd: ctx.path });

  log('Enriched PRP committed to main branch', 'success');
}

/**
 * Build initial PRP content for enrichment
 */
function buildInitialPRP(prp: MasterPlan['prps'][0], master: MasterPlan): string {
  const sections: string[] = [
    `# ${prp.id} - ${prp.title}`,
    '',
    '## FEATURE:',
    '',
    '### Goal',
    prp.scope,
    '',
  ];

  if (master.context) {
    sections.push('### Project Context', master.context, '');
  }

  if (prp.depends_on?.length) {
    sections.push(
      '### Dependencies',
      prp.depends_on.map((d) => `- ${d} must be completed first`).join('\n'),
      ''
    );
  }

  if (prp.files_to_create?.length) {
    sections.push(
      '### Files to Create',
      prp.files_to_create.map((f) => `- \`${f.path}\`: ${f.purpose}`).join('\n'),
      ''
    );
  }

  if (prp.files_to_modify?.length) {
    sections.push(
      '### Files to Modify',
      prp.files_to_modify.map((f) => `- \`${f.path}\`: ${f.changes}`).join('\n'),
      ''
    );
  }

  if (prp.acceptance_criteria?.length) {
    sections.push(
      '### Acceptance Criteria',
      prp.acceptance_criteria.map((c) => `- [ ] ${c}`).join('\n'),
      ''
    );
  }

  if (prp.tests_required?.length) {
    sections.push(
      '### Tests Required',
      prp.tests_required.map((t) => `- ${t}`).join('\n'),
      ''
    );
  }

  if (master.constraints?.length) {
    sections.push(
      '## CONSTRAINTS:',
      master.constraints.map((c) => `- ${c}`).join('\n'),
      ''
    );
  }

  if (prp.notes) {
    sections.push('## NOTES:', prp.notes, '');
  }

  sections.push(
    '## DOCUMENTATION:',
    '',
    'Search the codebase for similar patterns and follow existing conventions.',
    'Reference existing implementations for consistency.',
    ''
  );

  return sections.join('\n');
}

/**
 * Find the generated PRP file after enrichment
 */
function findGeneratedPRP(prpId: string, projectPath: string): string | null {
  const searchDirs = ['PRPs/enriched', 'PRPs', 'PRPs/generated', '.'];
  const patterns = [
    `${prpId}.md`,
    `${prpId}-ENRICHED.md`,
    `${prpId}-enriched.md`,
  ];

  // First try exact matches
  for (const dir of searchDirs) {
    const fullDir = path.join(projectPath, dir);
    if (!fs.existsSync(fullDir)) continue;

    for (const pattern of patterns) {
      const filePath = path.join(fullDir, pattern);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }

  // Fall back to finding by modification time
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const dir of searchDirs) {
    const fullDir = path.join(projectPath, dir);
    if (!fs.existsSync(fullDir)) continue;

    try {
      const files = fs
        .readdirSync(fullDir)
        .filter((f) => f.endsWith('.md') && f.includes(prpId))
        .map((f) => ({
          path: path.join(fullDir, f),
          mtime: fs.statSync(path.join(fullDir, f)).mtimeMs,
        }))
        .filter((f) => now - f.mtime < maxAge)
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        return files[0].path;
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return null;
}

// ============================================================================
// EXECUTE
// ============================================================================

/**
 * Execute a PRP using /execute-prp skill
 */
export async function executePRP(
  prp: PRPState,
  ctx: ProjectContext
): Promise<void> {
  log(`Executing ${prp.id}: ${prp.title}...`);

  // Configure git to use bot credentials
  configureGitBot(ctx.path);

  // Ensure we're on default branch and up to date
  exec(`git checkout ${getDefaultBranch(ctx.path)}`, { cwd: ctx.path });
  exec('git pull', { cwd: ctx.path });

  // Create branch
  const branchSlug = prp.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const branch = `auto/${prp.id.toLowerCase()}-${branchSlug}`;

  // Check if branch already exists
  const branchExists = exec(`git branch -r --list "origin/${branch}"`, {
    cwd: ctx.path,
    silent: true,
  });

  if (branchExists) {
    log(`Branch ${branch} already exists - checking out`, 'warn');
    exec(`git checkout ${branch}`, { cwd: ctx.path });
    try {
      exec(`git pull origin ${branch}`, { cwd: ctx.path, silent: true });
    } catch {}
  } else {
    exec(`git checkout -b ${branch}`, { cwd: ctx.path });
  }

  log('Running /execute-prp skill...');

  const timeouts = getTimeouts();
  const result = await runClaude(
    `/execute-prp "${prp.enrichedFile}"`,
    ctx.path,
    timeouts.execution
  );

  if (!result.success) {
    log('Execution failed', 'error');
    exec(`git checkout ${getDefaultBranch(ctx.path)}`, { cwd: ctx.path });
    try {
      exec(`git branch -D ${branch}`, { cwd: ctx.path, silent: true });
    } catch {}
    throw new Error('Execution failed');
  }

  // Run validation
  log('Running validation...');
  const validation = runValidation(ctx.path);

  // Check for changes (exclude Windows reserved filenames)
  exec('git add .', { cwd: ctx.path });
  const hasChanges = exec('git status --porcelain', {
    cwd: ctx.path,
    silent: true,
  });

  if (!hasChanges) {
    log('No changes produced - PRP may already be implemented', 'warn');
    exec(`git checkout ${getDefaultBranch(ctx.path)}`, { cwd: ctx.path });
    try {
      exec(`git branch -D ${branch}`, { cwd: ctx.path, silent: true });
    } catch {}
    return;
  }

  // Commit and push
  exec(
    `git commit -m "feat(${prp.id}): ${prp.title}

Automated implementation by PRP Orchestrator.

Co-Authored-By: Claude <noreply@anthropic.com>"`,
    { cwd: ctx.path }
  );

  exec(`git push -u origin ${branch}`, { cwd: ctx.path });

  // Create PR (using bot credentials)
  const prBody = buildPRBody(prp, validation);
  const prBodyFile = path.join(ctx.path, '.prp-pr-body.md');
  fs.writeFileSync(prBodyFile, prBody);

  execWithBot(
    `gh pr create --title "${prp.id}: ${prp.title}" --body-file "${prBodyFile}"`,
    { cwd: ctx.path }
  );

  // Cleanup
  try {
    fs.unlinkSync(prBodyFile);
  } catch {}

  log('PR created successfully', 'success');

  // Return to main branch
  exec(`git checkout ${getDefaultBranch(ctx.path)}`, { cwd: ctx.path });
}

/**
 * Run validation commands (build, test, format)
 */
function runValidation(projectPath: string): ValidationResult {
  const result: ValidationResult = {
    build: true,
    test: true,
    format: true,
  };

  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return result; // Skip for non-Node projects
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    if (pkg.scripts?.build) {
      log('  Running build...');
      try {
        exec('npm run build', {
          cwd: projectPath,
          silent: true,
          timeout: 5 * 60 * 1000,
        });
      } catch {
        result.build = false;
      }
    }

    if (pkg.scripts?.test) {
      log('  Running tests...');
      try {
        exec('npm test', {
          cwd: projectPath,
          silent: true,
          timeout: 10 * 60 * 1000,
        });
      } catch {
        result.test = false;
      }
    }

    if (pkg.scripts?.['format:check'] || pkg.scripts?.lint) {
      log('  Running lint/format...');
      const cmd = pkg.scripts['format:check'] ? 'format:check' : 'lint';
      try {
        exec(`npm run ${cmd}`, { cwd: projectPath, silent: true });
      } catch {
        result.format = false;
      }
    }
  } catch {
    // JSON parse error or other issues
  }

  return result;
}

/**
 * Build PR body content
 */
function buildPRBody(prp: PRPState, validation: ValidationResult): string {
  return `## ${prp.id}: ${prp.title}

### Summary

${prp.scope}

### Validation Results

| Check | Status |
|-------|--------|
| Build | ${validation.build ? '✅ Pass' : '❌ Fail'} |
| Tests | ${validation.test ? '✅ Pass' : '❌ Fail'} |
| Format | ${validation.format ? '✅ Pass' : '⚠️ Check'} |

---

## How to Review

1. **Check the changes** - Review the code diff
2. **Verify requirements** - Compare against acceptance criteria
3. **Add a label to trigger automation:**

| Label | What Happens |
|-------|--------------|
| \`approved\` | PR is auto-merged, next PRP starts |
| \`changes-requested\` | Claude reads your comments and pushes fixes |

> **Note:** Add your feedback as comments, then add the appropriate label.

---

*🤖 Automated by PRP Orchestrator*
*📄 PRP File: \`${prp.enrichedFile}\`*
`;
}
