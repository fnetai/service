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
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<string>} - Service status
 */
export const getServiceStatus = async (name, system = true) => {
  try {
    const sudo = system ? 'sudo ' : '';

    try {
      // Try direct service lookup first
      const macStatus = execSync(`${sudo}launchctl list "${name}" 2>/dev/null`).toString();

      // If we get here, the service exists
      // Check if it has a PID (running)
      if (macStatus.includes('"PID" = ')) {
        return ServiceStatus.RUNNING;
      }
      return ServiceStatus.STOPPED;
    } catch (directError) {
      // Direct lookup failed, try grep approach
      try {
        const grepResult = execSync(`${sudo}launchctl list | grep "${name}"`).toString().trim();

        if (!grepResult) {
          return ServiceStatus.UNKNOWN;
        }

        // Parse: PID  Status  Label
        const [pid] = grepResult.split(/\s+/);
        return pid && pid !== '-' && parseInt(pid) > 0 ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
      } catch (grepError) {
        return ServiceStatus.UNKNOWN;
      }
    }
  } catch (error) {
    console.error(`Error getting macOS service status: ${error.message}`);
    return ServiceStatus.UNKNOWN;
  }
};

/**
 * Check service health on macOS
 * @param {string} name - Service name
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<Object>} - Health information
 */
