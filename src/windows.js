/**
 * Windows-specific service management implementation
 */

import { exec, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Service status constants
export const ServiceStatus = {
  RUNNING: 'running',
  STOPPED: 'stopped',
  FAILED: 'failed',
  UNKNOWN: 'unknown'
};

/**
 * Creates a Windows batch script that sets environment variables and changes directory before running the command
 * @param {string[]} command - Command array to execute
 * @param {Record<string, string>} env - Environment variables
 * @param {string} [working_dir] - Working directory
 * @returns {string} - Windows batch script content
 */
const createWindowsEnvScript = (command, env = {}, working_dir) => {
  const envVars = Object.entries(env).map(([key, value]) => `SET ${key}=${value}`).join(' && ');
  const cdCommand = working_dir ? `cd /d "${working_dir}" && ` : '';
  return `${envVars} && ${cdCommand}${command.join(' ')}`;
};

/**
 * Get service status on Windows
 * @param {string} name - Service name
 * @returns {Promise<string>} - Service status
 */
export const getServiceStatus = async (name) => {
  try {
    const winStatus = execSync(`sc query "${name}"`).toString();
    if (winStatus.includes('RUNNING')) return ServiceStatus.RUNNING;
    if (winStatus.includes('STOPPED')) return ServiceStatus.STOPPED;
    return ServiceStatus.UNKNOWN;
  } catch (error) {
    console.error(`Error getting Windows service status: ${error.message}`);
    return ServiceStatus.UNKNOWN;
  }
};

/**
 * Check service health on Windows
 * @param {string} name - Service name
 * @returns {Promise<Object>} - Health information
 */
export const checkServiceHealth = async (name) => {
  try {
    const status = await getServiceStatus(name);
    return {
      healthy: status === ServiceStatus.RUNNING,
      status,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      status: ServiceStatus.UNKNOWN,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Inspect service configuration on Windows
 * @param {string} name - Service name
 * @returns {Promise<Object>} - Service configuration
 */
export const inspectServiceConfig = async (name) => {
  try {
    const configContent = execSync(`sc qc "${name}"`).toString();
    return {
      name,
      platform: 'win32',
      configType: 'Windows Service',
      configContent,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw new Error(`Service "${name}" not found or cannot be accessed: ${error.message}`);
  }
};

/**
 * Register or unregister a Windows service
 * @param {boolean} register - Whether to register (true) or unregister (false) the service
 * @param {Object} options - Service options
 * @returns {Promise<string>} - Command output
 */
export const manageService = async (register, { name, description, command, env = {}, working_dir, autoStart = true, restartOnFailure = true }) => {
  if (register) {
    // Create a wrapper script for environment and working directory support
    const scriptPath = path.join(os.tmpdir(), `${name}-wrapper.cmd`);
    const scriptContent = createWindowsEnvScript(command, env, working_dir);
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');

    // Set the start type based on autoStart parameter
    const startType = autoStart ? 'auto' : 'demand';
    
    // Create the service with the appropriate start type
    const serviceCmd = `sc create "${name}" binPath= "${scriptPath}" DisplayName= "${description}" start= ${startType}`;

    return new Promise((resolve, reject) => {
      exec(serviceCmd, (err, stdout, stderr) => {
        if (err) {
          console.error(`Windows service error: ${stderr}`);
          reject(err);
        } else {
          // If restartOnFailure is true, configure the service to restart on failure
          if (restartOnFailure) {
            // Configure service to restart after 30 seconds if it fails
            const failureCmd = `sc failure "${name}" reset= 86400 actions= restart/30000`;
            exec(failureCmd, (failErr, failStdout, failStderr) => {
              if (failErr) {
                console.error(`Windows service failure configuration error: ${failStderr}`);
                // Don't reject here, as the service was created successfully
                console.log(`Service "${name}" registered successfully on Windows, but failure recovery settings could not be applied.`);
                resolve(stdout);
              } else {
                console.log(`Service "${name}" registered successfully on Windows with automatic restart on failure.`);
                resolve(failStdout);
              }
            });
          } else {
            console.log(`Service "${name}" registered successfully on Windows.`);
            resolve(stdout);
          }
        }
      });
    });
  }
  // Unregister Windows service
  else {
    return new Promise((resolve, reject) => {
      exec(`sc delete "${name}"`, (err, stdout, stderr) => {
        if (err) {
          console.error(`Windows service unregister error: ${stderr}`);
          reject(err);
        } else {
          // Clean up the wrapper script if it exists
          const scriptPath = path.join(os.tmpdir(), `${name}-wrapper.cmd`);
          if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
          }
          console.log(`Service "${name}" unregistered successfully on Windows.`);
          resolve(stdout);
        }
      });
    });
  }
};

/**
 * Start or stop a Windows service
 * @param {boolean} start - Whether to start (true) or stop (false) the service
 * @param {string} name - Service name
 * @returns {Promise<string>} - Command output
 */
export const startStopService = async (start, name) => {
  return new Promise((resolve, reject) => {
    exec(`sc ${start ? 'start' : 'stop'} "${name}"`, (err, stdout, stderr) => {
      if (err) {
        console.error(`Windows ${start ? 'start' : 'stop'} error: ${stderr}`);
        reject(err);
      } else {
        console.log(`Service "${name}" ${start ? 'started' : 'stopped'} successfully on Windows.`);
        resolve(stdout);
      }
    });
  });
};

/**
 * Enable a Windows service
 * @param {string} name - Service name
 * @returns {Promise<string>} - Command output
 */
export const enableService = async (name) => {
  return new Promise((resolve, reject) => {
    exec(`sc config "${name}" start= auto`, (err, stdout, stderr) => {
      if (err) {
        console.error(`Windows service enable error: ${stderr}`);
        reject(err);
      } else {
        console.log(`Service "${name}" enabled successfully on Windows.`);
        resolve(stdout);
      }
    });
  });
};
