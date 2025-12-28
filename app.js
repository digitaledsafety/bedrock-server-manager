import express from 'express';
import path, { dirname, join as pathJoin } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import * as fs from 'fs';

import * as backend from './minecraft_bedrock_installer_nodejs.js';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

// Ensure temp directory for uploads exists
const TEMP_UPLOAD_DIR = pathJoin(__dirnameESM, 'temp_uploads');
if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

const app = express();
const PORT = 3000;

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, TEMP_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // Generate a unique filename to avoid collisions
        cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, ''));
    }
});
const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Validation for .mcpack and .mcaddon files
        const allowedExtensions = ['.mcpack', '.mcaddon'];
        const fileExtension = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions.includes(fileExtension)) {
            return cb(new Error('Only .mcpack and .mcaddon files are allowed!'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB limit for pack files
    }
});


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(pathJoin(__dirnameESM, 'public')));

// EJS Setup
app.set('view engine', 'ejs');
app.set('views', pathJoin(__dirnameESM, 'views'));

// --- Input Validation Middleware ---
const validateWorldName = (req, res, next) => {
    const { worldName } = req.body;
    if (!worldName) {
        return res.status(400).json({ error: 'World name is required.' });
    }
    const worldNameRegex = /^[a-zA-Z0-9_ -]+$/;
    if (worldName.includes('.') || worldName.includes('/') || worldName.includes('\\') || !worldNameRegex.test(worldName)) {
        backend.log('ERROR', `Invalid worldName format or characters: ${worldName}`);
        return res.status(400).json({ error: 'Invalid worldName format. Avoid ., /, \\ and ensure it matches allowed pattern.' });
    }
    next();
};

