/**
 * Configuration management for the CLI framework.
 *
 * Handles loading and parsing of configuration files,
 * environment variables, and default values.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * User configuration from config file.
 */
export interface UserConfig {
  /** Unique user identifier */
  id?: string;
  /** User's role in the organization */
  role?: string;
  /** Groups the user belongs to */
  groups?: string[];
}

/**
 * Tool-specific configuration.
 */
export interface ToolConfig {
  /** Whether this tool is enabled */
  enabled?: boolean;
  /** Override path to the real executable */
  realPath?: string;
}

/**
 * Repository classification configuration.
 */
export interface RepoConfig {
  /** Classification level for this repository */
  classification?: string;
}

/**
 * Full framework configuration.
 */
export interface FrameworkConfig {
  /** User configuration */
  user: UserConfig;
  /** Tool-specific configurations keyed by tool name */
  tools: Record<string, ToolConfig>;
  /** Repository configurations keyed by repo name */
  repos: Record<string, RepoConfig>;
  /** Whether verbose logging is enabled */
  verbose: boolean;
  /** Timeout for policy evaluation in milliseconds */
  timeoutMs: number;
}

/** Default configuration values */
const DEFAULT_CONFIG: Omit<FrameworkConfig, 'user' | 'tools' | 'repos'> = {
  verbose: false,
  timeoutMs: 30000, // 30 seconds
};

/**
 * Get the default configuration file path.
 * Follows XDG Base Directory specification.
 */
export function getDefaultConfigPath(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'vguardrail', 'cli-config.json');
  }
  return path.join(os.homedir(), '.config', 'vguardrail', 'cli-config.json');
}

/**
 * Create default configuration with environment-based defaults.
 */
export function defaultConfig(): FrameworkConfig {
  return {
    ...DEFAULT_CONFIG,
    user: {
      id: process.env.USER || process.env.USERNAME || 'unknown',
      role: 'user',
      groups: [],
    },
    tools: {},
    repos: {},
  };
}

/**
 * Load configuration from file, falling back to defaults.
 *
 * @param configPath - Optional path to config file
 * @returns The loaded or default configuration
 */
export function loadConfig(configPath?: string): FrameworkConfig {
  const configFilePath = configPath || getDefaultConfigPath();
  const baseConfig = defaultConfig();

  try {
    if (!fs.existsSync(configFilePath)) {
      return baseConfig;
    }

    const fileContent = fs.readFileSync(configFilePath, 'utf-8');
    const fileConfig = JSON.parse(fileContent) as Partial<FrameworkConfig>;

    return mergeConfig(baseConfig, fileConfig);
  } catch (error) {
    // Log warning but return defaults on config errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`[VGuardrail] Warning: Failed to load config from ${configFilePath}: ${errorMessage}\n`);
    return baseConfig;
  }
}

/**
 * Merge file configuration with base configuration.
 */
function mergeConfig(base: FrameworkConfig, file: Partial<FrameworkConfig>): FrameworkConfig {
  return {
    ...DEFAULT_CONFIG,
    user: {
      ...base.user,
      ...file.user,
    },
    tools: {
      ...base.tools,
      ...(file.tools || {}),
    },
    repos: {
      ...base.repos,
      ...(file.repos || {}),
    },
    verbose: file.verbose ?? base.verbose,
    timeoutMs: file.timeoutMs ?? base.timeoutMs,
  };
}

/**
 * Save configuration to file.
 *
 * @param config - Configuration to save
 * @param configPath - Optional path to config file
 */
export function saveConfig(config: Partial<FrameworkConfig>, configPath?: string): void {
  const filePath = configPath || getDefaultConfigPath();
  const dir = path.dirname(filePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const existingConfig = loadConfig(configPath);
    const mergedConfig = mergeConfig(existingConfig, config);

    fs.writeFileSync(filePath, JSON.stringify(mergedConfig, null, 2), 'utf-8');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`[VGuardrail] Warning: Failed to save config: ${errorMessage}\n`);
  }
}

/**
 * Get tool configuration for a specific tool.
 */
export function getToolConfig(toolName: string, config?: FrameworkConfig): ToolConfig {
  const frameworkConfig = config || loadConfig();
  return frameworkConfig.tools[toolName] || {};
}

/**
 * Get repository configuration for the current directory.
 */
export function getCurrentRepoConfig(config?: FrameworkConfig): RepoConfig | undefined {
  const frameworkConfig = config || loadConfig();
  const repoName = process.env.VG_REPO_NAME;

  if (repoName && frameworkConfig.repos[repoName]) {
    return frameworkConfig.repos[repoName];
  }

  return undefined;
}