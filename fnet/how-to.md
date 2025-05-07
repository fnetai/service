# @fnet/service Developer Guide

## Overview

The `@fnet/service` library provides a straightforward interface for managing operating system services across different platforms: Windows, macOS, and Linux. It allows developers to register, unregister, start, stop, enable services, and monitor their status and health. This can be especially useful for automating service management tasks in environments where applications require consistent setup and execution as a background process.

## Installation

You can install the `@fnet/service` library using npm or yarn:

```bash
npm install @fnet/service
```

```bash
yarn add @fnet/service
```

## Usage

The primary export of the library is a function that allows you to control services. The function requires specific parameters that define the action and service properties.

### Parameters

- `action`: The operation to perform (`register`, `unregister`, `start`, `stop`, `enable`, `status`, `health`, `inspect`)
- `name`: The name of the service
- `description`: A brief description of the service (required for registration)
- `command`: An array of command-line arguments to run the service (required for registration)
- `user`: The user under whose account the service will run (optional)
- `env`: An object defining environment variables for the service (optional)
- `wdir`: The working directory for the service (optional)
- `system`: Whether to register as system-wide service (true) or user-level service (false) (default: true)
- `autoStart`: Whether to start the service automatically on registration or system startup (default: true)
- `restartOnFailure`: Whether to restart the service automatically if it fails or stops (default: true)

### Example Usages

Registering a new service:

```javascript
import manageService from '@fnet/service';

// Register a service with default settings (autoStart: true, restartOnFailure: true)
await manageService({
    action: 'register',
    name: 'MyService',
    description: 'A demo service',
    command: ['node', '/path/to/app.js'],
    user: 'serviceUser',
    env: { NODE_ENV: 'production' },
    wdir: '/path/to/working/directory'
});

// Register a service that doesn't start automatically and doesn't restart on failure
await manageService({
    action: 'register',
    name: 'MyManualService',
    description: 'Service that requires manual start',
    command: ['node', '/path/to/app.js'],
    autoStart: false,
    restartOnFailure: false
});

// Register a user-level service instead of system-wide
await manageService({
    action: 'register',
    name: 'MyUserService',
    description: 'User-level service',
    command: ['node', '/path/to/app.js'],
    system: false
});
```

Starting a registered service:

```javascript
await manageService({
    action: 'start',
    name: 'MyService'
});
```

Checking service status:

```javascript
const status = await manageService({
    action: 'status',
    name: 'MyService'
});
// Returns: { status: 'running' | 'stopped' | 'failed' | 'unknown' }
```

Monitoring service health:

```javascript
const health = await manageService({
    action: 'health',
    name: 'MyService'
});
// Returns: {
//   healthy: boolean,
//   status: 'running' | 'stopped' | 'failed' | 'unknown',
//   logs?: string,
//   error?: string,
//   timestamp: string
// }
```

Inspecting service configuration:

```javascript
const config = await manageService({
    action: 'inspect',
    name: 'MyService'
});
// Returns: {
//   name: string,
//   platform: 'win32' | 'darwin' | 'linux',
//   configType: string,
//   configPath?: string,
//   configContent: string,
//   timestamp: string
// }
```

Enabling service auto-start:

```javascript
await manageService({
    action: 'enable',
    name: 'MyService'
});
```

Unregistering a service:

```javascript
await manageService({
    action: 'unregister',
    name: 'MyService'
});
```

## Platform-Specific Details

### Windows

- Uses Windows Service Control (`sc`) commands
- Supports environment variables and working directory through wrapper scripts
- Configurable startup behavior with `autoStart` parameter
- Configurable failure recovery with `restartOnFailure` parameter
- Full service status monitoring and configuration inspection

### macOS

- Uses `launchctl` and `.plist` files
- System-wide services in `/Library/LaunchDaemons/` or user-level in `~/Library/LaunchAgents/`
- Supports both modern (macOS 11+) and legacy launchctl commands
- Configurable `RunAtLoad` (via `autoStart`) and `KeepAlive` (via `restartOnFailure`) options
- Environment variables and working directory support
- Service configuration inspection

### Linux

- Uses `systemd` service management
- System-wide services in `/etc/systemd/system/` or user-level in `~/.config/systemd/user/`
- Configurable automatic startup with `autoStart` parameter
- Configurable restart behavior with `restartOnFailure` parameter
- Detailed status, health monitoring, and configuration inspection with journalctl integration

## Error Handling

The library implements comprehensive error handling:

- Configuration validation
- File existence checks
- Platform-specific error reporting
- Service status monitoring
- Health check capabilities

When errors occur, the library throws an Error with a descriptive message. For status and health checks, error information is included in the returned object.

## Best Practices

1. Always provide descriptive service names and descriptions
2. Set appropriate user permissions for security
3. Configure working directories when needed using the `wdir` parameter
4. Handle environment variables appropriately
5. Consider whether services should start automatically using the `autoStart` parameter
6. Configure appropriate restart behavior using the `restartOnFailure` parameter
7. Choose between system-wide and user-level services using the `system` parameter
8. Implement proper error handling in your code
9. Monitor service health regularly
10. Inspect service configurations when troubleshooting
11. Clean up services properly using unregister when no longer needed

## Acknowledgement

The `@fnet/service` library utilizes the Node.js Child Process module for executing platform-specific commands and managing services across different operating systems.
