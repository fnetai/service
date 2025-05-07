import { exec, execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Add service status type definition
const ServiceStatus = {
  RUNNING: 'running',
  STOPPED: 'stopped',
  FAILED: 'failed',
  UNKNOWN: 'unknown'
};

// Add helper for Windows environment and working directory
const createWindowsEnvScript = (command, env, working_dir) => {
  const envVars = Object.entries(env)
    .map(([key, value]) => `set "${key}=${value}"`)
    .join(' && ');
  const cdCommand = working_dir ? `cd /d "${working_dir}" && ` : '';
  return `${envVars} && ${cdCommand}${command.join(' ')}`;
};

// Add status checking functionality
const getServiceStatus = async (name, platform) => {
  try {
    switch (platform) {
      case 'win32':
        const winStatus = execSync(`sc query "${name}"`).toString();
        if (winStatus.includes('RUNNING')) return ServiceStatus.RUNNING;
        if (winStatus.includes('STOPPED')) return ServiceStatus.STOPPED;
        return ServiceStatus.UNKNOWN;

      case 'darwin':
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

      case 'linux':
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

      default:
        return ServiceStatus.UNKNOWN;
    }
  } catch (error) {
    console.error(`Error getting service status: ${error.message}`);
    return ServiceStatus.UNKNOWN;
  }
};

// Add service configuration inspection functionality
const inspectServiceConfig = async (name, platform) => {
  try {
    // Determine the service configuration file path based on platform
    let configPath;
    let configContent;

    switch (platform) {
      case 'win32':
        // For Windows, we can query the service configuration
        try {
          configContent = execSync(`sc qc "${name}"`).toString();
          return {
            name,
            platform,
            configType: 'Windows Service',
            configContent,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          throw new Error(`Service "${name}" not found or cannot be accessed: ${error.message}`);
        }

      case 'darwin':
        // For macOS, check both system and user locations
        const systemPlistPath = `/Library/LaunchDaemons/${name}.plist`;
        const userPlistPath = `${os.homedir()}/Library/LaunchAgents/${name}.plist`;

        if (fs.existsSync(systemPlistPath)) {
          configPath = systemPlistPath;
        } else if (fs.existsSync(userPlistPath)) {
          configPath = userPlistPath;
        } else {
          throw new Error(`Service configuration for "${name}" not found in standard locations.`);
        }

        try {
          configContent = fs.readFileSync(configPath, 'utf8');
          return {
            name,
            platform,
            configType: 'macOS LaunchDaemon/LaunchAgent',
            configPath,
            configContent,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          throw new Error(`Error reading service configuration: ${error.message}`);
        }

      case 'linux':
        // For Linux, check both system and user locations
        const systemServicePath = `/etc/systemd/system/${name}.service`;
        const userServicePath = `${os.homedir()}/.config/systemd/user/${name}.service`;

        if (fs.existsSync(systemServicePath)) {
          configPath = systemServicePath;
        } else if (fs.existsSync(userServicePath)) {
          configPath = userServicePath;
        } else {
          throw new Error(`Service configuration for "${name}" not found in standard locations.`);
        }

        try {
          configContent = fs.readFileSync(configPath, 'utf8');
          return {
            name,
            platform,
            configType: 'Linux Systemd Service',
            configPath,
            configContent,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          throw new Error(`Error reading service configuration: ${error.message}`);
        }

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  } catch (error) {
    console.error(`Error inspecting service configuration: ${error.message}`);
    throw error;
  }
};

// Add health check functionality
const checkServiceHealth = async (name, platform) => {
  try {
    const status = await getServiceStatus(name, platform);
    if (status === ServiceStatus.FAILED) {
      // Get service logs for diagnostics
      const logs = platform === 'linux'
        ? execSync(`journalctl -u "${name}" --no-pager -n 50`).toString()
        : 'Logs not available for this platform';

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

// Enhance Windows service registration
const windowsService = async (register, { name, description, command, env = {}, working_dir, autoStart = true, restartOnFailure = true }) => {
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
 * @typedef {Object} Input
 * @property {'register' | 'unregister' | 'start' | 'stop' | 'enable' | 'status' | 'health' | 'inspect'} action - The operation to perform on the service
 * @property {string} name - Service identifier
 * @property {string} [description] - Service description (required for registration)
 * @property {string[]} [command] - Command array to execute (required for registration)
 * @property {string} [user] - User account to run the service
 * @property {Record<string, string>} [env] - Environment variables for the service
 * @property {string} [working_dir] - Working directory for the service
 * @property {boolean} [system_level=true] - Whether to register as system-wide service (true) or user-level service (false)
 * @property {boolean} [autoStart=false] - Whether to start the service automatically on registration or system startup
 * @property {boolean} [restartOnFailure=false] - Whether to restart the service automatically if it fails or stops
 */

/**
 * @typedef {Object} Output
 * @property {boolean} healthy - Indicates if the service is healthy
 * @property {'running' | 'stopped' | 'failed' | 'unknown'} status - Current service status
 * @property {string} [logs] - Service logs (available for Linux when status is 'failed')
 * @property {string} [error] - Error message if operation failed
 * @property {string} timestamp - ISO timestamp of the status check
 */

/**
 * Manages system services across Windows, macOS, and Linux platforms
 * @param {Input} config - Service configuration object
 * @returns {Promise<Output|void>} Returns status information for 'status', 'health', and 'inspect' actions
 * @throws {Error} Throws if configuration validation fails or operation errors occur
 * @example
 * // Register a new system-wide service with default startup behavior
 * await manageService({
 *   action: 'register',
 *   name: 'MyService',
 *   description: 'Example service',
 *   command: ['node', '/path/to/app.js'],
 *   env: { NODE_ENV: 'production' },
 *   system_level: true
 * });
 *
 * // Register a service that doesn't start automatically and doesn't restart on failure
 * await manageService({
 *   action: 'register',
 *   name: 'MyManualService',
 *   description: 'Service that requires manual start',
 *   command: ['node', '/path/to/app.js'],
 *   autoStart: false,
 *   restartOnFailure: false
 * });
 *
 * // Register a user-level service
 * await manageService({
 *   action: 'register',
 *   name: 'MyUserService',
 *   description: 'Example user service',
 *   command: ['node', '/path/to/app.js'],
 *   env: { NODE_ENV: 'development' },
 *   system_level: false
 * });
 *
 * // Check service health
 * const health = await manageService({
 *   action: 'health',
 *   name: 'MyService'
 * });
 *
 * // Inspect service configuration
 * const config = await manageService({
 *   action: 'inspect',
 *   name: 'MyService'
 * });
 *
 * // Note: On macOS, 'start' and 'stop' actions use launchctl load/unload
 * // which is the proper way to control services in macOS's launchd system
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

    // Add status check action
    if (action === 'status') {
      return await getServiceStatus(name, platform);
    }

    // Add health check action
    if (action === 'health') {
      return await checkServiceHealth(name, platform);
    }

    // Add inspect action to show service configuration
    if (action === 'inspect') {
      return await inspectServiceConfig(name, platform);
    }

    // Define paths based on system_level option
    let plistPath, servicePath;

    if (system_level) {
      // System-wide services
      plistPath = `/Library/LaunchDaemons/${name}.plist`;
      servicePath = `/etc/systemd/system/${name}.service`;
    } else {
      // User-level services
      const homeDir = os.homedir();
      plistPath = `${homeDir}/Library/LaunchAgents/${name}.plist`;

      // For Linux, use user-level systemd directory
      // Create the directory if it doesn't exist
      const userSystemdDir = `${homeDir}/.config/systemd/user`;
      if (platform === 'linux' && !fs.existsSync(userSystemdDir)) {
        fs.mkdirSync(userSystemdDir, { recursive: true });
      }
      servicePath = `${userSystemdDir}/${name}.service`;
    }

    // Format environment variables for service files
    const formattedEnv = Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' ');

    // Helper function to check file existence and log warnings
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

    // Windows service register/unregister functions are handled by the windowsService function defined earlier

    // macOS service register/unregister functions
    const macService = async (register) => {
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
              ${working_dir ? `<key>WorkingDirectory</key><string>${path.resolve(working_dir)}</string>` : ''}
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

    // Linux service register/unregister functions
    const linuxService = async (register) => {
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

    // Platform-specific start/stop functions
    const windowsServiceStartStop = async (start) => {
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

    const macServiceStartStop = async (start) => {
      return new Promise((resolve, reject) => {
        if (!checkFileExists(plistPath, true, start ? "start" : "stop")) {
          return reject(new Error(`${plistPath} does not exist`));
        }

        // Check if we need sudo for system-level services
        const needsSudo = plistPath.startsWith('/Library/');

        // Determine the domain based on system_level
        let domain;
        if (system_level) {
          domain = 'system';
        } else {
          // For user-level services, use the current user's UID
          domain = `gui/$(id -u)`;
        }

        let cmd;
        if (start) {
          // First try to start the service using the label (modern approach)
          cmd = `${needsSudo ? 'sudo ' : ''}launchctl start ${name}`;

          exec(cmd, (err, stdout, stderr) => {
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

              exec(loadCmd, (loadErr, loadStdout, loadStderr) => {
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

          exec(cmd, (err, stdout, stderr) => {
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

              exec(unloadCmd, (unloadErr, unloadStdout, unloadStderr) => {
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

    const linuxServiceStartStop = async (start) => {
      return new Promise((resolve, reject) => {
        // Check if we need sudo for system-level services
        const needsSudo = servicePath.startsWith('/etc/');
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

    // Platform-specific enable function
    const enableService = async () => {
      return new Promise((resolve, reject) => {
        if (platform === 'linux') {
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
        } else if (platform === 'darwin') {
          if (!checkFileExists(plistPath, true, "enable")) {
            return reject(new Error(`${plistPath} does not exist`));
          }

          // Check if we need sudo for system-level services
          const needsSudo = plistPath.startsWith('/Library/');

          // Determine the domain based on system_level
          let domain;
          if (system_level) {
            domain = 'system';
          } else {
            // For user-level services, use the current user's UID
            domain = `gui/$(id -u)`;
          }

          // Modern approach (macOS 11+): Use enable to enable the service
          const enableCmd = `${needsSudo ? 'sudo ' : ''}launchctl enable ${domain}/${name}`;

          exec(enableCmd, (err, stdout, stderr) => {
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
        } else {
          console.log("Enable action is not required or supported on this platform.");
          resolve();
        }
      });
    };

    // Evaluate action and execute respective function
    if (action === 'register') {
      if (platform === 'win32') {
        return await windowsService(true, { name, description, command, env, working_dir, autoStart, restartOnFailure });
      } else if (platform === 'darwin') {
        return await macService(true);
      } else if (platform === 'linux') {
        return await linuxService(true);
      } else {
        throw new Error("Unsupported platform.");
      }
    } else if (action === 'unregister') {
      if (platform === 'win32') {
        return await windowsService(false, { name, description, command, env, working_dir });
      } else if (platform === 'darwin') {
        return await macService(false);
      } else if (platform === 'linux') {
        return await linuxService(false);
      } else {
        throw new Error("Unsupported platform.");
      }
    } else if (action === 'start') {
      if (platform === 'win32') {
        return await windowsServiceStartStop(true);
      } else if (platform === 'darwin') {
        return await macServiceStartStop(true);
      } else if (platform === 'linux') {
        return await linuxServiceStartStop(true);
      } else {
        throw new Error("Unsupported platform.");
      }
    } else if (action === 'stop') {
      if (platform === 'win32') {
        return await windowsServiceStartStop(false);
      } else if (platform === 'darwin') {
        return await macServiceStartStop(false);
      } else if (platform === 'linux') {
        return await linuxServiceStartStop(false);
      } else {
        throw new Error("Unsupported platform.");
      }
    } else if (action === 'enable') {
      return await enableService();
    } else if (action === 'status' || action === 'health' || action === 'inspect') {
      // These actions are already handled above
      // This is just to prevent the error message below
    } else {
      throw new Error("Invalid action. Use 'register', 'unregister', 'start', 'stop', 'enable', 'status', 'health', or 'inspect'.");
    }
  } catch (error) {
    console.error('Service operation failed:', error.message);
    throw error;
  }
};
