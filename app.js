import express from 'express';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Import all functions from the backend module, and access them via `backend.`
import * as backend from './minecraft_bedrock_installer_nodejs.js';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

const app = express();
const PORT = 3000;

// Middleware - Using Express's built-in body parsers
app.use(express.json()); // To parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded request bodies
app.use(express.static(join(__dirnameESM, 'public'))); // Serve static files (HTML, CSS, JS)

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', join(__dirnameESM, 'views'));

// --- Input Validation Middleware/Helpers ---

const validateWorldName = (req, res, next) => {
    const { worldName } = req.body;
    if (!worldName) {
        return res.status(400).json({ error: 'World name is required.' });
    }
    const worldNameRegex = /^[a-zA-Z0-9_ -]+$/;
    if (worldName.includes('.') || worldName.includes('/') || worldName.includes('\\') || !worldNameRegex.test(worldName)) {
        backend.log('ERROR', `Invalid worldName format or characters: ${worldName}`);
        return res.status(400).json({ error: 'Invalid worldName format or characters. Avoid ., /, \\ and ensure it matches allowed pattern.' });
    }
    next();
};

const sanitizeServerProperties = (req, res, next) => {
    const properties = req.body;
    if (typeof properties !== 'object' || properties === null) {
        return res.status(400).json({ error: 'Invalid server properties format. Expected an object.'});
    }
    for (const key in properties) {
        if (typeof key !== 'string' || key.match(/[\n\r]/)) {
            backend.log('ERROR', `Invalid character in server property key: ${key}`);
            return res.status(400).json({ error: `Invalid character in server property key: ${key}` });
        }
        const value = properties[key];
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            properties[key] = String(value);
            backend.log('WARNING', `Property value for key '${key}' was converted to string.`);
        }
    }
    req.body = properties;
    next();
};

// --- API Endpoints ---

// GET /api/status - Get server status
app.get('/api/status', async (req, res) => {
    try {
        const isRunning = await backend.isProcessRunning();
        res.json({ status: isRunning ? 'running' : 'stopped' });
    } catch (error) {
        backend.log('ERROR', `Error getting server status: ${error.message}`);
        res.status(500).json({ error: 'Failed to get server status' });
    }
});

// POST /api/start - Start the server
app.post('/api/start', async (req, res) => {
    try {
        await backend.startServer();
        res.json({ success: true, message: 'Server start initiated.' });
    } catch (error) {
        backend.log('ERROR', `Failed to start server: ${error.message}`);
        res.status(500).json({ error: 'Failed to start server' });
    }
});

// POST /api/stop - Stop the server
app.post('/api/stop', async (req, res) => {
    try {
        await backend.stopServer();
        res.json({ success: true, message: 'Server stop initiated.' });
    } catch (error) {
        backend.log('ERROR', `Failed to stop server: ${error.message}`);
        res.status(500).json({ error: 'Failed to stop server' });
    }
});

// POST /api/restart - Restart the server
app.post('/api/restart', async (req, res) => {
    try {
        await backend.restartServer();
        res.json({ success: true, message: 'Server restart initiated.' });
    }
    catch (error) {
        backend.log('ERROR', `Failed to restart server: ${error.message}`);
        res.status(500).json({ error: 'Failed to restart server' });
    }
});

// POST /api/update - Check for updates and install
app.post('/api/update', async (req, res) => {
    try {
        const result = await backend.checkAndInstall();
        res.json(result);
    } catch (error) {
        backend.log('ERROR', `Failed to check/install update: ${error.message}`);
        res.status(500).json({ error: 'Failed to check/install update' });
    }
});

