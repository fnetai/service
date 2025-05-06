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

- `action`: The operation to perform (`register`, `unregister`, `start`, `stop`, `enable`, `status`, `health`)
- `name`: The name of the service
- `description`: A brief description of the service (required for registration)
- `command`: An array of command-line arguments to run the service (required for registration)
- `user`: The user under whose account the service will run (optional)
- `env`: An object defining environment variables for the service (optional)
- `working_dir`: The working directory for the service (optional)

### Example Usages

Registering a new service:

```javascript
import manageService from '@fnet/service';

await manageService({
    action: 'register',
    name: 'MyService',
    description: 'A demo service',
    command: ['node', '/path/to/app.js'],
    user: 'serviceUser',
    env: { NODE_ENV: 'production' },
    working_dir: '/path/to/working/directory'
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
- Full service status monitoring

### macOS

- Uses `launchctl` and `.plist` files in `/Library/LaunchDaemons/`
- Supports `RunAtLoad` and `KeepAlive` options
- Environment variables and working directory support

### Linux

- Uses `systemd` service management
- Services stored in `/etc/systemd/system/`
- Automatic restart on failure
- Detailed status and health monitoring with journalctl integration

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
3. Configure working directories when needed
4. Handle environment variables appropriately
5. Implement proper error handling in your code
6. Monitor service health regularly
7. Clean up services properly using unregister when no longer needed

## Acknowledgement

The `@fnet/service` library utilizes the Node.js Child Process module for executing platform-specific commands and managing services across different operating systems.
