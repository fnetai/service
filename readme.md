# @fnet/service

This project provides a straightforward utility for managing system services across different operating systems, including Windows, macOS, and Linux. The primary aim is to facilitate the process of registering, unregistering, starting, and stopping services on these platforms using simple commands. With this utility, users can manage their services without needing to delve deeply into the specific service management tools of each OS.

## How It Works

This utility functions by leveraging platform-specific commands to handle services. The user provides details such as the service name, description, command to execute, and environment variables. Based on the specified action, the utility executes the appropriate commands to either register, unregister, start, or stop a service. It automatically determines the platform you are on and applies the necessary operations for that system.

## Key Features

- **Cross-Platform Service Management**: Supports Windows, macOS, and Linux, ensuring compatibility and ease of use across all major operating systems.
- **Service Registration/Unregistration**: Easily create and remove services from system service managers.
- **Start/Stop Services**: Control service start and stop actions with straightforward commands.
- **Environment Variables Support**: Allows you to specify environment variables for your services, adaptable for various execution contexts.

## Conclusion

This utility serves as a helpful tool for those needing to manage system services across different operating systems. By simplifying the process of handling service operations, users can save time and reduce complexity, making it a convenient addition to any development or IT management toolkit.