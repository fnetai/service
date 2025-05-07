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

/**
 * @typedef {Object} Input
 * @property {'register' | 'unregister' | 'start' | 'stop' | 'enable' | 'status' | 'health' | 'inspect'} action - The operation to perform on the service
 * @property {string} name - Service identifier
 * @property {string} [description] - Service description (required for registration)
 * @property {string[]} [command] - Command array to execute (required for registration)
 * @property {string} [user] - User account to run the service
 * @property {Record<string, string>} [env] - Environment variables for the service
 * @property {string} [working_dir] - Working directory for the service
 * @property {boolean} [system_level=true] - Whether to register as system-wide service (true) or user-level service (false)
 * @property {boolean} [autoStart=true] - Whether to start the service automatically on registration or system startup
 * @property {boolean} [restartOnFailure=true] - Whether to restart the service automatically if it fails or stops
 */

/**
 * @typedef {Object} Output
 * @property {boolean} healthy - Whether the service is healthy
 * @property {string} status - Service status (running, stopped, failed, unknown)
 * @property {string} [error] - Error message if any
 * @property {string} timestamp - ISO timestamp of when the check was performed
 */

// Add proper error handling and validation
const validateConfig = ({ action, name, description, command, user, env, working_dir, autoStart, restartOnFailure, system_level }) => {
  const errors = [];

  if (!name?.trim()) errors.push('Service name is required');
  if (action === 'register') {
    if (!description?.trim()) errors.push('Service description is required');
    if (!Array.isArray(command) || command.length === 0) errors.push('Command array is required');
    if (working_dir && !fs.existsSync(working_dir)) errors.push('Working directory does not exist');
    // Validate environment variables if provided
    if (env && typeof env !== 'object') errors.push('Environment variables must be an object');
    // Validate user if provided
    if (user && typeof user !== 'string') errors.push('User must be a string');
    // Validate autoStart if provided
    if (autoStart !== undefined && typeof autoStart !== 'boolean') errors.push('autoStart must be a boolean');
    // Validate restartOnFailure if provided
    if (restartOnFailure !== undefined && typeof restartOnFailure !== 'boolean') errors.push('restartOnFailure must be a boolean');
    // Validate system_level if provided
    if (system_level !== undefined && typeof system_level !== 'boolean') errors.push('system_level must be a boolean');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
};

/**
 * Manages system services across Windows, macOS, and Linux platforms
 * @param {Input} config - Service configuration object
 * @returns {Promise<Output|void>} Returns status information for 'status', 'health', and 'inspect' actions
 * @throws {Error} Throws if configuration validation fails or operation errors occur
 *
 * Note: On macOS, 'start' and 'stop' actions use different commands
 * depending on the macOS version (modern vs. legacy)
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
      working_dir,
      user,
      system_level = true,
      autoStart = true,
      restartOnFailure = true
    } = config;

    const platform = os.platform();

    // Dynamically import the platform-specific implementation
    let platformImpl;
    try {
      switch (platform) {
        case 'win32':
          platformImpl = await import('./windows.js');
          break;
        case 'darwin':
          platformImpl = await import('./macos.js');
          break;
        case 'linux':
          platformImpl = await import('./linux.js');
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      throw new Error(`Failed to load platform-specific implementation: ${error.message}`);
    }

    // Add status check action
    if (action === 'status') {
      return await platformImpl.getServiceStatus(name);
    }

    // Add health check action
    if (action === 'health') {
      return await platformImpl.checkServiceHealth(name);
    }

    // Add inspect action to show service configuration
    if (action === 'inspect') {
      return await platformImpl.inspectServiceConfig(name);
    }

    // Evaluate action and execute respective function
    if (action === 'register') {
      return await platformImpl.manageService(true, {
        name,
        description,
        command,
        env,
        working_dir,
        user,
        system_level,
        autoStart,
        restartOnFailure
      });
    } else if (action === 'unregister') {
      return await platformImpl.manageService(false, {
        name,
        description,
        command,
        env,
        working_dir,
        user,
        system_level
      });
    } else if (action === 'start') {
      return await platformImpl.startStopService(true, name, system_level);
    } else if (action === 'stop') {
      return await platformImpl.startStopService(false, name, system_level);
    } else if (action === 'enable') {
      return await platformImpl.enableService(name, system_level);
    } else if (action === 'status' || action === 'health' || action === 'inspect') {
      // These actions are already handled above
      // This is just to prevent the error message below
    } else {
      throw new Error("Invalid action. Use 'register', 'unregister', 'start', 'stop', 'enable', 'status', 'health', or 'inspect'.");
    }
  } catch (error) {
    console.error(`Service management error: ${error.message}`);
    throw error;
  }
};
