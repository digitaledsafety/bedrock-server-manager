const express = require('express');
const path = require('path');
const {
    init,
    log,
    startServer,
    stopServer,
    restartServer,
    checkAndInstall,
    readServerProperties,
    writeServerProperties,
    listWorlds,
    activateWorld,
    SERVER_DIRECTORY, // Import SERVER_DIRECTORY to access server files
    SERVER_EXE_NAME, // Import SERVER_EXE_NAME from the backend script
    isProcessRunning, // Import isProcessRunning from the backend script
    startAutoUpdateScheduler, // Import startAutoUpdateScheduler from the backend script
    readGlobalConfig, // NEW: Import readGlobalConfig for frontend access
    writeGlobalConfig // NEW: Import writeGlobalConfig for frontend access
} = require('./minecraft_bedrock_installer_nodejs'); // Import functions from your backend script

const app = express();
const PORT = 3000;

// Middleware - Using Express's built-in body parsers
app.use(express.json()); // To parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded request bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (HTML, CSS, JS)

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Input Validation Middleware/Helpers ---
// validateInstanceId is removed as instanceId is no longer a route parameter.

const validateWorldName = (req, res, next) => {
    const { worldName } = req.body;
    if (!worldName) {
        return res.status(400).json({ error: 'World name is required.' });
    }
    const worldNameRegex = /^[a-zA-Z0-9_ -]+$/;
    if (worldName.includes('.') || worldName.includes('/') || worldName.includes('\\') || !worldNameRegex.test(worldName)) {
        log('ERROR', `Invalid worldName format or characters: ${worldName}`);
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
            log('ERROR', `Invalid character in server property key: ${key}`);
            return res.status(400).json({ error: `Invalid character in server property key: ${key}` });
        }
        const value = properties[key];
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            properties[key] = String(value);
            log('WARNING', `Property value for key '${key}' was converted to string.`);
        }
    }
    req.body = properties;
    next();
};

// --- API Endpoints ---

// GET /api/status - Get server status
app.get('/api/status', async (req, res) => {
    try {
        const isRunning = await isProcessRunning(); // Uses global config implicitly
        res.json({ status: isRunning ? 'running' : 'stopped' });
    } catch (error) {
        log('ERROR', `Error getting server status: ${error.message}`);
        res.status(500).json({ error: 'Failed to get server status' });
    }
});

// POST /api/start - Start the server
app.post('/api/start', async (req, res) => {
    try {
        await startServer(); // Uses global config implicitly
        res.json({ success: true, message: 'Server start initiated.' });
    } catch (error) {
        log('ERROR', `Failed to start server: ${error.message}`);
        res.status(500).json({ error: 'Failed to start server' });
    }
});

// POST /api/stop - Stop the server
app.post('/api/stop', async (req, res) => {
    try {
        await stopServer(); // Uses global config implicitly
        res.json({ success: true, message: 'Server stop initiated.' });
    } catch (error) {
        log('ERROR', `Failed to stop server: ${error.message}`);
        res.status(500).json({ error: 'Failed to stop server' });
    }
});

// POST /api/restart - Restart the server
app.post('/api/restart', async (req, res) => {
    try {
        await restartServer(); // Uses global config implicitly
        res.json({ success: true, message: 'Server restart initiated.' });
    }
    catch (error) {
        log('ERROR', `Failed to restart server: ${error.message}`);
        res.status(500).json({ error: 'Failed to restart server' });
    }
});

// POST /api/update - Check for updates and install
app.post('/api/update', async (req, res) => {
    try {
        // checkAndInstall will use the global config implicitly
        const result = await checkAndInstall();
        res.json(result);
    } catch (error) {
        log('ERROR', `Failed to check/install update: ${error.message}`);
        res.status(500).json({ error: 'Failed to check/install update' });
    }
});

