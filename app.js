const express = require('express');
const path = require('path');
const {
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
    isProcessRunning // Import isProcessRunning from the backend script
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

// --- API Endpoints ---

// Endpoint to get server status (simplified for this example)
app.get('/api/status', async (req, res) => {
    try {
        // SERVER_EXE_NAME and isProcessRunning are now correctly imported from the backend module.
        const isRunning = await isProcessRunning(SERVER_EXE_NAME);
        res.json({ status: isRunning ? 'running' : 'stopped' });
    } catch (error) {
        log('ERROR', `Error getting server status: ${error.message}`);
        res.status(500).json({ error: 'Failed to get server status' });
    }
});

// Endpoint to start the server
app.post('/api/start', async (req, res) => {
    try {
        await startServer();
        res.json({ success: true, message: 'Server start initiated.' });
    } catch (error) {
        log('ERROR', `Failed to start server: ${error.message}`);
        res.status(500).json({ error: 'Failed to start server' });
    }
});

// Endpoint to stop the server
app.post('/api/stop', async (req, res) => {
    try {
        await stopServer();
        res.json({ success: true, message: 'Server stop initiated.' });
    } catch (error) {
        log('ERROR', `Failed to stop server: ${error.message}`);
        res.status(500).json({ error: 'Failed to stop server' });
    }
});

// Endpoint to restart the server
app.post('/api/restart', async (req, res) => {
    try {
        await restartServer();
        res.json({ success: true, message: 'Server restart initiated.' });
    }
    catch (error) {
        log('ERROR', `Failed to restart server: ${error.message}`);
        res.status(500).json({ error: 'Failed to restart server' });
    }
});

// Endpoint to check for updates and install
app.post('/api/update', async (req, res) => {
    try {
        const result = await checkAndInstall();
        res.json(result);
    } catch (error) {
        log('ERROR', `Failed to check/install update: ${error.message}`);
        res.status(500).json({ error: 'Failed to check/install update' });
    }
});

// Endpoint to get current server properties
app.get('/api/properties', async (req, res) => {
    try {
        const properties = await readServerProperties();
        res.json(properties);
    } catch (error) {
        log('ERROR', `Failed to read server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to read server properties' });
    }
});

// Endpoint to update server properties
app.post('/api/properties', async (req, res) => {
    try {
        const newProperties = req.body;
        await writeServerProperties(newProperties);
        res.json({ success: true, message: 'Server properties updated. Restart server for changes to take effect.' });
    } catch (error) {
        log('ERROR', `Failed to write server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to write server properties' });
    }
});

// Endpoint to list available worlds
app.get('/api/worlds', async (req, res) => {
    try {
        const worlds = await listWorlds();
        res.json({ worlds });
    } catch (error) {
        log('ERROR', `Failed to list worlds: ${error.message}`);
        res.status(500).json({ error: 'Failed to list worlds' });
    }
});

// Endpoint to activate a world
app.post('/api/activate-world', async (req, res) => {
    const { worldName } = req.body;
    if (!worldName) {
        return res.status(400).json({ error: 'World name is required.' });
    }
    try {
        const success = await activateWorld(worldName);
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

// --- Frontend Routes (using EJS for rendering) ---

app.get('/', async (req, res) => {
    try {
        const properties = await readServerProperties();
        const worlds = await listWorlds();
        const status = await isProcessRunning(SERVER_EXE_NAME); // Get current server status
        res.render('index', { properties, worlds, serverStatus: status ? 'running' : 'stopped' });
    } catch (error) {
        log('ERROR', `Error rendering index page: ${error.message}`);
        res.status(500).send('Error loading page.');
    }
});

// Start the server
app.listen(PORT, () => {
    log('INFO', `Express frontend server listening on port ${PORT}`);
    console.log(`Open your browser to http://localhost:${PORT}`);
});
