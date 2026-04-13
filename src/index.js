/**
 * Cross-platform service management library
 * Supports Windows, macOS, and Linux
 */

import os from 'node:os';
import fs from 'node:fs';

// Re-export service status constants
export const ServiceStatus = {
  RUNNING: 'running',
  STOPPED: 'stopped',
  FAILED: 'failed',
  UNKNOWN: 'unknown'
};

// Valid actions
const VALID_ACTIONS = ['register', 'unregister', 'start', 'stop', 'enable', 'status', 'health', 'inspect'];

/**
 * @typedef {Object} Input
 * @property {'register' | 'unregister' | 'start' | 'stop' | 'enable' | 'status' | 'health' | 'inspect'} action - The operation to perform on the service
 * @property {string} name - Service identifier
 * @property {string} [description] - Service description (required for registration)
 * @property {string[]} [command] - Command array to execute (required for registration)
 * @property {string} [user] - User account to run the service
 * @property {Record<string, string>} [env] - Environment variables for the service
 * @property {string} [wdir] - Working directory for the service
 * @property {boolean} [system=true] - Whether to register as system-wide service (true) or user-level service (false)
 * @property {boolean} [autoStart=true] - Whether to start the service automatically on registration or system startup
 * @property {boolean} [restartOnFailure=true] - Whether to restart the service automatically if it fails or stops
 */

const validateConfig = (config) => {
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration object is required');
  }

  const { action, name, description, command, user, env, wdir, autoStart, restartOnFailure, system } = config;
  const errors = [];

  // Validate action
  if (!action || !VALID_ACTIONS.includes(action)) {
    errors.push(`Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(', ')}`);
  }

  if (!name?.trim()) errors.push('Service name is required');

  if (action === 'register') {
    if (!description?.trim()) errors.push('Service description is required');
    if (!Array.isArray(command) || command.length === 0) errors.push('Command array is required');
    if (wdir && !fs.existsSync(wdir)) errors.push('Working directory does not exist');
    if (env && (typeof env !== 'object' || Array.isArray(env))) errors.push('Environment variables must be a plain object');
    if (user && typeof user !== 'string') errors.push('User must be a string');
    if (autoStart !== undefined && typeof autoStart !== 'boolean') errors.push('autoStart must be a boolean');
    if (restartOnFailure !== undefined && typeof restartOnFailure !== 'boolean') errors.push('restartOnFailure must be a boolean');
    if (system !== undefined && typeof system !== 'boolean') errors.push('system must be a boolean');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
};

/**
 * Manages system services across Windows, macOS, and Linux platforms
 * @param {Input} config - Service configuration object
 * @returns {Promise<string|Object|void>} Returns status string, health/inspect object, or void
 * @throws {Error} Throws if configuration validation fails or operation errors occur
 */
export default async (config) => {
  try {
    validateConfig(config);

    const {
      action,
      name,
      env = {},
      description,
      command,
      wdir,
      user,
      system = true,
      autoStart = true,
      restartOnFailure = true
    } = config;

    const platform = os.platform();

    // Dynamically import the platform-specific implementation
    // Note: Each import path must be a static string literal for bundler compatibility
    let platformImpl;
    switch (platform) {
      case 'win32':  platformImpl = await import('./windows.js'); break;
      case 'darwin': platformImpl = await import('./macos.js');   break;
      case 'linux':  platformImpl = await import('./linux.js');   break;
      default: throw new Error(`Unsupported platform: ${platform}`);
    }

    // Dispatch action to platform-specific implementation
    switch (action) {
      case 'status':
        return await platformImpl.getServiceStatus(name, system);

      case 'health':
        return await platformImpl.checkServiceHealth(name, system);

      case 'inspect':
        return await platformImpl.inspectServiceConfig(name, system);

      case 'register':
        return await platformImpl.manageService(true, {
          name, description, command, env, wdir, user,
          system, autoStart, restartOnFailure
        });

      case 'unregister':
        return await platformImpl.manageService(false, { name, system });

      case 'start':
        return await platformImpl.startStopService(true, name, system);

      case 'stop':
        return await platformImpl.startStopService(false, name, system);

      case 'enable':
        return await platformImpl.enableService(name, system);
    }
  } catch (error) {
    console.error(`Service management error: ${error.message}`);
    throw error;
  }
};
