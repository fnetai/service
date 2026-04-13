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
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<string>} - Service status
 */
export const getServiceStatus = async (name, system = true) => {
  try {
    try {
      // For user-level services, use --user flag
      const userFlag = !system ? ' --user' : '';
      const linuxStatus = execSync(`systemctl${userFlag} is-active "${name}"`).toString().trim();
      switch (linuxStatus) {
        case 'active': return ServiceStatus.RUNNING;
        case 'failed': return ServiceStatus.FAILED;
        default: return ServiceStatus.STOPPED;
      }
    } catch (linuxError) {
      // D-Bus connection issues for user-level services
      if (linuxError.message && (linuxError.message.includes('DBUS_SESSION_BUS_ADDRESS') ||
          linuxError.message.includes('Failed to connect to bus'))) {
        console.error('Cannot check user-level service status: D-Bus session bus not available.');
        return ServiceStatus.UNKNOWN;
      }
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
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<Object>} - Health information
 */
export const checkServiceHealth = async (name, system = true) => {
  try {
    const status = await getServiceStatus(name, system);
    if (status === ServiceStatus.FAILED) {
      // Get service logs for diagnostics
      // For user-level services, use --user flag
      const userFlag = !system ? ' --user' : '';
      const logs = execSync(`journalctl${userFlag} -u "${name}" --no-pager -n 50`).toString();

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
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<Object>} - Service configuration
 */
export const inspectServiceConfig = async (name, system = true) => {
  try {
    // Determine service path based on system parameter
    let configPath;
    if (system) {
      configPath = `/etc/systemd/system/${name}.service`;
    } else {
      configPath = `${os.homedir()}/.config/systemd/user/${name}.service`;
    }

    // If not found in expected location, check the other location as fallback
    if (!fs.existsSync(configPath)) {
      const fallbackPath = system
        ? `${os.homedir()}/.config/systemd/user/${name}.service`
        : `/etc/systemd/system/${name}.service`;

      if (fs.existsSync(fallbackPath)) {
        configPath = fallbackPath;
        console.warn(`Service found in ${system ? 'user' : 'system'} location instead of expected ${system ? 'system' : 'user'} location.`);
      } else {
        throw new Error(`Service configuration for "${name}" not found in standard locations.`);
      }
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      return {
        name,
        platform: 'linux',
        configType: 'Linux Systemd Service',
        configPath,
        configContent,
        serviceLevel: configPath.startsWith('/etc/') ? 'system' : 'user',
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
export const manageService = async (register, { name, description, command, env = {}, wdir, user, system = true, autoStart = true, restartOnFailure = true }) => {
  // Format environment variables for service files
  const formattedEnv = Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' ');

  // Define service path based on system
  let servicePath;
  if (system) {
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
      // Check if file exists and warn, but allow overwrite
      if (fs.existsSync(servicePath)) {
        console.warn(`Warning: ${servicePath} already exists. Overwriting...`);
      }

      // Escape special characters in command arguments
      const escapedCommand = command.map(arg => arg.replace(/(["\s'$`\\])/g, '\\$1')).join(' ');

      // Build service file lines dynamically to avoid empty lines
      const serviceLines = [
        '[Unit]',
        `Description=${description}`,
        'After=network.target',
        '',
        '[Service]',
        `ExecStart=${escapedCommand}`,
        `Restart=${restartOnFailure ? 'always' : 'no'}`,
      ];

      // User directive is only relevant for system-level services
      if (system) {
        serviceLines.push(`User=${user || process.env.USER}`);
      }

      if (wdir) {
        serviceLines.push(`WorkingDirectory=${path.resolve(wdir)}`);
      }

      if (formattedEnv) {
        serviceLines.push(`Environment="${formattedEnv}"`);
      }

      serviceLines.push('');
      serviceLines.push('[Install]');
      // User-level services use default.target, system services use multi-user.target
      serviceLines.push(`WantedBy=${system ? 'multi-user.target' : 'default.target'}`);

      const serviceContent = serviceLines.join('\n');

      try {
        fs.writeFileSync(servicePath, serviceContent);

        // Check if we need sudo for system-level services
        const needsSudo = servicePath.startsWith('/etc/');

        // For user-level services, use --user flag
        const userFlag = !system ? ' --user' : '';

        // For user-level services, first try to reload daemon
        if (!system) {
          try {
            execSync('systemctl --user daemon-reload 2>&1');
          } catch (reloadErr) {
            // If daemon-reload fails due to D-Bus issues, provide helpful message
            if (reloadErr.message.includes('DBUS_SESSION_BUS_ADDRESS') ||
                reloadErr.message.includes('XDG_RUNTIME_DIR') ||
                reloadErr.message.includes('Failed to connect to bus')) {
              console.warn('Warning: Cannot connect to user systemd session (D-Bus not available).');
              console.warn('This is common in SSH sessions without a login session.');
              console.warn('');
              console.warn('Service file created at:', servicePath);
              console.warn('');
              console.warn('To enable this service, you have two options:');
              console.warn('');
              console.warn('Option 1 - Enable lingering (recommended for services):');
              console.warn('  sudo loginctl enable-linger $USER');
              console.warn('  Then logout and login again, or run:');
              console.warn('  export XDG_RUNTIME_DIR=/run/user/$(id -u)');
              console.warn('  systemctl --user daemon-reload');
              console.warn('  systemctl --user enable ' + name);
              console.warn('  systemctl --user start ' + name);
              console.warn('');
              console.warn('Option 2 - Use system-level service instead:');
              console.warn('  Register with system=true parameter');
              console.warn('');

              return resolve('Service file created, but manual activation required (see warnings above)');
            }
            // Other errors, continue to try enable
          }
        }

        // Build the command based on autoStart parameter
        let enableCmd = `${needsSudo ? 'sudo ' : ''}systemctl${userFlag} enable ${name}`;

        // Only start the service if autoStart is true
        if (autoStart) {
          enableCmd += ` && ${needsSudo ? 'sudo ' : ''}systemctl${userFlag} start ${name}`;
        }

        exec(enableCmd, (err, stdout, stderr) => {
          if (err) {
            console.error(`Linux service error: ${stderr}`);

            // Check for D-Bus connection issues
            if (stderr.includes('DBUS_SESSION_BUS_ADDRESS') ||
                stderr.includes('XDG_RUNTIME_DIR') ||
                stderr.includes('Failed to connect to bus')) {
              console.error('');
              console.error('D-Bus session bus is not available. This is common in SSH sessions.');
              console.error('Service file has been created at:', servicePath);
              console.error('');
              console.error('To fix this issue:');
              console.error('1. Enable lingering: sudo loginctl enable-linger $USER');
              console.error('2. Set environment: export XDG_RUNTIME_DIR=/run/user/$(id -u)');
              console.error('3. Reload daemon: systemctl --user daemon-reload');
              console.error('4. Enable service: systemctl --user enable ' + name);
              if (autoStart) {
                console.error('5. Start service: systemctl --user start ' + name);
              }
              console.error('');
              console.error('Or use system-level service instead (requires sudo).');
            } else if (stderr.includes('Permission denied') || stderr.includes('Interactive authentication required')) {
              if (system) {
                console.error('This operation requires root privileges. Try running with sudo.');
              } else {
                console.error('User-level service registration failed. Make sure systemd user services are enabled.');
              }
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

      // For user-level services, use --user flag
      const userFlag = !system ? ' --user' : '';
      const prefix = needsSudo ? 'sudo ' : '';

      // Stop service first (ignore errors if service is not running)
      exec(`${prefix}systemctl${userFlag} stop ${name} 2>/dev/null; ${prefix}systemctl${userFlag} disable ${name}`, (err, stdout, stderr) => {
        if (err) {
          console.error(`Linux service disable error: ${stderr}`);
          if (stderr.includes('Permission denied') || stderr.includes('Interactive authentication required')) {
            console.error(system
              ? 'This operation requires root privileges. Try running with sudo.'
              : 'User-level service unregister failed. Check D-Bus session.');
          }
          reject(err);
        } else {
          // Remove the service file
          try {
            fs.unlinkSync(servicePath);
            console.log(`Service "${name}" unregistered successfully on Linux.`);
            resolve(stdout);
          } catch (rmErr) {
            console.error(`Error removing service file: ${rmErr.message}`);
            reject(rmErr);
          }
        }
      });
    }
  });
};

/**
 * Start or stop a Linux service
 * @param {boolean} start - Whether to start (true) or stop (false) the service
 * @param {string} name - Service name
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<string>} - Command output
 */
export const startStopService = async (start, name, system = true) => {
  return new Promise((resolve, reject) => {
    // Check if we need sudo for system-level services
    const needsSudo = system;

    // For user-level services, use --user flag
    const userFlag = !system ? ' --user' : '';

    const cmd = `${needsSudo ? 'sudo ' : ''}systemctl${userFlag} ${start ? 'start' : 'stop'} ${name}`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`Linux ${start ? 'start' : 'stop'} error: ${stderr}`);
        if (stderr.includes('DBUS_SESSION_BUS_ADDRESS') || stderr.includes('Failed to connect to bus')) {
          console.error('D-Bus session bus is not available. See documentation for user-level service setup.');
        } else if (stderr.includes('Permission denied') || stderr.includes('Interactive authentication required')) {
          console.error(system
            ? 'This operation requires root privileges. Try running with sudo.'
            : 'User-level service operation failed. Check D-Bus session.');
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
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<string>} - Command output
 */
export const enableService = async (name, system = true) => {
  // Define service path based on system
  const servicePath = system
    ? `/etc/systemd/system/${name}.service`
    : `${os.homedir()}/.config/systemd/user/${name}.service`;

  return new Promise((resolve, reject) => {
    if (!checkFileExists(servicePath, true, "enable")) {
      return reject(new Error(`${servicePath} does not exist`));
    }

    // Check if we need sudo for system-level services
    const needsSudo = servicePath.startsWith('/etc/');

    // For user-level services, use --user flag
    const userFlag = !system ? ' --user' : '';

    const cmd = `${needsSudo ? 'sudo ' : ''}systemctl${userFlag} enable ${name}`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`Linux service enable error: ${stderr}`);
        if (stderr.includes('DBUS_SESSION_BUS_ADDRESS') || stderr.includes('Failed to connect to bus')) {
          console.error('D-Bus session bus is not available. See documentation for user-level service setup.');
        } else if (stderr.includes('Permission denied') || stderr.includes('Interactive authentication required')) {
          console.error(system
            ? 'This operation requires root privileges. Try running with sudo.'
            : 'User-level service enable failed. Make sure systemd user services are enabled.');
        }
        reject(err);
      } else {
        console.log(`Service "${name}" enabled successfully on Linux.`);
        resolve(stdout);
      }
    });
  });
};
