import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { GlobalConfig, ProjectEntry, ProjectContext } from './types';
import { getConfigDir, getConfigFile, ensureDir, log } from './utils';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: GlobalConfig = {
  projects: [],
  defaults: {
    checkIntervalMinutes: 3,
    enrichmentTimeoutMinutes: 25,
    executionTimeoutMinutes: 20,
    revisionTimeoutMinutes: 15,
  },
};

/**
 * Load global configuration from ~/.prp-orchestrator/config.yaml
 */
export function loadGlobalConfig(): GlobalConfig {
  const configFile = getConfigFile();

  if (!fs.existsSync(configFile)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configFile, 'utf-8');
    const config = yaml.parse(content) as Partial<GlobalConfig>;

    return {
      projects: config.projects || [],
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...config.defaults,
      },
      bot: config.bot,
    };
  } catch (error) {
    log(`Failed to load config: ${error}`, 'warn');
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Set bot credentials for PR creation
 */
export function setBotCredentials(username: string, token: string): void {
  const config = loadGlobalConfig();
  config.bot = { username, token };
  saveGlobalConfig(config);
}

/**
 * Get bot credentials
 */
export function getBotCredentials(): { username: string; token: string } | null {
  const config = loadGlobalConfig();
  return config.bot || null;
}

/**
 * Save global configuration
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  const configDir = getConfigDir();
  ensureDir(configDir);

  const configFile = getConfigFile();
  const content = yaml.stringify(config, { indent: 2 });
  fs.writeFileSync(configFile, content);
}

/**
 * Add a project to the configuration
 */
export function addProject(name: string, projectPath: string): void {
  const config = loadGlobalConfig();
  const resolvedPath = path.resolve(projectPath);

  // Check if path exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }

  // Check if already registered
  const existing = config.projects.find(
    (p) => p.path === resolvedPath || p.name === name
  );
  if (existing) {
    throw new Error(
      `Project already registered: ${existing.name} (${existing.path})`
    );
  }

  config.projects.push({
    name,
    path: resolvedPath,
    enabled: true,
  });

  saveGlobalConfig(config);
}

/**
 * Remove a project from the configuration
 */
export function removeProject(nameOrPath: string): void {
  const config = loadGlobalConfig();
  const resolvedPath = path.resolve(nameOrPath);

  const index = config.projects.findIndex(
    (p) => p.name === nameOrPath || p.path === resolvedPath
  );

  if (index === -1) {
    throw new Error(`Project not found: ${nameOrPath}`);
  }

  config.projects.splice(index, 1);
  saveGlobalConfig(config);
}

/**
 * List all registered projects
 */
export function listProjects(): ProjectEntry[] {
  const config = loadGlobalConfig();
  return config.projects;
}

/**
 * Enable a project
 */
export function enableProject(name: string): void {
  const config = loadGlobalConfig();
  const project = config.projects.find((p) => p.name === name);

  if (!project) {
    throw new Error(`Project not found: ${name}`);
  }

  project.enabled = true;
  saveGlobalConfig(config);
}

/**
 * Disable a project
 */
export function disableProject(name: string): void {
  const config = loadGlobalConfig();
  const project = config.projects.find((p) => p.name === name);

  if (!project) {
    throw new Error(`Project not found: ${name}`);
  }

  project.enabled = false;
  saveGlobalConfig(config);
}

/**
 * Get project context for a given path
 */
export function getProjectContext(projectPath: string): ProjectContext {
  const resolvedPath = path.resolve(projectPath);
  const name = path.basename(resolvedPath);

  return {
    name,
    path: resolvedPath,
    masterFile: path.join(resolvedPath, 'PRPs', 'master-plan.yaml'),
    enrichedDir: path.join(resolvedPath, 'PRPs', 'enriched'),
    lockFile: path.join(resolvedPath, '.prp-lock'),
  };
}

/**
 * Get all enabled projects as contexts
 */
export function getEnabledProjects(): ProjectContext[] {
  const config = loadGlobalConfig();

  return config.projects
    .filter((p) => p.enabled)
    .map((p) => ({
      name: p.name,
      path: p.path,
      masterFile: p.masterFile || path.join(p.path, 'PRPs', 'master-plan.yaml'),
      enrichedDir: path.join(p.path, 'PRPs', 'enriched'),
      lockFile: path.join(p.path, '.prp-lock'),
    }));
}

/**
 * Get timeout values in milliseconds
 */
export function getTimeouts(): {
  enrichment: number;
  execution: number;
  revision: number;
} {
  const config = loadGlobalConfig();
  return {
    enrichment: config.defaults.enrichmentTimeoutMinutes * 60 * 1000,
    execution: config.defaults.executionTimeoutMinutes * 60 * 1000,
    revision: config.defaults.revisionTimeoutMinutes * 60 * 1000,
  };
}

/**
 * Update default configuration values
 */
export function updateDefaults(
  updates: Partial<GlobalConfig['defaults']>
): void {
  const config = loadGlobalConfig();
  config.defaults = { ...config.defaults, ...updates };
  saveGlobalConfig(config);
}
