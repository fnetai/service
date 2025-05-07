/**
 * macOS-specific service management implementation
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
 * Get service status on macOS
 * @param {string} name - Service name
 * @returns {Promise<string>} - Service status
 */
export const getServiceStatus = async (name) => {
  try {
    try {
      // Check if service exists first
      const macStatus = execSync(`launchctl list | grep "${name}"`).toString();
      if (!macStatus.trim()) {
        return ServiceStatus.UNKNOWN;
      }
      // Parse macOS service status
      const [pid] = macStatus.split(/\s+/);
      return pid && parseInt(pid) > 0 ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    } catch (macError) {
      // If grep returns nothing (service doesn't exist), it will exit with code 1
      if (macError.status === 1) {
        return ServiceStatus.UNKNOWN;
      }
      throw macError;
    }
  } catch (error) {
    console.error(`Error getting macOS service status: ${error.message}`);
    return ServiceStatus.UNKNOWN;
  }
};

/**
 * Check service health on macOS
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
 * Inspect service configuration on macOS
 * @param {string} name - Service name
 * @returns {Promise<Object>} - Service configuration
 */
export const inspectServiceConfig = async (name) => {
  try {
    // Check both system and user locations
    const systemPlistPath = `/Library/LaunchDaemons/${name}.plist`;
    const userPlistPath = `${os.homedir()}/Library/LaunchAgents/${name}.plist`;

    let configPath;
    if (fs.existsSync(systemPlistPath)) {
      configPath = systemPlistPath;
    } else if (fs.existsSync(userPlistPath)) {
      configPath = userPlistPath;
    } else {
      throw new Error(`Service configuration for "${name}" not found in standard locations.`);
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      return {
        name,
        platform: 'darwin',
        configType: 'macOS LaunchDaemon/LaunchAgent',
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
 * Register or unregister a macOS service
 * @param {boolean} register - Whether to register (true) or unregister (false) the service
 * @param {Object} options - Service options
 * @returns {Promise<string>} - Command output
 */
export const manageService = async (register, { name, description, command, env = {}, wdir, user, system = true, autoStart = true, restartOnFailure = true }) => {
  // Define plist path based on system
  const plistPath = system
    ? `/Library/LaunchDaemons/${name}.plist`
    : `${os.homedir()}/Library/LaunchAgents/${name}.plist`;

  return new Promise((resolve, reject) => {
    if (register) {
      if (!checkFileExists(plistPath, false, "register")) {
        return reject(new Error(`${plistPath} already exists`));
      }

      // Escape special characters in command arguments
      const escapedCommandArgs = command.map(arg => arg.replace(/(["\s'$`\\])/g, '\\$1'));

      const plistContent = `
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>${name}</string>
          <key>ProgramArguments</key>
          <array>
            ${escapedCommandArgs.map(arg => `<string>${arg}</string>`).join('\n')}
          </array>
          <key>RunAtLoad</key>
          <${autoStart ? 'true' : 'false'}/>
          <key>KeepAlive</key>
          <${restartOnFailure ? 'true' : 'false'}/>
          ${wdir ? `<key>WorkingDirectory</key><string>${path.resolve(wdir)}</string>` : ''}
          ${user ? `<key>UserName</key><string>${user}</string>` : ''}
          ${Object.keys(env).length ? `<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join('\n')}</dict>` : ''}
        </dict>
      </plist>`;

      try {
        fs.writeFileSync(plistPath, plistContent);

        // Check if we need sudo for system-level services
        const needsSudo = plistPath.startsWith('/Library/');
        const loadCmd = `${needsSudo ? 'sudo ' : ''}launchctl load -w ${plistPath}`;

        exec(loadCmd, (err, stdout, stderr) => {
          if (err) {
            console.error(`macOS service error: ${stderr}`);
            if (stderr.includes('Permission denied')) {
              console.error('This operation requires root privileges. Try running with sudo.');
            }
            reject(err);
          } else {
            console.log(`Service "${name}" registered successfully on macOS.`);
            resolve(stdout);
          }
        });
      } catch (error) {
        reject(error);
      }
    } else {
      if (!checkFileExists(plistPath, true, "unregister")) {
        return reject(new Error(`${plistPath} does not exist`));
      }

      // Check if we need sudo for system-level services
      const needsSudo = plistPath.startsWith('/Library/');
      const unloadCmd = `${needsSudo ? 'sudo ' : ''}launchctl unload -w ${plistPath} && ${needsSudo ? 'sudo ' : ''}rm ${plistPath}`;

      exec(unloadCmd, (err, stdout, stderr) => {
        if (err) {
          console.error(`macOS service error: ${stderr}`);
          if (stderr.includes('Permission denied')) {
            console.error('This operation requires root privileges. Try running with sudo.');
          }
          reject(err);
        } else {
          console.log(`Service "${name}" unregistered successfully on macOS.`);
          resolve(stdout);
        }
      });
    }
  });
};

/**
 * Start or stop a macOS service
 * @param {boolean} start - Whether to start (true) or stop (false) the service
 * @param {string} name - Service name
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<string>} - Command output
 */
export const startStopService = async (start, name, system = true) => {
  // Define plist path based on system
  const plistPath = system
    ? `/Library/LaunchDaemons/${name}.plist`
    : `${os.homedir()}/Library/LaunchAgents/${name}.plist`;

  return new Promise((resolve, reject) => {
    if (!checkFileExists(plistPath, true, start ? "start" : "stop")) {
      return reject(new Error(`${plistPath} does not exist`));
    }

    // Check if we need sudo for system-level services
    const needsSudo = plistPath.startsWith('/Library/');

    // Determine the domain based on system
    let domain;
    if (system) {
      domain = 'system';
    } else {
      // For user-level services, use the current user's UID
      domain = `gui/$(id -u)`;
    }

    let cmd;
    if (start) {
      // First try to start the service using the label (modern approach)
      cmd = `${needsSudo ? 'sudo ' : ''}launchctl start ${name}`;

      exec(cmd, (err, stdout) => {
        if (err) {
          // If start fails, try loading the plist file
          console.log(`launchctl start failed, trying to load the plist...`);

          // Modern approach (macOS 11+): Use bootstrap to load the service
          let loadCmd;
          if (needsSudo) {
            loadCmd = `${needsSudo ? 'sudo ' : ''}launchctl bootstrap ${domain} ${plistPath}`;
          } else {
            loadCmd = `launchctl bootstrap ${domain} ${plistPath}`;
          }

          exec(loadCmd, (loadErr, loadStdout) => {
            if (loadErr) {
              // If bootstrap fails, try the legacy approach with load
              console.log(`Modern launchctl bootstrap failed, trying legacy load...`);

              const legacyCmd = `${needsSudo ? 'sudo ' : ''}launchctl load -w ${plistPath}`;

              exec(legacyCmd, (legacyErr, legacyStdout, legacyStderr) => {
                if (legacyErr) {
                  console.error(`macOS start error: ${legacyStderr}`);
                  if (legacyStderr.includes('Permission denied')) {
                    console.error('This operation requires root privileges. Try running with sudo.');
                  }
                  reject(legacyErr);
                } else {
                  console.log(`Service "${name}" started successfully on macOS (legacy method).`);
                  resolve(legacyStdout);
                }
              });
            } else {
              console.log(`Service "${name}" started successfully on macOS.`);
              resolve(loadStdout);
            }
          });
        } else {
          console.log(`Service "${name}" started successfully on macOS.`);
          resolve(stdout);
        }
      });
    } else {
      // First try to stop the service using the label
      cmd = `${needsSudo ? 'sudo ' : ''}launchctl stop ${name}`;

      exec(cmd, (err, stdout) => {
        if (err) {
          // If stop fails, try unloading the plist file
          console.log(`launchctl stop failed, trying to unload the plist...`);

          // Modern approach (macOS 11+): Use bootout to unload the service
          let unloadCmd;
          if (needsSudo) {
            unloadCmd = `${needsSudo ? 'sudo ' : ''}launchctl bootout ${domain} ${plistPath}`;
          } else {
            unloadCmd = `launchctl bootout ${domain} ${plistPath}`;
          }

          exec(unloadCmd, (unloadErr, unloadStdout) => {
            if (unloadErr) {
              // If bootout fails, try the legacy approach with unload
              console.log(`Modern launchctl bootout failed, trying legacy unload...`);

              const legacyCmd = `${needsSudo ? 'sudo ' : ''}launchctl unload -w ${plistPath}`;

              exec(legacyCmd, (legacyErr, legacyStdout, legacyStderr) => {
                if (legacyErr) {
                  console.error(`macOS stop error: ${legacyStderr}`);
                  if (legacyStderr.includes('Permission denied')) {
                    console.error('This operation requires root privileges. Try running with sudo.');
                  }
                  reject(legacyErr);
                } else {
                  console.log(`Service "${name}" stopped successfully on macOS (legacy method).`);
                  resolve(legacyStdout);
                }
              });
            } else {
              console.log(`Service "${name}" stopped successfully on macOS.`);
              resolve(unloadStdout);
            }
          });
        } else {
          console.log(`Service "${name}" stopped successfully on macOS.`);
          resolve(stdout);
        }
      });
    }
  });
};

/**
 * Enable a macOS service
 * @param {string} name - Service name
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<string>} - Command output
 */
export const enableService = async (name, system = true) => {
  // Define plist path based on system
  const plistPath = system
    ? `/Library/LaunchDaemons/${name}.plist`
    : `${os.homedir()}/Library/LaunchAgents/${name}.plist`;

  return new Promise((resolve, reject) => {
    if (!checkFileExists(plistPath, true, "enable")) {
      return reject(new Error(`${plistPath} does not exist`));
    }

    // Check if we need sudo for system-level services
    const needsSudo = plistPath.startsWith('/Library/');

    // Determine the domain based on system
    let domain;
    if (system) {
      domain = 'system';
    } else {
      // For user-level services, use the current user's UID
      domain = `gui/$(id -u)`;
    }

    // Modern approach (macOS 11+): Use enable to enable the service
    const enableCmd = `${needsSudo ? 'sudo ' : ''}launchctl enable ${domain}/${name}`;

    exec(enableCmd, (err, stdout) => {
      if (err) {
        // If enable fails, try the legacy approach with load -w
        console.log(`Modern launchctl enable failed, trying legacy load -w...`);

        const legacyCmd = `${needsSudo ? 'sudo ' : ''}launchctl load -w ${plistPath}`;

        exec(legacyCmd, (legacyErr, legacyStdout, legacyStderr) => {
          if (legacyErr) {
            console.error(`macOS service enable error: ${legacyStderr}`);
            if (legacyStderr.includes('Permission denied')) {
              console.error('This operation requires root privileges. Try running with sudo.');
            }
            reject(legacyErr);
          } else {
            console.log(`Service "${name}" enabled successfully on macOS (legacy method).`);
            resolve(legacyStdout);
          }
        });
      } else {
        console.log(`Service "${name}" enabled successfully on macOS.`);
        resolve(stdout);
      }
    });
  });
};
