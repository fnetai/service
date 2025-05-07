/**
 * Linux-specific service management implementation
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
 * Helper function to check file existence and log warnings
 * @param {string} filePath - Path to check
 * @param {boolean} shouldExist - Whether the file should exist
 * @param {string} action - Action being performed
 * @returns {boolean} - Whether the check passed
 */
const checkFileExists = (filePath, shouldExist, action) => {
  const fileExists = fs.existsSync(filePath);
  if (shouldExist && !fileExists) {
    console.error(`Error: ${filePath} not found for action "${action}".`);
    return false;
  } else if (!shouldExist && fileExists) {
    console.error(`Warning: ${filePath} already exists for action "${action}".`);
    return false;
  }
  return true;
};

/**
 * Get service status on Linux
 * @param {string} name - Service name
 * @returns {Promise<string>} - Service status
 */
export const getServiceStatus = async (name) => {
  try {
    try {
      const linuxStatus = execSync(`systemctl is-active "${name}"`).toString().trim();
      switch (linuxStatus) {
        case 'active': return ServiceStatus.RUNNING;
        case 'failed': return ServiceStatus.FAILED;
        default: return ServiceStatus.STOPPED;
      }
    } catch (linuxError) {
      // If service doesn't exist, systemctl will exit with non-zero code
      if (linuxError.status !== 0) {
        return ServiceStatus.UNKNOWN;
      }
      throw linuxError;
    }
  } catch (error) {
    console.error(`Error getting Linux service status: ${error.message}`);
    return ServiceStatus.UNKNOWN;
  }
};

/**
 * Check service health on Linux
 * @param {string} name - Service name
 * @returns {Promise<Object>} - Health information
 */
export const checkServiceHealth = async (name) => {
  try {
    const status = await getServiceStatus(name);
    if (status === ServiceStatus.FAILED) {
      // Get service logs for diagnostics
      const logs = execSync(`journalctl -u "${name}" --no-pager -n 50`).toString();
      
      return {
        healthy: false,
        status,
        logs,
        timestamp: new Date().toISOString()
      };
    }
    
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
 * Inspect service configuration on Linux
 * @param {string} name - Service name
 * @returns {Promise<Object>} - Service configuration
 */
export const inspectServiceConfig = async (name) => {
  try {
    // Check both system and user locations
    const systemServicePath = `/etc/systemd/system/${name}.service`;
    const userServicePath = `${os.homedir()}/.config/systemd/user/${name}.service`;
    
    let configPath;
    if (fs.existsSync(systemServicePath)) {
      configPath = systemServicePath;
    } else if (fs.existsSync(userServicePath)) {
      configPath = userServicePath;
    } else {
      throw new Error(`Service configuration for "${name}" not found in standard locations.`);
    }
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      return {
        name,
        platform: 'linux',
        configType: 'Linux Systemd Service',
        configPath,
        configContent,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Error reading service configuration: ${error.message}`);
    }
  } catch (error) {
    throw error;
  }
};

/**
 * Register or unregister a Linux service
 * @param {boolean} register - Whether to register (true) or unregister (false) the service
 * @param {Object} options - Service options
 * @returns {Promise<string>} - Command output
 */
export const manageService = async (register, { name, description, command, env = {}, working_dir, user, system_level = true, autoStart = true, restartOnFailure = true }) => {
  // Format environment variables for service files
  const formattedEnv = Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' ');
  
  // Define service path based on system_level
  let servicePath;
  if (system_level) {
    servicePath = `/etc/systemd/system/${name}.service`;
  } else {
    // For Linux, use user-level systemd directory
    // Create the directory if it doesn't exist
    const userSystemdDir = `${os.homedir()}/.config/systemd/user`;
    if (!fs.existsSync(userSystemdDir)) {
      fs.mkdirSync(userSystemdDir, { recursive: true });
    }
    servicePath = `${userSystemdDir}/${name}.service`;
  }
  
  return new Promise((resolve, reject) => {
    if (register) {
      if (!checkFileExists(servicePath, false, "register")) {
        return reject(new Error(`${servicePath} already exists`));
      }

      // Escape special characters in command arguments
      const escapedCommand = command.map(arg => arg.replace(/(["\s'$`\\])/g, '\\$1')).join(' ');
      
      const serviceContent = `
      [Unit]
      Description=${description}
      After=network.target

      [Service]
      ExecStart=${escapedCommand}
      Restart=${restartOnFailure ? 'always' : 'no'}
      ${user ? `User=${user}` : `User=${process.env.USER}`}
      ${working_dir ? `WorkingDirectory=${path.resolve(working_dir)}` : ''}
      ${formattedEnv ? `Environment="${formattedEnv}"` : ''}

      [Install]
      WantedBy=multi-user.target`;
      
      try {
        fs.writeFileSync(servicePath, serviceContent);
        
        // Check if we need sudo for system-level services
        const needsSudo = servicePath.startsWith('/etc/');
        
        // Build the command based on autoStart parameter
        let enableCmd = `${needsSudo ? 'sudo ' : ''}systemctl enable ${name}`;
        
        // Only start the service if autoStart is true
        if (autoStart) {
          enableCmd += ` && ${needsSudo ? 'sudo ' : ''}systemctl start ${name}`;
        }
        
        exec(enableCmd, (err, stdout, stderr) => {
          if (err) {
            console.error(`Linux service error: ${stderr}`);
            if (stderr.includes('Permission denied')) {
              console.error('This operation requires root privileges. Try running with sudo.');
            }
            reject(err);
          } else {
            console.log(`Service "${name}" registered successfully on Linux.`);
            resolve(stdout);
          }
        });
      } catch (error) {
        reject(error);
      }
    } else {
      if (!checkFileExists(servicePath, true, "unregister")) {
        return reject(new Error(`${servicePath} does not exist`));
      }

      // Check if we need sudo for system-level services
      const needsSudo = servicePath.startsWith('/etc/');
      const disableCmd = `${needsSudo ? 'sudo ' : ''}systemctl stop ${name} && ${needsSudo ? 'sudo ' : ''}systemctl disable ${name} && ${needsSudo ? 'sudo ' : ''}rm ${servicePath}`;
      
      exec(disableCmd, (err, stdout, stderr) => {
        if (err) {
          console.error(`Linux service error: ${stderr}`);
          if (stderr.includes('Permission denied')) {
            console.error('This operation requires root privileges. Try running with sudo.');
          }
          reject(err);
        } else {
          console.log(`Service "${name}" unregistered successfully on Linux.`);
          resolve(stdout);
        }
      });
    }
  });
};