// GET /api/properties - Get current server properties
app.get('/api/properties', async (req, res) => {
    try {
        const properties = await readServerProperties(); // Uses global config implicitly
        res.json({ success: true, properties });
    } catch (error) {
        log('ERROR', `Failed to read server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to read server properties' });
    }
});

// POST /api/properties - Update server properties
app.post('/api/properties', sanitizeServerProperties, async (req, res) => {
    try {
        const newProperties = req.body; // Sanitized by middleware
        await writeServerProperties(newProperties); // Uses global config implicitly
        res.json({ success: true, message: 'Server properties updated. Restart server for changes to take effect.' });
    } catch (error) {
        log('ERROR', `Failed to write server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to write server properties' });
    }
});

// GET /api/worlds - List available worlds
app.get('/api/worlds', async (req, res) => {
    try {
        const worlds = await listWorlds(); // Uses global config implicitly
        res.json({ success: true, worlds });
    } catch (error) {
        log('ERROR', `Failed to list worlds: ${error.message}`);
        res.status(500).json({ error: 'Failed to list worlds' });
    }
});

// POST /api/activate-world - Activate a world
app.post('/api/activate-world', validateWorldName, async (req, res) => {
    try {
        const { worldName } = req.body; // Validated by middleware
        const success = await activateWorld(worldName); // Uses global config implicitly
        if (success) {
            res.json({ message: `World '${worldName}' activated.` });
        } else {
            res.status(400).json({ error: `Failed to activate world '${worldName}'.` });
        }
    } catch (error) {
        log('ERROR', `Failed to activate world: ${error.message}`);
        res.status(500).json({ error: 'Failed to activate world' });
    }
});

// Global Configuration Endpoint
// GET /api/config - Returns the entire single-instance configuration
app.get('/api/config', async (req, res) => {
    try {
        const appConfig = await readGlobalConfig(); // This now returns the single-instance config
        res.json({ success: true, config: appConfig });
    } catch (error) {
        log('ERROR', `Error getting application config: ${error.message}`);
        res.status(500).json({ error: 'Failed to get application config' });
    }
});

// POST /api/config - Updates specific global settings
app.post('/api/config', async (req, res) => {
    try {
        const newSettings = req.body;
        let currentFullConfig = await readGlobalConfig();

        // Update only specific global fields from newSettings
        if (newSettings.autoUpdateEnabled !== undefined) {
            currentFullConfig.autoUpdateEnabled = newSettings.autoUpdateEnabled;
        }
        if (newSettings.autoUpdateIntervalMinutes !== undefined) {
            currentFullConfig.autoUpdateIntervalMinutes = parseInt(newSettings.autoUpdateIntervalMinutes, 10);
        }
        if (newSettings.logLevel !== undefined) {
            currentFullConfig.logLevel = newSettings.logLevel.toUpperCase();
        }
        // Other fields like serverName, directories etc. are not meant to be changed via this endpoint.

        await writeGlobalConfig(currentFullConfig);
        await startAutoUpdateScheduler(); // Restart scheduler with potentially new interval
        res.json({ success: true, message: 'Global config settings updated successfully.' });
    } catch (error) {
        log('ERROR', `Error setting global config: ${error.message}`);
        res.status(500).json({ error: 'Failed to set global config' });
    }
});


// --- Frontend Routes (using EJS for rendering) ---

app.get('/', async (req, res) => {
    try {
        // readGlobalConfig now returns the fully resolved single-instance config
        const currentConfig = await readGlobalConfig();

        const properties = await readServerProperties();
        const worlds = await listWorlds();
        const isRunning = await isProcessRunning();
        const serverStatus = isRunning ? 'running' : 'stopped';

        res.render('index', { 
            properties, 
            worlds, 
            serverStatus,
            config: currentConfig // Pass the whole config object
        });
    } catch (error) {
        log('ERROR', `Error rendering index page: ${error.message}`);
        res.status(500).send('Error loading page.');
    }
});

// Start the server
app.listen(PORT, () => {
    log('INFO', `Express frontend server listening on port ${PORT}`);
    console.log(`Open your browser to http://localhost:${PORT}`);
    // Start the auto-update scheduler when the Express app starts
    // This will now use the config.json file to determine if auto-update is enabled
    init(); // Ensure init is called before scheduler starts
    startAutoUpdateScheduler();
});
