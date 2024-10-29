# @fnet/service Developer Guide

## Overview

The `@fnet/service` library is a cross-platform tool designed to manage system services on Windows, macOS, and Linux through a unified API. This library provides functions to register, unregister, start, and stop services, making it easier to control application processes that need to run as system services. By using this library, developers can streamline service management in their applications across different operating systems by leveraging a consistent interface.

## Installation

To install `@fnet/service`, you can use either npm or yarn. Choose one of the following methods to add it to your project:

Using npm:
```bash
npm install @fnet/service
```

Using yarn:
```bash
yarn add @fnet/service
```

## Usage

To make use of `@fnet/service`, you will need to import it into your application and call it with the appropriate arguments. This library exposes a primary function to manage services based on the specified action.

### Basic Usage

Here is a basic example of how to use the library to register, start, stop, and unregister a service:

```javascript
import manageService from '@fnet/service';

// Service details
const serviceDetails = {
  name: 'myService',
  description: 'My Test Service',
  command: '/usr/bin/my_service_command', // Command to run the service
  user: 'serviceUser',                    // (Optional) User to run the service as
  env: {                                  // (Optional) Environment variables
    ENV_VAR: 'value'
  }
};

// Register the service
await manageService({ ...serviceDetails, action: 'register' });

// Start the service
await manageService({ ...serviceDetails, action: 'start' });

// Stop the service
await manageService({ ...serviceDetails, action: 'stop' });

// Unregister the service
await manageService({ ...serviceDetails, action: 'unregister' });
```

## Examples

### Registering a Service

To register a new service, provide the necessary service details such as the name, description, and command to be executed:
```javascript
await manageService({ 
  action: 'register', 
  name: 'exampleService', 
  description: 'An Example Service', 
  command: '/path/to/executable', 
  user: 'serviceUser',
  env: { NODE_ENV: 'production' }
});
```

### Starting a Service

Once the service is registered, you can start it using:
```javascript
await manageService({ action: 'start', name: 'exampleService' });
```

### Stopping a Service

To stop a running service:
```javascript
await manageService({ action: 'stop', name: 'exampleService' });
```

### Unregistering a Service

Remove a previously registered service:
```javascript
await manageService({ action: 'unregister', name: 'exampleService' });
```

## Acknowledgement

We acknowledge and appreciate the contributors who have helped in the development of this library.