/**
 * Start or stop a Linux service
 * @param {boolean} start - Whether to start (true) or stop (false) the service
 * @param {string} name - Service name
 * @param {boolean} system_level - Whether the service is system-wide
 * @returns {Promise<string>} - Command output
 */
export const startStopService = async (start, name, system_level = true) => {
  return new Promise((resolve, reject) => {
    // Check if we need sudo for system-level services
    const needsSudo = system_level;
    const cmd = `${needsSudo ? 'sudo ' : ''}systemctl ${start ? 'start' : 'stop'} ${name}`;
    
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`Linux ${start ? 'start' : 'stop'} error: ${stderr}`);
        if (stderr.includes('Permission denied')) {
          console.error('This operation requires root privileges. Try running with sudo.');
        }
        reject(err);
      } else {
        console.log(`Service "${name}" ${start ? 'started' : 'stopped'} successfully on Linux.`);
        resolve(stdout);
      }
    });
  });
};

/**
 * Enable a Linux service
 * @param {string} name - Service name
 * @param {boolean} system_level - Whether the service is system-wide
 * @returns {Promise<string>} - Command output
 */
export const enableService = async (name, system_level = true) => {
  // Define service path based on system_level
  const servicePath = system_level 
    ? `/etc/systemd/system/${name}.service`
    : `${os.homedir()}/.config/systemd/user/${name}.service`;
  
  return new Promise((resolve, reject) => {
    if (!checkFileExists(servicePath, true, "enable")) {
      return reject(new Error(`${servicePath} does not exist`));
    }
    
    // Check if we need sudo for system-level services
    const needsSudo = servicePath.startsWith('/etc/');
    const cmd = `${needsSudo ? 'sudo ' : ''}systemctl enable ${name}`;
    
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`Linux service enable error: ${stderr}`);
        if (stderr.includes('Permission denied')) {
          console.error('This operation requires root privileges. Try running with sudo.');
        }
        reject(err);
      } else {
        console.log(`Service "${name}" enabled successfully on Linux.`);
        resolve(stdout);
      }
    });
  });
};
