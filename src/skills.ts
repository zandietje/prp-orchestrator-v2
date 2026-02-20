import * as fs from 'fs';
import * as path from 'path';
import { ProjectContext } from './types';
import { ensureDir, log } from './utils';

/**
 * Claude Code skill definitions
 * These are installed to {project}/.claude/commands/
 */
const SKILLS: Record<string, string> = {
  'execute-prp.md': `---
name: execute-prp
description: Execute a PRP (Problem Requirements Proposal) to implement a feature
arguments:
  - name: prp_file
    description: Path to the PRP markdown file
    required: true
---

# Execute PRP

You are implementing a PRP (Problem Requirements Proposal). Follow these instructions precisely.

## Step 1: Read the PRP

Read the PRP file at: $ARGUMENTS

Understand:
- The goal and scope
- Files to create/modify
- Acceptance criteria
- Any constraints or patterns to follow

## Step 2: Analyze the Codebase

Before making changes:
1. Search for similar implementations in the codebase
2. Understand existing patterns and conventions
3. Identify integration points
4. Check for existing utilities you can reuse

## Step 3: Implement

Implement the PRP requirements:
1. Create new files as specified
2. Modify existing files as needed
3. Follow existing code style and patterns
4. Write clean, maintainable code

## Step 4: Write Tests

If tests are required:
1. Follow existing test patterns
2. Cover the acceptance criteria
3. Include edge cases

## Step 5: Validate

After implementation:
1. Ensure the code compiles/builds
2. Run existing tests to check for regressions
3. Verify acceptance criteria are met

## Important Guidelines

- **DO NOT** modify files outside the scope of this PRP
- **DO NOT** refactor unrelated code
- **DO NOT** add features not specified in the PRP
- **FOLLOW** existing patterns exactly
- **ASK** if requirements are unclear (but prefer reasonable assumptions)

## Output

When complete, provide a summary of:
1. Files created
2. Files modified
3. Tests added
4. Any issues or notes for the reviewer
`,

  'generate-prp.md': `---
name: generate-prp
description: Enrich an initial PRP into a detailed implementation specification
arguments:
  - name: initial_file
    description: Path to the initial/seed PRP file
    required: true
---

# Generate Enriched PRP

You are enriching a seed PRP into a detailed implementation specification.

## Step 1: Read the Initial PRP

Read the initial PRP at: $ARGUMENTS

Understand:
- The high-level goal
- Any specified files or components
- Acceptance criteria
- Dependencies on other PRPs

## Step 2: Research the Codebase

Thoroughly analyze the existing codebase:

1. **Project Structure**: Understand the directory layout and organization
2. **Similar Features**: Find similar implementations to use as patterns
3. **Utilities & Helpers**: Identify reusable utilities
4. **Patterns**: Document coding patterns, naming conventions, error handling
5. **Testing Patterns**: Understand how tests are structured
6. **Dependencies**: Check what libraries/frameworks are used

## Step 3: Design the Implementation

Based on your research, design:

1. **Files to Create**: Exact paths, purposes, and rough structure
2. **Files to Modify**: What changes are needed and where
3. **Implementation Approach**: Step-by-step technical approach
4. **Integration Points**: How this connects to existing code
5. **Potential Challenges**: Edge cases, risks, complexities

## Step 4: Write the Enriched PRP

Create a new file named \`{PRP-ID}-ENRICHED.md\` in the same directory with this structure:

\`\`\`markdown
# {PRP-ID}: {Title}

## Overview
Brief summary of what this PRP accomplishes.

## Research Findings

### Existing Patterns
- Pattern 1: [description and file references]
- Pattern 2: [description and file references]

### Relevant Utilities
- Utility 1: [path and usage]

### Integration Points
- Integration 1: [where and how]

## Implementation Plan

### Files to Create

#### \`path/to/new/file.ts\`
Purpose: [what this file does]
Key structure outline...

### Files to Modify

#### \`path/to/existing/file.ts\`
Changes needed:
- Change 1
- Change 2

## Technical Approach

1. Step 1: [detailed step]
2. Step 2: [detailed step]

## Testing Strategy

### Unit Tests
- Test 1: [what to test]

## Acceptance Criteria Mapping

| Criterion | Implementation | Verification |
|-----------|----------------|--------------|
| Criterion 1 | How implemented | How to verify |

## Confidence Score

**Confidence: X/10**

Reasoning: [Why this score]
\`\`\`

## Step 5: Save the Enriched PRP

Save as \`{PRP-ID}-ENRICHED.md\` in the same directory as the initial file.

## Guidelines

- Be **thorough** in research
- Be **specific** in implementation plan
- Be **practical** - simplest approach that works
- **Reference real code** from the codebase
- Give honest **confidence score** (1-10)
`,

  'verify-prp.md': `---
name: verify-prp
description: Verify if a PRP's requirements are already implemented
arguments:
  - name: prp_file
    description: Path to the PRP file to verify
    required: true
---

# Verify PRP Implementation

Check if the PRP requirements are already implemented in the codebase.

## Step 1: Read the PRP

Read the PRP at: $ARGUMENTS

Extract:
- All acceptance criteria
- Required files
- Required functionality

## Step 2: Check Implementation

For each acceptance criterion:
1. Search the codebase for relevant implementations
2. Verify the functionality exists and works correctly
3. Check if tests exist and pass

## Step 3: Generate Report

Output a JSON report in a code block:

\`\`\`json
{
  "status": "DONE | PARTIAL | NOT_DONE",
  "confidence": 1-10,
  "summary": "Brief summary of findings",
  "completed_items": [
    "Criterion 1 - found in path/to/file.ts"
  ],
  "missing_items": [
    "Criterion 2 - not found"
  ]
}
\`\`\`

## Status Definitions

- **DONE**: All acceptance criteria are fully implemented
- **PARTIAL**: Some criteria implemented, some missing
- **NOT_DONE**: Little to no implementation found

## Confidence Score

- **9-10**: Very confident, found exact implementations
- **7-8**: Confident, implementations appear correct
- **5-6**: Somewhat confident, found related code
- **1-4**: Low confidence, unable to verify properly
`,
};