export const checkServiceHealth = async (name, system = true) => {
  try {
    const status = await getServiceStatus(name, system);
    const result = {
      healthy: status === ServiceStatus.RUNNING,
      status,
      timestamp: new Date().toISOString()
    };

    // If not healthy, attach recent logs for diagnostics
    if (!result.healthy) {
      try {
        const logs = await getServiceLogs(name, 20);
        result.logs = logs;
      } catch (_) { /* ignore log errors */ }
    }

    return result;
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
 * Get service logs on macOS
 * @param {string} name - Service name
 * @param {number} lines - Number of log lines to return
 * @returns {Promise<string>} - Service logs
 */
export const getServiceLogs = async (name, lines = 50) => {
  try {
    // macOS uses unified logging system (log show)
    const logs = execSync(
      `log show --predicate 'senderImagePath CONTAINS "${name}" OR subsystem == "${name}"' --last 1h --style compact 2>/dev/null | tail -${lines}`
    ).toString().trim();

    if (logs) return logs;

    // Fallback: check stderr/stdout log files if configured in plist
    const plistPaths = [
      `/Library/LaunchDaemons/${name}.plist`,
      `${os.homedir()}/Library/LaunchAgents/${name}.plist`
    ];

    for (const plistPath of plistPaths) {
      if (fs.existsSync(plistPath)) {
        const plistContent = fs.readFileSync(plistPath, 'utf8');

        // Extract StandardErrorPath or StandardOutPath
        const stderrMatch = plistContent.match(/<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/);
        const stdoutMatch = plistContent.match(/<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/);

        const logParts = [];
        if (stderrMatch && fs.existsSync(stderrMatch[1])) {
          logParts.push(`--- stderr ---\n${execSync(`tail -${lines} "${stderrMatch[1]}"`).toString()}`);
        }
        if (stdoutMatch && fs.existsSync(stdoutMatch[1])) {
          logParts.push(`--- stdout ---\n${execSync(`tail -${lines} "${stdoutMatch[1]}"`).toString()}`);
        }

        if (logParts.length > 0) return logParts.join('\n');
      }
    }

    return 'No logs found.';
  } catch (error) {
    return `Error retrieving logs: ${error.message}`;
  }
};

/**
 * Inspect service configuration on macOS
 * @param {string} name - Service name
 * @param {boolean} system - Whether the service is system-wide
 * @returns {Promise<Object>} - Service configuration
 */
export const inspectServiceConfig = async (name, system = true) => {
  try {
    // Define plist path based on system parameter
    const plistPath = system
      ? `/Library/LaunchDaemons/${name}.plist`
      : `${os.homedir()}/Library/LaunchAgents/${name}.plist`;

    // Check if the plist file exists
    if (!fs.existsSync(plistPath)) {
      // If the specified location doesn't exist, try the alternative location
      const altPlistPath = system
        ? `${os.homedir()}/Library/LaunchAgents/${name}.plist`
        : `/Library/LaunchDaemons/${name}.plist`;

      if (fs.existsSync(altPlistPath)) {
        console.log(`Service configuration not found at ${plistPath}, but found at ${altPlistPath}`);
        return readServiceConfig(name, altPlistPath);
      }

      // Also check in /Library/LaunchAgents for system-wide but non-root services
      if (system && fs.existsSync(`/Library/LaunchAgents/${name}.plist`)) {
        console.log(`Service configuration found in /Library/LaunchAgents/${name}.plist`);
        return readServiceConfig(name, `/Library/LaunchAgents/${name}.plist`);
      }

      throw new Error(`Service configuration for "${name}" not found in standard locations.`);
    }

    return readServiceConfig(name, plistPath);
  } catch (error) {
    throw error;
  }
};

/**
 * Helper function to read service configuration
 * @private
 * @param {string} name - Service name
 * @param {string} configPath - Path to the configuration file
 * @returns {Promise<Object>} - Service configuration
 */
const readServiceConfig = (name, configPath) => {
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const configType = configPath.includes('LaunchDaemons')
      ? 'macOS LaunchDaemon (System)'
      : 'macOS LaunchAgent (User)';

    return {
      name,
      platform: 'darwin',
      configType,
      configPath,
      configContent,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw new Error(`Error reading service configuration: ${error.message}`);
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
        // Ensure the LaunchAgents directory exists for user-level services
        if (!system) {
          const userLaunchAgentsDir = `${os.homedir()}/Library/LaunchAgents`;
          if (!fs.existsSync(userLaunchAgentsDir)) {
            try {
              fs.mkdirSync(userLaunchAgentsDir, { recursive: true });
              console.log(`Created directory: ${userLaunchAgentsDir}`);
            } catch (dirError) {
              console.error(`Error creating LaunchAgents directory: ${dirError.message}`);
              reject(new Error(`Failed to create LaunchAgents directory: ${dirError.message}`));
              return;
            }
          }
        }

        try {
          fs.writeFileSync(plistPath, plistContent);
        } catch (writeError) {
          if (writeError.code === 'EACCES') {
            console.error(`Permission denied when writing to ${plistPath}`);
            if (system) {
              reject(new Error(`Permission denied. System-level services require root privileges. Try running with sudo.`));
            } else {
              reject(new Error(`Permission denied when writing to ${plistPath}. Check your user permissions.`));
            }
            return;
          }
          throw writeError;
        }

        // Check if we need sudo for system-level services
        const needsSudo = plistPath.startsWith('/Library/');

        // Determine the domain based on system
        const domain = system ? 'system' : `gui/${os.userInfo().uid}`;

        // Try modern approach first (macOS 11+)
        const bootstrapCmd = `${needsSudo ? 'sudo ' : ''}launchctl bootstrap ${domain} ${plistPath}`;

        exec(bootstrapCmd, (bootstrapErr, bootstrapStdout, bootstrapStderr) => {
          if (bootstrapErr) {
            console.log(`Modern launchctl bootstrap failed, trying legacy load...`);

            // Fall back to legacy approach
            const loadCmd = `${needsSudo ? 'sudo ' : ''}launchctl load -w ${plistPath}`;

            exec(loadCmd, (err, stdout, stderr) => {
              if (err) {
                console.error(`macOS service error: ${stderr}`);
                if (stderr.includes('Permission denied')) {
                  if (system) {
                    console.error('This operation requires root privileges. Try running with sudo.');
                  } else {
                    console.error(`Permission denied when loading ${plistPath}. Check your user permissions.`);
                  }
                }
                reject(err);
              } else {
                console.log(`Service "${name}" registered successfully on macOS (legacy method).`);
                resolve(stdout);
              }
            });
          } else {
            console.log(`Service "${name}" registered successfully on macOS.`);
            resolve(bootstrapStdout);
          }
        });
      } catch (error) {
        console.error(`Error registering service: ${error.message}`);
        reject(error);
      }
    } else {
      if (!checkFileExists(plistPath, true, "unregister")) {
        return reject(new Error(`${plistPath} does not exist`));
      }

      // Check if we need sudo for system-level services
      const needsSudo = plistPath.startsWith('/Library/');

      // Determine the domain based on system
      const domain = system ? 'system' : `gui/${os.userInfo().uid}`;

      // Try modern approach first (macOS 11+)
      const bootoutCmd = `${needsSudo ? 'sudo ' : ''}launchctl bootout ${domain} ${plistPath}`;

      exec(bootoutCmd, (bootoutErr, bootoutStdout) => {
        if (bootoutErr) {
          console.log(`Modern launchctl bootout failed, trying legacy unload...`);

          // Fall back to legacy approach
          const unloadCmd = `${needsSudo ? 'sudo ' : ''}launchctl unload -w ${plistPath}`;

          exec(unloadCmd, (unloadErr, unloadStdout, unloadStderr) => {
            if (unloadErr) {
              console.error(`macOS service unload error: ${unloadStderr}`);
              if (unloadStderr.includes('Permission denied')) {
                if (system) {
                  console.error('This operation requires root privileges. Try running with sudo.');
                } else {
                  console.error(`Permission denied when unloading ${plistPath}. Check your user permissions.`);
                }
              }
              reject(unloadErr);
              return;
            }

            // Now try to remove the plist file
            const rmCmd = `${needsSudo ? 'sudo ' : ''}rm ${plistPath}`;
            exec(rmCmd, (rmErr, rmStdout, rmStderr) => {
              if (rmErr) {
                console.error(`Error removing plist file: ${rmStderr}`);
                if (rmStderr.includes('Permission denied')) {
                  if (system) {
                    console.error('Removing the plist file requires root privileges. Try running with sudo.');
                  } else {
                    console.error(`Permission denied when removing ${plistPath}. Check your user permissions.`);
                  }
                }
                // Don't reject here, as the service was unloaded successfully
                console.log(`Service "${name}" unloaded successfully, but the plist file could not be removed.`);
                resolve(unloadStdout);
              } else {
                console.log(`Service "${name}" unregistered successfully on macOS (legacy method).`);
                resolve(rmStdout);
              }
            });
          });
        } else {
          // Now try to remove the plist file
          const rmCmd = `${needsSudo ? 'sudo ' : ''}rm ${plistPath}`;
          exec(rmCmd, (rmErr, rmStdout, rmStderr) => {
            if (rmErr) {
              console.error(`Error removing plist file: ${rmStderr}`);
              if (rmStderr.includes('Permission denied')) {
                if (system) {
                  console.error('Removing the plist file requires root privileges. Try running with sudo.');
                } else {
                  console.error(`Permission denied when removing ${plistPath}. Check your user permissions.`);
                }
              }
              // Don't reject here, as the service was unloaded successfully
              console.log(`Service "${name}" unloaded successfully, but the plist file could not be removed.`);
              resolve(bootoutStdout);
            } else {
              console.log(`Service "${name}" unregistered successfully on macOS.`);
              resolve(rmStdout);
            }
          });
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
      domain = `gui/${os.userInfo().uid}`;
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
      domain = `gui/${os.userInfo().uid}`;
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
