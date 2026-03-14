# Bedrock Server Manager HTTP API Documentation

This document describes the HTTP API provided by the Bedrock Server Manager. All API endpoints are prefixed with `/api`.

## Server Control

### GET /api/status
Returns the current status of the Minecraft server process.

**Response:**
- `200 OK`: `{ "status": "running" | "stopped" }`
- `500 Internal Server Error`: `{ "error": "Failed to get server status" }`

---

### POST /api/start
Starts the Minecraft server if it's not already running.

**Response:**
- `200 OK`: `{ "success": true, "message": "Server start initiated." }`
- `500 Internal Server Error`: `{ "error": "Failed to start server" }`

---

### POST /api/stop
Stops the Minecraft server if it's running.

**Response:**
- `200 OK`: `{ "success": true, "message": "Server stop initiated." }`
- `500 Internal Server Error`: `{ "error": "Failed to stop server" }`

---

### POST /api/restart
Restarts the Minecraft server.

**Response:**
- `200 OK`: `{ "success": true, "message": "Server restart initiated." }`
- `500 Internal Server Error`: `{ "error": "Failed to restart server" }`

---

### POST /api/update
Checks for Minecraft server updates and installs them if available. This involves stopping the server, backing up data, downloading the new version, restoring data, and restarting the server.

**Response:**
- `200 OK`: `{ "success": boolean, "message": string }`
- `500 Internal Server Error`: `{ "error": "Failed to check/install update" }`

---

## Server Properties

### GET /api/properties
Retrieves the current `server.properties` configuration.

**Response:**
- `200 OK`: `{ "success": true, "properties": { "key": "value", ... } }`
- `500 Internal Server Error`: `{ "error": "Failed to read server properties" }`

---

### POST /api/properties
Updates the `server.properties` file. Note that a server restart is required for changes to take effect.

**Request Body:**
JSON object containing the property keys and values to update.

**Response:**
- `200 OK`: `{ "success": true, "message": "Server properties updated. Restart server for changes to take effect." }`
- `400 Bad Request`: `{ "error": string }` (if validation fails)
- `500 Internal Server Error`: `{ "error": "Failed to write server properties" }`

---

## World Management

### GET /api/worlds
Lists all world folders found in the server's `worlds` directory.

**Response:**
- `200 OK`: `{ "success": true, "worlds": ["world1", "world2", ...] }`
- `500 Internal Server Error`: `{ "error": "Failed to list worlds" }`

---

### POST /api/activate-world
Sets a specific world as active by updating the `level-name` in `server.properties`. This endpoint also triggers a server restart.

**Request Body:**
`{ "worldName": "string" }`

**Response:**
- `200 OK`: `{ "message": "World 'worldName' activated." }`
- `400 Bad Request`: `{ "error": string }` (if world name is missing or invalid)
- `500 Internal Server Error`: `{ "error": "Failed to activate world" }`

---

## Application Configuration

### GET /api/config
Retrieves the current application configuration (e.g., auto-update settings).

**Response:**
- `200 OK`: `{ "success": true, "config": { ... } }`
- `500 Internal Server Error`: `{ "error": "Failed to get application config" }`

---

### POST /api/config
Updates the application configuration settings.

**Request Body:**
`{ "autoUpdateEnabled": boolean, "autoUpdateIntervalMinutes": number, "logLevel": "string" }` (All fields are optional)

**Response:**
- `200 OK`: `{ "success": true, "message": "Global config settings updated successfully." }`
- `500 Internal Server Error`: `{ "error": "Failed to set global config" }`

---

## Pack Management

### POST /api/upload-pack
Uploads and applies a behavior or resource pack (`.mcpack` or `.mcaddon`) to a specific world.

**Request Type:** `multipart/form-data`

**Parameters:**
- `packFile`: The `.mcpack` or `.mcaddon` file.
- `worldName`: (string, required) The target world for the pack.
- `packType`: (string, optional) The type of pack if uploading a single `.mcpack`. Options: `behavior`, `resource`, `dev_behavior`, `dev_resource`. Auto-detected if omitted.

**Response:**
- `200 OK`: `{ "success": true, "message": string }`
- `400 Bad Request`: `{ "success": false, "message": string }` (if file missing, invalid type, or world not found)
- `500 Internal Server Error`: `{ "success": false, "message": "Failed to upload pack due to server error." }`