// GET /api/properties - Get current server properties
app.get('/api/properties', async (req, res) => {
    try {
        const properties = await backend.readServerProperties();
        res.json({ success: true, properties });
    } catch (error) {
        backend.log('ERROR', `Failed to read server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to read server properties' });
    }
});

// POST /api/properties - Update server properties
app.post('/api/properties', sanitizeServerProperties, async (req, res) => {
    try {
        const newProperties = req.body;
        await backend.writeServerProperties(newProperties);
        res.json({ success: true, message: 'Server properties updated. Restart server for changes to take effect.' });
    } catch (error) {
        backend.log('ERROR', `Failed to write server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to write server properties' });
    }
});

// GET /api/worlds - List available worlds
app.get('/api/worlds', async (req, res) => {
    try {
        const worlds = await backend.listWorlds();
        res.json({ success: true, worlds });
    } catch (error) {
        backend.log('ERROR', `Failed to list worlds: ${error.message}`);
        res.status(500).json({ error: 'Failed to list worlds' });
    }
});

// POST /api/activate-world - Activate a world
app.post('/api/activate-world', validateWorldName, async (req, res) => {
    try {
        const { worldName } = req.body;
        const success = await backend.activateWorld(worldName);
        if (success) {
            res.json({ message: `World '${worldName}' activated.` });
        } else {
            res.status(400).json({ error: `Failed to activate world '${worldName}'.` });
        }
    } catch (error) {
        backend.log('ERROR', `Failed to activate world: ${error.message}`);
        res.status(500).json({ error: 'Failed to activate world' });
    }
});

// Global Configuration Endpoint
// GET /api/config - Returns the entire single-instance configuration
app.get('/api/config', async (req, res) => {
    try {
        const appConfig = await backend.readGlobalConfig();
        res.json({ success: true, config: appConfig });
    } catch (error) {
        backend.log('ERROR', `Error getting application config: ${error.message}`);
        res.status(500).json({ error: 'Failed to get application config' });
    }
});

// POST /api/config - Updates specific global settings
app.post('/api/config', async (req, res) => {
    try {
        const newSettings = req.body;
        let currentFullConfig = await backend.readGlobalConfig();

        if (newSettings.autoUpdateEnabled !== undefined) {
            currentFullConfig.autoUpdateEnabled = newSettings.autoUpdateEnabled;
        }
        if (newSettings.autoUpdateIntervalMinutes !== undefined) {
            currentFullConfig.autoUpdateIntervalMinutes = parseInt(newSettings.autoUpdateIntervalMinutes, 10);
        }
        if (newSettings.logLevel !== undefined) {
            currentFullConfig.logLevel = newSettings.logLevel.toUpperCase();
        }

        await backend.writeGlobalConfig(currentFullConfig);
        await backend.startAutoUpdateScheduler();
        res.json({ success: true, message: 'Global config settings updated successfully.' });
    } catch (error) {
        backend.log('ERROR', `Error setting global config: ${error.message}`);
        res.status(500).json({ error: 'Failed to set global config' });
    }
});


// --- Frontend Routes (using EJS for rendering) ---

app.get('/', async (req, res) => {
    try {
        const currentConfig = await backend.readGlobalConfig();

        const properties = await backend.readServerProperties();
        const worlds = await backend.listWorlds();
        const isRunning = await backend.isProcessRunning();
        const serverStatus = isRunning ? 'running' : 'stopped';

        res.render('index', { 
            properties, 
            worlds, 
            serverStatus,
            config: currentConfig
        });
    } catch (error) {
        backend.log('ERROR', `Error rendering index page: ${error.message}`);
        res.status(500).send('Error loading page.');
    }
});

// Start the server
// IIFE to handle async setup before starting server
(async () => {
    try {
        const initialConfig = await backend.readGlobalConfig(); // Load config first
        backend.init(initialConfig); // Initialize backend with this config
        await backend.startAutoUpdateScheduler(); // Start scheduler

        app.listen(PORT, () => {
            backend.log('INFO', `Express frontend server listening on port ${PORT}`);
            console.log(`Open your browser to http://localhost:${PORT}`);
        });
    } catch (error) {
        backend.log('FATAL', `Failed to initialize and start application: ${error.message}`);
        process.exit(1); // Exit if critical setup fails
    }
})();
