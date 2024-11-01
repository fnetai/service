import { exec } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export default async ({ action, name, description, command, user, env = {}, working_dir }) => {
  const platform = os.platform();
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
};