/**
 * Get the skills directory for a project
 */
export function getProjectSkillsDir(projectPath: string): string {
  return path.join(projectPath, '.claude', 'commands');
}

/**
 * Install skills to a specific project
 */
export function installSkillsToProject(projectPath: string, force: boolean = false): void {
  const skillsDir = getProjectSkillsDir(projectPath);
  ensureDir(skillsDir);

  for (const [filename, content] of Object.entries(SKILLS)) {
    const filepath = path.join(skillsDir, filename);

    if (fs.existsSync(filepath) && !force) {
      // Skip if exists and not forcing
      continue;
    }

    fs.writeFileSync(filepath, content);
    log(`Installed skill: ${filename}`, 'success');
  }
}

/**
 * Check if required skills are installed in a project
 */
export function checkProjectSkills(projectPath: string): { installed: boolean; missing: string[] } {
  const skillsDir = getProjectSkillsDir(projectPath);
  const required = ['execute-prp.md', 'generate-prp.md'];
  const missing: string[] = [];

  for (const skill of required) {
    const filepath = path.join(skillsDir, skill);
    if (!fs.existsSync(filepath)) {
      missing.push(skill);
    }
  }

  return {
    installed: missing.length === 0,
    missing,
  };
}

/**
 * Ensure skills are installed in a project (install if missing)
 */
export function ensureProjectSkills(projectPath: string): void {
  const check = checkProjectSkills(projectPath);

  if (!check.installed) {
    log(`Installing missing skills: ${check.missing.join(', ')}`);
    installSkillsToProject(projectPath, false);
  }
}

/**
 * List installed skills in a project
 */
export function listProjectSkills(projectPath: string): string[] {
  const skillsDir = getProjectSkillsDir(projectPath);

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  return fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace('.md', ''));
}

/**
 * Get skill content by name
 */
export function getSkillContent(skillName: string): string | null {
  const filename = skillName.endsWith('.md') ? skillName : `${skillName}.md`;
  return SKILLS[filename] || null;
}
