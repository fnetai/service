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
        const macStatus = execSync(`launchctl list | grep "${name}"`).toString();
        // Parse macOS service status
        const [pid] = macStatus.split(/\s+/);
        return pid && parseInt(pid) > 0 ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;

      case 'linux':
        const linuxStatus = execSync(`systemctl is-active "${name}"`).toString().trim();
        switch (linuxStatus) {
          case 'active': return ServiceStatus.RUNNING;
          case 'failed': return ServiceStatus.FAILED;
          default: return ServiceStatus.STOPPED;
        }

      default:
        return ServiceStatus.UNKNOWN;
    }
  } catch (error) {
    console.error(`Error getting service status: ${error.message}`);
    return ServiceStatus.UNKNOWN;
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
const windowsService = async (register, { name, description, command, env = {}, working_dir }) => {
  if (register) {
    // Create a wrapper script for environment and working directory support
    const scriptPath = path.join(os.tmpdir(), `${name}-wrapper.cmd`);
    const scriptContent = createWindowsEnvScript(command, env, working_dir);
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');

    const serviceCmd = `sc create "${name}" binPath= "${scriptPath}" DisplayName= "${description}" start= auto`;

    return new Promise((resolve, reject) => {
      exec(serviceCmd, (err, stdout, stderr) => {
        if (err) {
          console.error(`Windows service error: ${stderr}`);
          reject(err);
        } else {
          console.log(`Service "${name}" registered successfully on Windows.`);
          resolve(stdout);
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
const validateConfig = ({ action, name, description, command, user, env, working_dir }) => {
  const errors = [];

  if (!name?.trim()) errors.push('Service name is required');
  if (action === 'register') {
    if (!description?.trim()) errors.push('Service description is required');
    if (!Array.isArray(command) || command.length === 0) errors.push('Command array is required');
    if (working_dir && !fs.existsSync(working_dir)) errors.push('Working directory does not exist');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
};

/**
 * @typedef {Object} Input
 * @property {'register' | 'unregister' | 'start' | 'stop' | 'enable' | 'status' | 'health'} action - The operation to perform on the service
 * @property {string} name - Service identifier
 * @property {string} [description] - Service description (required for registration)
 * @property {string[]} [command] - Command array to execute (required for registration)
 * @property {string} [user] - User account to run the service
 * @property {Record<string, string>} [env] - Environment variables for the service
 * @property {string} [working_dir] - Working directory for the service
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
 * @returns {Promise<Output|void>} Returns status information for 'status' and 'health' actions
 * @throws {Error} Throws if configuration validation fails or operation errors occur
 * @example
 * // Register a new service
 * await manageService({
 *   action: 'register',
 *   name: 'MyService',
 *   description: 'Example service',
 *   command: ['node', '/path/to/app.js'],
 *   env: { NODE_ENV: 'production' }
 * });
 *
 * // Check service health
 * const health = await manageService({
 *   action: 'health',
 *   name: 'MyService'
 * });
 */
export default async (config) => {
  try {
    validateConfig(config);

    const { action, name, env = {}, description, command, working_dir, user } = config;
    const platform = os.platform();

    // Add status check action
    if (action === 'status') {
      return await getServiceStatus(name, platform);
    }

    // Add health check action
    if (action === 'health') {
      return await checkServiceHealth(name, platform);
    }

    const plistPath = `/Library/LaunchDaemons/${name}.plist`;
    const servicePath = `/etc/systemd/system/${name}.service`;

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

    // Windows service register/unregister functions
    const windowsService = (register) => {
      const serviceCmd = register
        ? `sc create "${name}" binPath= "${command.join(' ')}" DisplayName= "${description}" start= auto`
        : `sc delete "${name}"`;

      exec(serviceCmd, (err, stdout, stderr) => {
        if (err) {
          console.error(`Windows service error: ${stderr}`);
        } else {
          console.log(`Service "${name}" ${register ? 'registered' : 'unregistered'} successfully on Windows.`);
        }
      });
    };

    // macOS service register/unregister functions
    const macService = (register) => {
      if (register) {
        if (!checkFileExists(plistPath, false, "register")) return;

        const plistContent = `
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
          <dict>
            <key>Label</key>
            <string>${name}</string>
            <key>ProgramArguments</key>
            <array>
              ${command.map(arg => `<string>${arg}</string>`).join('\n')}
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            ${working_dir ? `<key>WorkingDirectory</key><string>${path.resolve(working_dir)}</string>` : ''}
            ${user ? `<key>UserName</key><string>${user}</string>` : ''}
            ${Object.keys(env).length ? `<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join('\n')}</dict>` : ''}
          </dict>
        </plist>`;
        fs.writeFileSync(plistPath, plistContent);
        exec(`launchctl load -w ${plistPath}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`macOS service error: ${stderr}`);
          } else {
            console.log(`Service "${name}" registered successfully on macOS.`);
          }
        });
      } else {
        if (!checkFileExists(plistPath, true, "unregister")) return;

        exec(`launchctl unload -w ${plistPath} && rm ${plistPath}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`macOS service error: ${stderr}`);
          } else {
            console.log(`Service "${name}" unregistered successfully on macOS.`);
          }
        });
      }
    };

    // Linux service register/unregister functions
    const linuxService = (register) => {
      if (register) {
        if (!checkFileExists(servicePath, false, "register")) return;

        const serviceContent = `
          [Unit]
          Description=${description}
          After=network.target

          [Service]
          ExecStart=${command.join(' ')}
          Restart=always
          ${user ? `User=${user}` : `User=${process.env.USER}`}
          ${working_dir ? `WorkingDirectory=${path.resolve(working_dir)}` : ''}
          ${formattedEnv ? `Environment="${formattedEnv}"` : ''}

          [Install]
          WantedBy=multi-user.target`;

        fs.writeFileSync(servicePath, serviceContent);
        exec(`systemctl enable ${name} && systemctl start ${name}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`Linux service error: ${stderr}`);
          } else {
            console.log(`Service "${name}" registered successfully on Linux.`);
          }
        });
      } else {
        if (!checkFileExists(servicePath, true, "unregister")) return;

        exec(`systemctl stop ${name} && systemctl disable ${name} && rm ${servicePath}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`Linux service error: ${stderr}`);
          } else {
            console.log(`Service "${name}" unregistered successfully on Linux.`);
          }
        });
      }
    };

    // Platform-specific start/stop functions
    const windowsServiceStartStop = (start) => {
      exec(`sc ${start ? 'start' : 'stop'} "${name}"`, (err, stdout, stderr) => {
        if (err) {
          console.error(`Windows ${start ? 'start' : 'stop'} error: ${stderr}`);
        } else {
          console.log(`Service "${name}" ${start ? 'started' : 'stopped'} successfully on Windows.`);
        }
      });
    };

    const macServiceStartStop = (start) => {
      exec(`launchctl ${start ? 'load' : 'unload'} -w /Library/LaunchDaemons/${name}.plist`, (err, stdout, stderr) => {
        if (err) {
          console.error(`macOS ${start ? 'start' : 'stop'} error: ${stderr}`);
        } else {
          console.log(`Service "${name}" ${start ? 'started' : 'stopped'} successfully on macOS.`);
        }
      });
    };

    const linuxServiceStartStop = (start) => {
      exec(`systemctl ${start ? 'start' : 'stop'} ${name}`, (err, stdout, stderr) => {
        if (err) {
          console.error(`Linux ${start ? 'start' : 'stop'} error: ${stderr}`);
        } else {
          console.log(`Service "${name}" ${start ? 'started' : 'stopped'} successfully on Linux.`);
        }
      });
    };

    // Platform-specific enable function
    const enableService = () => {
      if (platform === 'linux') {
        if (!checkFileExists(servicePath, true, "enable")) return;
        exec(`systemctl enable ${name}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`Linux service enable error: ${stderr}`);
          } else {
            console.log(`Service "${name}" enabled successfully on Linux.`);
          }
        });
      } else if (platform === 'darwin') {
        if (!checkFileExists(plistPath, true, "enable")) return;
        exec(`sudo launchctl bootstrap system /Library/LaunchDaemons/${name}.plist`, (err, stdout, stderr) => {
          if (err) {
            console.error(`macOS service enable error: ${stderr}`);
          } else {
            console.log(`Service "${name}" enabled successfully on macOS.`);
          }
        });
      } else {
        console.log("Enable action is not required or supported on this platform.");
      }
    };

    // Evaluate action and execute respective function
    if (action === 'register') {
      if (platform === 'win32') windowsService(true);
      else if (platform === 'darwin') macService(true);
      else if (platform === 'linux') linuxService(true);
      else console.error("Unsupported platform.");
    } else if (action === 'unregister') {
      if (platform === 'win32') windowsService(false);
      else if (platform === 'darwin') macService(false);
      else if (platform === 'linux') linuxService(false);
      else console.error("Unsupported platform.");
    } else if (action === 'start') {
      if (platform === 'win32') windowsServiceStartStop(true);
      else if (platform === 'darwin') macServiceStartStop(true);
      else if (platform === 'linux') linuxServiceStartStop(true);
      else console.error("Unsupported platform.");
    } else if (action === 'stop') {
      if (platform === 'win32') windowsServiceStartStop(false);
      else if (platform === 'darwin') macServiceStartStop(false);
      else if (platform === 'linux') linuxServiceStartStop(false);
      else console.error("Unsupported platform.");
    } else if (action === 'enable') {
      enableService();
    } else {
      console.error("Invalid action. Use 'register', 'unregister', 'start', 'stop', or 'enable'.");
    }
  } catch (error) {
    console.error('Service operation failed:', error.message);
    throw error;
  }
};