const sanitizeServerProperties = (req, res, next) => {
    const properties = req.body;
    if (typeof properties !== 'object' || properties === null) {
        return res.status(400).json({ error: 'Invalid server properties format. Expected an object.' });
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
app.get('/api/status', async (req, res) => {
    try {
        const isRunning = await backend.isProcessRunning();
        res.json({ status: isRunning ? 'running' : 'stopped' });
    } catch (error) {
        backend.log('ERROR', `Error getting server status: ${error.message}`);
        res.status(500).json({ error: 'Failed to get server status' });
    }
});

app.post('/api/start', async (req, res) => {
    try {
        await backend.startServer();
        res.json({ success: true, message: 'Server start initiated.' });
    } catch (error) {
        backend.log('ERROR', `Failed to start server: ${error.message}`);
        res.status(500).json({ error: 'Failed to start server' });
    }
});

app.post('/api/stop', async (req, res) => {
    try {
        await backend.stopServer();
        res.json({ success: true, message: 'Server stop initiated.' });
    } catch (error) {
        backend.log('ERROR', `Failed to stop server: ${error.message}`);
        res.status(500).json({ error: 'Failed to stop server' });
    }
});

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

app.post('/api/update', async (req, res) => {
    try {
        const result = await backend.checkAndInstall();
        res.json(result);
    } catch (error) {
        backend.log('ERROR', `Failed to check/install update: ${error.message}`);
        res.status(500).json({ error: 'Failed to check/install update' });
    }
});

app.get('/api/properties', async (req, res) => {
    try {
        const properties = await backend.readServerProperties();
        res.json({ success: true, properties });
    } catch (error) {
        backend.log('ERROR', `Failed to read server properties: ${error.message}`);
        res.status(500).json({ error: 'Failed to read server properties' });
    }
});

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

app.get('/api/worlds', async (req, res) => {
    try {
        const worlds = await backend.listWorlds();
        res.json({ success: true, worlds });
    } catch (error) {
        backend.log('ERROR', `Failed to list worlds: ${error.message}`);
        res.status(500).json({ error: 'Failed to list worlds' });
    }
});

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

app.get('/api/config', async (req, res) => {
    try {
        const appConfig = await backend.readGlobalConfig();
        res.json({ success: true, config: appConfig });
    } catch (error) {
        backend.log('ERROR', `Error getting application config: ${error.message}`);
        res.status(500).json({ error: 'Failed to get application config' });
    }
});

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

// --- Pack Management API ---
app.post('/api/upload-pack', upload.single('packFile'), async (req, res) => {
    const { packType, worldName } = req.body;
    const packFile = req.file;

    if (!packFile) {
        return res.status(400).json({ success: false, message: 'No pack file uploaded.' });
    }
    if (!packType) {
        // Clean up uploaded file if other parameters are missing
        fs.unlink(packFile.path, (err) => {
            if (err) backend.log('WARNING', `Failed to delete orphaned upload ${packFile.path}: ${err.message}`);
        });
        return res.status(400).json({ success: false, message: 'Pack type is required.' });
    }
    if (!worldName) {
        fs.unlink(packFile.path, (err) => {
            if (err) backend.log('WARNING', `Failed to delete orphaned upload ${packFile.path}: ${err.message}`);
        });
        return res.status(400).json({ success: false, message: 'World name is required.' });
    }

    // Validate packType
    const validPackTypes = ['behavior', 'resource', 'dev_behavior', 'dev_resource'];
    if (!validPackTypes.includes(packType)) {
        fs.unlink(packFile.path, (err) => {
            if (err) backend.log('WARNING', `Failed to delete orphaned upload ${packFile.path}: ${err.message}`);
        });
        return res.status(400).json({ success: false, message: 'Invalid pack type specified.' });
    }

    // Validate worldName
    const worldNameRegex = /^[a-zA-Z0-9_ -]+$/; // Basic format check
    if (worldName.includes('.') || worldName.includes('/') || worldName.includes('\\') || !worldNameRegex.test(worldName)) {
        backend.log('ERROR', `Invalid worldName format or characters for pack upload: ${worldName}`);
        fs.unlink(packFile.path, (err) => {
            if (err) backend.log('WARNING', `Failed to delete orphaned upload ${packFile.path}: ${err.message}`);
        });
        return res.status(400).json({ success: false, message: 'Invalid worldName format for pack upload.' });
    }

    // More robust: Check if world actually exists
    const existingWorlds = await backend.listWorlds();
    if (!existingWorlds.includes(worldName)) {
        backend.log('ERROR', `Attempt to upload pack to non-existent world: ${worldName}`);
        fs.unlink(packFile.path, (err) => {
            if (err) backend.log('WARNING', `Failed to delete orphaned upload ${packFile.path}: ${err.message}`);
        });
        return res.status(400).json({ success: false, message: `Target world '${worldName}' does not exist.` });
    }

    try {
        backend.log('INFO', `Processing pack upload: File=${packFile.path}, OriginalName=${packFile.originalname}, Type=${packType}, World=${worldName}`);
        // Pass originalname so backend can distinguish .mcpack from .mcaddon
        // packType is relevant for .mcpack, ignored for .mcaddon by the backend logic
        const result = await backend.uploadPack(packFile.path, packFile.originalname, packType, worldName);
        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            // uploadPack should handle deleting the temp file on its own errors,
            // but if it failed before even trying, or we want to be sure:
            if (fs.existsSync(packFile.path)) {
                 fs.unlink(packFile.path, (err) => {
                    if (err) backend.log('WARNING', `Failed to delete upload ${packFile.path} after backend processing error: ${err.message}`);
                });
            }
            res.status(400).json({ success: false, message: result.message });
        }
    } catch (error) {
        backend.log('ERROR', `Error uploading pack: ${error.message}`);
        // Ensure temp file is deleted on unexpected error
        if (fs.existsSync(packFile.path)) {
            fs.unlink(packFile.path, (err) => {
                if (err) backend.log('WARNING', `Failed to delete upload ${packFile.path} after exception: ${err.message}`);
            });
        }
        res.status(500).json({ success: false, message: 'Failed to upload pack due to server error.' });
    }
}, (error, req, res, next) => {
    // Custom error handler for multer errors (e.g., file size limit)
    if (error instanceof multer.MulterError) {
        backend.log('ERROR', `Multer error during pack upload: ${error.message}`);
        return res.status(400).json({ success: false, message: `Upload error: ${error.message}` });
    } else if (error) {
        backend.log('ERROR', `Generic error during pack upload (fileFilter): ${error.message}`);
        return res.status(400).json({ success: false, message: error.message }); // error.message from fileFilter
    }
    next();
});


// --- Frontend Routes ---
app.get('/', async (req, res) => {
    try {
        const currentConfig = await backend.readGlobalConfig();
        const properties = await backend.readServerProperties();
        const worlds = await backend.listWorlds();
        const isRunning = await backend.isProcessRunning();
        const serverStatus = isRunning ? 'running' : 'stopped';
        const currentServerVersion = backend.getStoredVersion(); // Added this line

        res.render('index', {
            properties,
            worlds,
            serverStatus,
            config: currentConfig,
            currentServerVersion // Added to template data
        });
    } catch (error) {
        backend.log('ERROR', `Error rendering index page: ${error.message}`);
        res.status(500).send('Error loading page.');
    }
});

// --- Server Initialization ---
const start = async () => {
    try {
        const initialConfig = await backend.readGlobalConfig();
        backend.init(initialConfig);
        if (initialConfig.autoStart) {
            backend.log('INFO', 'autoStart is enabled, attempting to start the server...');
            await backend.startServer();
        }
        await backend.startAutoUpdateScheduler();

        const port = initialConfig.uiPort ?? PORT;

        // This check prevents the server from starting during tests
        if (process.env.NODE_ENV !== 'test') {
            app.listen(port, () => {
                backend.log('INFO', `Express frontend server listening on port ${port}`);
                console.log(`Open your browser to http://localhost:${port}`);
            });
        }
    } catch (error) {
        backend.log('FATAL', `Failed to initialize and start application: ${error.message}`);
        if (process.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
    }
};

start();

export default app;
