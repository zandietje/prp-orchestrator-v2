/**
 * Global configuration stored in ~/.prp-orchestrator/config.yaml
 */
export interface GlobalConfig {
  projects: ProjectEntry[];
  defaults: {
    checkIntervalMinutes: number;
    enrichmentTimeoutMinutes: number;
    executionTimeoutMinutes: number;
    revisionTimeoutMinutes: number;
  };
}

/**
 * A registered project
 */
export interface ProjectEntry {
  name: string;
  path: string;
  enabled: boolean;
  masterFile?: string; // Default: PRPs/master-plan.yaml
}

/**
 * Master plan YAML structure
 */
export interface MasterPlan {
  name: string;
  context?: string;
  constraints?: string[];
  completed?: string[]; // PRPs that are already done (e.g., ["PRP-001", "PRP-002"])
  prps: MasterPRP[];
}

/**
 * PRP definition in master plan
 */
export interface MasterPRP {
  id: string;
  title: string;
  scope: string;
  depends_on?: string[];
  acceptance_criteria?: string[];
  files_to_create?: Array<{ path: string; purpose: string }>;
  files_to_modify?: Array<{ path: string; changes: string }>;
  tests_required?: string[];
  notes?: string;
}

/**
 * Runtime PRP state (derived from git/GitHub)
 */
export interface PRPState {
  id: string;
  title: string;
  scope: string;
  dependsOn: string[];
  masterPrp: MasterPRP;

  // Derived state - not stored, computed each run
  isEnriched: boolean;
  enrichedFile?: string;
  branch?: string;
  prNumber?: number;
  prState?: 'open' | 'merged' | 'closed';
  reviewState?: 'approved' | 'changes_requested' | 'pending' | 'none';
}

/**
 * Project context for a single run
 */
export interface ProjectContext {
  name: string;
  path: string;
  masterFile: string;
  enrichedDir: string;
  lockFile: string;
}

/**
 * Validation results after execution
 */
export interface ValidationResult {
  build: boolean;
  test: boolean;
  format: boolean;
}

/**
 * Result of running Claude Code
 */
export interface ClaudeResult {
  success: boolean;
  output: string;
}
