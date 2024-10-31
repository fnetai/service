# @fnet/service Developer Guide

## Overview

The `@fnet/service` library provides a straightforward interface for managing operating system services across different platforms: Windows, macOS, and Linux. It allows developers to register, unregister, start, stop, and enable services. This can be especially useful for automating service management tasks in environments where applications require consistent setup and execution as a background process.

## Installation

You can install the `@fnet/service` library using npm or yarn. Below are the commands for installation:

Using npm:
```bash
npm install @fnet/service
```

Using yarn:
```bash
yarn add @fnet/service
```

## Usage

The primary export of the library is a function that allows you to control services. The function requires specific parameters that define the action and service properties.

### Parameters:
- `action`: The action to be performed (`register`, `unregister`, `start`, `stop`, `enable`).
- `name`: The name of the service.
- `description`: A brief description of the service.
- `command`: An array of command-line arguments to run the service.
- `user`: The user under whose account the service will run (optional).
- `env`: An object defining environment variables for the service (optional).
- `working_dir`: The working directory for the service (optional).

### Example Usages

Registering a new service:
```javascript
import manageService from '@fnet/service';

manageService({
    action: 'register',
    name: 'MyService',
    description: 'A demo service',
    command: ['node', '/path/to/app.js'],
    user: 'serviceUser', // Optional
    env: { NODE_ENV: 'production' }, // Optional
    working_dir: '/path/to/working/directory' // Optional
});
```

Starting a registered service:
```javascript
manageService({
    action: 'start',
    name: 'MyService'
});
```

Unregistering a service:
```javascript
manageService({
    action: 'unregister',
    name: 'MyService'
});
```

## Examples

Here's a basic setup to create and manage a service on any supported platform:

### Register and Start a Service
```javascript
import manageService from '@fnet/service';

// Register a new service
manageService({
    action: 'register',
    name: 'AutoBackup',
    description: 'Automated Backup Service',
    command: ['node', '/scripts/backup.js']
});

// Start the service
manageService({ action: 'start', name: 'AutoBackup' });
```

### Stop and Unregister a Service
```javascript
import manageService from '@fnet/service';

// Stop a running service
manageService({ action: 'stop', name: 'AutoBackup' });

// Unregister the service
manageService({ action: 'unregister', name: 'AutoBackup' });
```

These examples cover the essential operations like registering, starting, stopping, and unregistering a service. Modify the parameters according to your application's needs to ensure it fits within your system's service management framework.

## Acknowledgement

The `@fnet/service` library utilizes the Node.js Child Process module, as part of its functionality to execute command-line operations across different operating systems. These are foundational tools within the Node.js ecosystem.