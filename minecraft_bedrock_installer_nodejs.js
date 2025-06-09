const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { URL } = require('url');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');

// Configuration
const MC_BEDROCK_URL = 'https://www.minecraft.net/en-us/download/server/bedrock';
const VERSION_REGEX = /bedrock-server-([\d\.]+)\.zip/;

// Globals populated by readGlobalConfig and init
let config = {};
let SERVER_DIRECTORY;
let TEMP_DIRECTORY;
let BACKUP_DIRECTORY;
let serverPID = null;

const MC_USER = 'minecraft';
const MC_GROUP = 'minecraft';
const LAST_VERSION_FILE = 'last_version.txt';
const WEBHOOK_URL = process.env.MC_UPDATE_WEBHOOK;
const SERVER_EXE_NAME = os.platform() === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
const CONFIG_FILES = ['server.properties', 'permissions.json', 'whitelist.json'];
const WORLD_DIRECTORIES = ['worlds'];
const GLOBAL_CONFIG_FILE = 'config.json';

let autoUpdateIntervalId = null;

// Logging setup
const logStream = fs.createWriteStream('mc_installer.log', { flags: 'a' });
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, FATAL: 4 };
let currentLogLevel = LOG_LEVELS.INFO;

function setLogLevel(levelName) {
    const levelNameToUse = (levelName || "INFO").toUpperCase();
    const newLevel = LOG_LEVELS[levelNameToUse];
    if (newLevel !== undefined) {
        currentLogLevel = newLevel;
        // Log this message only if the new level allows INFO messages
        if (LOG_LEVELS.INFO >= currentLogLevel) {
            const initialLogMessage = `${new Date().toISOString()} [INFO] Log level set to ${levelNameToUse}\n`;
            console.log(initialLogMessage);
            logStream.write(initialLogMessage);
        }
    } else {
        const warningMessage = `${new Date().toISOString()} [WARNING] Invalid log level: ${levelName}. Defaulting to INFO.\n`;
        console.warn(warningMessage);
        logStream.write(warningMessage);
        currentLogLevel = LOG_LEVELS.INFO;
    }
}

function log(level, message) {
    const messageLevel = LOG_LEVELS[level.toUpperCase()];
    if (messageLevel === undefined) {
        console.warn(`Invalid log level used in log() call: ${level}`);
        return;
    }
    if (messageLevel >= currentLogLevel) {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} [${level.toUpperCase()}] ${message}\n`;
        console.log(logMessage);
        logStream.write(logMessage);
    }
}

function init(effectiveConfigFromRead) {
    config = effectiveConfigFromRead;
    setLogLevel(config.logLevel || "INFO");
    log('INFO', `Initializing with configuration: ${JSON.stringify(config, null, 2)}`);
    SERVER_DIRECTORY = config.serverDirectory;
    TEMP_DIRECTORY = config.tempDirectory;
    BACKUP_DIRECTORY = config.backupDirectory;
    log('INFO', `Using Server Directory: ${SERVER_DIRECTORY}`);
    log('INFO', `Using Temp Directory: ${TEMP_DIRECTORY}`);
    log('INFO', `Using Backup Directory: ${BACKUP_DIRECTORY}`);
    const dirsToCreate = [SERVER_DIRECTORY, TEMP_DIRECTORY, BACKUP_DIRECTORY];
    for (const dir of dirsToCreate) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                log('INFO', `Created directory: ${dir}`);
            } catch (e) {
                log('ERROR', `Failed to create directory ${dir}: ${e.message}.`);
            }
        }
    }
}

async function getLatestVersion() {
    return new Promise((resolve, reject) => {
        const url = new URL(MC_BEDROCK_URL);
        const protocol = url.protocol === 'https:' ? https : http;
        protocol.get(url, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`HTTP error! Status code: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const htmlContent = data;
                    const linkRegex = /<a\s+[^>]*?href="([^"]*?bedrock-server[^"]*?)"[^>]*?>/i;
                    const linkMatch = htmlContent.match(linkRegex);
                    if (linkMatch && linkMatch[1]) {
                        const downloadUrl = linkMatch[1];
                        log('DEBUG', `Download URL found: ${downloadUrl}`); // DEBUG as it's verbose
                        const versionMatch = downloadUrl.match(VERSION_REGEX);
                        if (versionMatch && versionMatch[1]) {
                            resolve(versionMatch[1].trim());
                        } else {
                            log('WARNING', 'Could not extract version from the download URL.');
                            resolve(null);
                        }
                    } else {
                        log('WARNING', 'Could not find the download link on the page.');
                        resolve(null);
                    }
                } catch (error) {
                    log('ERROR', `Error parsing HTML: ${error}`);
                    reject(error);
                }
            });
            res.on('error', (err) => {
                log('ERROR', `Error fetching data: ${err.message}`);
                reject(err);
            });
        });
    });
}

function downloadFile(downloadUrl, downloadPath) {
    return new Promise((resolve, reject) => {
        const url = new URL(downloadUrl);
        const protocol = url.protocol === 'https:' ? https : http;
        const file = fs.createWriteStream(downloadPath);
        protocol.get(url, (response) => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(resolve); });
            file.on('error', (err) => { fs.unlink(downloadPath, () => reject(new Error(`Error writing to file: ${err.message}`))); });
            response.on('error', (err) => { fs.unlink(downloadPath, () => reject(new Error(`Error during download: ${err.message}`))); });
        });
    });
}

function extractFiles(zipPath, extractPath) {
    return new Promise((resolve, reject) => {
        const platform = os.platform();
        let childProcess;
        if (platform === 'win32') {
            const psPath = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            const commandArgs = [
                '-NoProfile', '-NonInteractive', '-Command',
                `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractPath.replace(/'/g, "''")}' -Force`
            ];
            log('INFO', `Using PowerShell for extraction: ${psPath} ${commandArgs.join(' ')}`);
            childProcess = spawn(psPath, commandArgs, { stdio: 'pipe' });
        } else {
            log('INFO', `Using unzip for extraction. Command: unzip -o "${zipPath}" -d "${extractPath}"`);
            childProcess = spawn('unzip', ['-o', zipPath, '-d', extractPath], { stdio: 'pipe' });
        }
        let stdoutData = ''; let stderrData = '';
        childProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        childProcess.stderr.on('data', (data) => { stderrData += data.toString(); });
        childProcess.on('close', (code) => {
            log('DEBUG', `Extraction stdout: ${stdoutData}`); // DEBUG as it can be verbose
            if (stderrData) { log('ERROR', `Extraction stderr: ${stderrData}`); }
            if (code === 0) {
                log('INFO', `Extraction completed successfully for ${zipPath} to ${extractPath}.`);
                resolve();
            } else {
                reject(new Error(`Extraction failed with code ${code} for ${zipPath}. Stderr: ${stderrData}`));
            }
        });
        childProcess.on('error', (error) => {
            log('ERROR', `Failed to start extraction process for ${zipPath}: ${error.message}`);
            reject(new Error(`Failed to start extraction process: ${error.message}`));
        });
    });
}

async function changeOwnership(dirPath, user, group) {
    if (os.platform() === 'win32') {
        log('INFO', `Skipping changeOwnership on Windows.`);
        return;
    }
    const validBasePaths = [SERVER_DIRECTORY, BACKUP_DIRECTORY];
    if (!validBasePaths.some(base => dirPath.startsWith(base))) {
        log('ERROR', `changeOwnership attempted on restricted path: ${dirPath}. Expected to be within ${validBasePaths.join(' or ')}.`);
        throw new Error(`Invalid path for changeOwnership: ${dirPath}. Operation aborted for security.`);
    }
    try {
        log('INFO', `Attempting to change ownership of ${dirPath} to ${user}:${group}`);
        const childProcess = spawn('chown', ['-R', `${user}:${group}`, dirPath], { stdio: 'pipe' });
        let stdoutData = ''; let stderrData = '';
        childProcess.stdout.on('data', (data) => stdoutData += data.toString());
        childProcess.stderr.on('data', (data) => stderrData += data.toString());
        return new Promise((resolve, reject) => {
            childProcess.on('close', (code) => {
                if (stdoutData) log('DEBUG', `chown stdout: ${stdoutData}`); // DEBUG as it can be verbose
                if (stderrData) log('ERROR', `chown stderr: ${stderrData}`);
                if (code === 0) {
                    log('INFO', `Changed ownership of ${dirPath} to ${user}:${group} successfully.`);
                    resolve();
                } else {
                    reject(new Error(`chown failed with code ${code} for ${dirPath}. Stderr: ${stderrData}`));
                }
            });
            childProcess.on('error', (error) => {
                log('ERROR', `Failed to start chown process for ${dirPath}: ${error.message}`);
                reject(new Error(`Failed to start chown process: ${error.message}`));
            });
        });
    } catch (error) {
        log('ERROR', `Error during changeOwnership setup for ${dirPath}: ${error.message}`);
        throw error;
    }
}

function storeLatestVersion(version) {
    try {
        fs.writeFileSync(LAST_VERSION_FILE, version); // This file is in the app root, not server specific
        log('INFO', `Stored latest version: ${version}`);
    } catch (error) {
        log('ERROR', `Error storing version to file: ${error.message}`);
    }
}

function getStoredVersion() {
    try {
        if (fs.existsSync(LAST_VERSION_FILE)) {
            const version = fs.readFileSync(LAST_VERSION_FILE, 'utf8').trim();
            log('INFO', `Retrieved stored version: ${version}`);
            return version;
        } else {
            log('INFO', 'No previous version file found.');
            return null;
        }
    } catch (error) {
        log('ERROR', `Error reading version from file: ${error.message}`);
        return null;
    }
}

async function backupServer() {
    if (!SERVER_DIRECTORY || !fs.existsSync(SERVER_DIRECTORY)) {
        log('INFO', `Server directory not found or not set. Skipping backup.`);
        return null;
    }
    const backupDir = path.join(BACKUP_DIRECTORY, new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_'));
    fs.mkdirSync(backupDir, { recursive: true });
    log('INFO', `Creating backup in ${backupDir}`);
    try {
        await copyDir(SERVER_DIRECTORY, backupDir);
        if (os.platform() !== 'win32') {
            await changeOwnership(backupDir, MC_USER, MC_GROUP);
        }
        log('INFO', `Backup complete in ${backupDir}`);
        return backupDir;
    } catch (error) {
        log('ERROR', `Error during backup: ${error}`);
        if (fs.existsSync(backupDir)) {
            await removeDir(backupDir);
        }
        throw error;
    }
}

async function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function copyExistingData(backupDir, newInstallDir) {
    log('INFO', `Copying existing data from ${backupDir} to ${newInstallDir}`);
    for (const worldDir of WORLD_DIRECTORIES) {
        const srcPath = path.join(backupDir, worldDir);
        const destPath = path.join(newInstallDir, worldDir);
        if (fs.existsSync(srcPath)) {
            log('INFO', `Copying world directory: ${worldDir}`);
            await copyDir(srcPath, destPath);
        } else {
            log('WARNING', `Backup world directory not found: ${srcPath}`);
        }
    }
    for (const file of CONFIG_FILES) {
        const srcPath = path.join(backupDir, file);
        const destPath = path.join(newInstallDir, file);
        if (fs.existsSync(srcPath)) {
            log('INFO', `Copying config file: ${file}`);
            fs.copyFileSync(srcPath, destPath);
        } else {
            log('WARNING', `Backup config file not found: ${srcPath}`);
        }
    }
    log('INFO', 'Finished copying existing data.');
}

async function stopServer() {
    if (!serverPID) {
        log('INFO', `Server process PID not found. Server may already be stopped.`);
        return;
    }
    try {
        log('INFO', `Attempting to stop Minecraft server process with PID: ${serverPID}.`);
        process.kill(serverPID, 'SIGTERM');
        log('INFO', `SIGTERM signal sent to PID: ${serverPID}.`);
    } catch (error) {
        log('ERROR', `Error stopping server with PID ${serverPID} (process might not exist): ${error.message}`);
    } finally {
        serverPID = null;
    }
}

async function startServer() {
    if (serverPID) {
        log('INFO', `Server process already has a PID: ${serverPID}. Check if it's running.`);
        if (await isProcessRunning()) {
            log('INFO', `Server is already running with PID ${serverPID}.`);
            return;
        } else {
            log('INFO', `Stale PID ${serverPID} found. Clearing.`);
            serverPID = null;
        }
    }
    try {
        const serverExePath = path.join(SERVER_DIRECTORY, SERVER_EXE_NAME);
        if (!fs.existsSync(serverExePath)) {
            log('WARNING', `Server executable not found at ${serverExePath}. Cannot start server. Run update/install first.`);
            return;
        }
        log('INFO', `Starting Minecraft server from ${serverExePath}`);
        const serverProcess = spawn(serverExePath, [], {
            cwd: SERVER_DIRECTORY,
            stdio: 'inherit',
            detached: true
        });
        if (serverProcess.pid) {
            serverPID = serverProcess.pid;
            log('INFO', `Server process started with PID: ${serverPID}.`);
        } else {
            log('ERROR', `Server process started but PID was not obtained.`);
        }
        serverProcess.unref();
        serverProcess.on('error', (err) => {
            log('ERROR', `Server process error: ${err.message}`);
            if (serverPID === serverProcess.pid) serverPID = null;
        });
        serverProcess.on('exit', (code, signal) => {
            log('INFO', `Server process PID ${serverProcess.pid} exited with code ${code} and signal ${signal}`);
            if (serverPID === serverProcess.pid) serverPID = null;
        });
    } catch (error) {
        log('ERROR', `Error starting server: ${error.message}`);
        if (serverPID) serverPID = null;
        throw error;
    }
}

async function checkAndInstall() {
    log('INFO', 'Checking for new Minecraft Bedrock server releases...');
    const latestVersion = await getLatestVersion();
    if (!latestVersion) {
        log('WARNING', 'Failed to retrieve the latest version. Aborting update check.');
        return { success: false, message: 'Failed to retrieve latest version.' };
    }
    const lastVersion = getStoredVersion();
    if (lastVersion && latestVersion === lastVersion) {
        log('INFO', 'No new version found. Server is up to date.');
        return { success: true, message: 'Server is already up to date.' };
    }
    log('INFO', `New version found: ${latestVersion}. Current version: ${lastVersion || 'None'}`);
    const platform = os.platform();
    let downloadUrl = `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${latestVersion}.zip`;
    if (platform === 'win32') {
        downloadUrl = `https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-${latestVersion}.zip`;
    }
    const tempInstallPath = path.join(TEMP_DIRECTORY, latestVersion);
    const downloadPath = path.join(tempInstallPath, `bedrock-server-${latestVersion}.zip`);
    try {
        if (WEBHOOK_URL) {
            try { await sendWebhookNotification(`New Minecraft Bedrock Server version ${latestVersion} is available! Server going down for update...`); }
            catch (error) { log('ERROR', `Failed to send webhook notification: ${error}`);}
        }
        await stopServer();
        const backupDir = await backupServer();
        if (backupDir) { log('INFO', `Server backed up to: ${backupDir}`); }
        if (fs.existsSync(tempInstallPath)) {
            log('INFO', `Version ${latestVersion} already exists in temporary directory: ${tempInstallPath}. Skipping download and extraction.`);
        } else {
            fs.mkdirSync(tempInstallPath, { recursive: true });
            log('INFO', `Created temporary installation directory: ${tempInstallPath}`);
            log('INFO', `Downloading server files from ${downloadUrl} to ${downloadPath}`);
            await downloadFile(downloadUrl, downloadPath);
            log('INFO', 'Download complete.');
            log('INFO', `Extracting files to ${tempInstallPath}`);
            await extractFiles(downloadPath, tempInstallPath);
            fs.unlinkSync(downloadPath);
            log('INFO', 'Extraction complete.');
        }
        if (fs.existsSync(SERVER_DIRECTORY)) {
            await removeDir(SERVER_DIRECTORY);
            log('INFO', `Removed existing server directory ${SERVER_DIRECTORY}`);
        }
        fs.renameSync(tempInstallPath, SERVER_DIRECTORY);
        log('INFO', `Moved new server files to ${SERVER_DIRECTORY}`);
        if (backupDir) {
            await copyExistingData(backupDir, SERVER_DIRECTORY);
            log('INFO', `Copied existing data from backup to new server directory.`);
        }
        storeLatestVersion(latestVersion);
        log('INFO', `Successfully installed/updated to version ${latestVersion}`);
        await changeOwnership(SERVER_DIRECTORY, MC_USER, MC_GROUP);
        log('INFO', `Changed ownership to ${MC_USER}:${MC_GROUP} (if applicable).`);
        if (WEBHOOK_URL) {
            try { await sendWebhookNotification(`Minecraft Bedrock Server updated to version ${latestVersion}! Server restarting...`); }
            catch (error) { log('ERROR', `Failed to send webhook notification: ${error}`);}
        }
        await startServer();
        log('INFO', 'Update process complete. Server should be starting.');
        return { success: true, message: `Server updated to version ${latestVersion}.` };
    } catch (error) {
        log('ERROR', `Error during installation: ${error.message}`);
        try { await startServer(); log('INFO', 'Attempted to restart server after failed update.'); }
        catch (startErr) { log('ERROR', `Failed to restart server after update error: ${startErr.message}`); }
        return { success: false, message: `Error during installation: ${error.message}` };
    }
}

async function removeDir(dirPath) { // Removed instanceIdForLogging
    if (!fs.existsSync(dirPath)) {
        log('INFO', `Directory not found, skipping removal: ${dirPath}`);
        return;
    }
    const validBasePathsForRemove = [SERVER_DIRECTORY, TEMP_DIRECTORY, BACKUP_DIRECTORY];
    const isPathValidForRemove = validBasePathsForRemove.some(base => dirPath.startsWith(base) && path.resolve(dirPath) !== path.resolve(base));
    if (!isPathValidForRemove) {
        log('ERROR', `removeDir attempted on restricted or base path: ${dirPath}. Must be a sub-directory within configured paths.`);
        throw new Error(`Invalid path for removeDir: ${dirPath}. Operation aborted for security.`);
    }
    log('INFO', `Attempting to remove directory recursively: ${dirPath}`);
    if (fs.promises.rm) {
        try {
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            log('INFO', `Successfully removed directory using fs.promises.rm: ${dirPath}`);
            return;
        } catch (error) {
            log('ERROR', `fs.promises.rm failed for ${dirPath}: ${error.message}. Falling back to spawn.`);
        }
    }
    return new Promise((resolve, reject) => {
        const platform = os.platform();
        let command, args;
        if (platform === 'win32') { command = 'rmdir'; args = ['/s', '/q', dirPath]; }
        else { command = 'rm'; args = ['-rf', dirPath]; }
        log('INFO', `Using command for removeDir: ${command} ${args.join(' ')}`);
        const childProcess = spawn(command, args, { stdio: 'pipe' });
        let stdoutData = ''; let stderrData = '';
        childProcess.stdout.on('data', (data) => stdoutData += data.toString());
        childProcess.stderr.on('data', (data) => stderrData += data.toString());
        childProcess.on('close', (code) => {
            if (stdoutData) log('DEBUG', `removeDir stdout: ${stdoutData}`); // DEBUG for potentially verbose output
            if (stderrData) log('ERROR', `removeDir stderr: ${stderrData}`);
            if (code === 0) {
                log('INFO', `Successfully removed directory using spawn: ${dirPath}`);
                resolve();
            } else {
                reject(new Error(`Failed to remove directory ${dirPath} using spawn. Exit code: ${code}. Stderr: ${stderrData}`));
            }
        });
        childProcess.on('error', (error) => {
            log('ERROR', `Failed to start removeDir process for ${dirPath} using spawn: ${error.message}`);
            reject(new Error(`Failed to start removeDir process: ${error.message}`));
        });
    });
}

async function readServerProperties() { // Removed instanceConfig
    const configPath = path.join(SERVER_DIRECTORY, 'server.properties');
    if (!fs.existsSync(configPath)) {
        log('WARNING', `server.properties not found at ${configPath}. Returning empty config.`);
        return {};
    }
    const data = await fs.promises.readFile(configPath, 'utf8');
    const properties = {};
    data.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, value] = trimmedLine.split('=').map(s => s.trim());
            if (key) { properties[key] = value || ''; }
        }
    });
    log('INFO', `Read server.properties from ${configPath}`);
    return properties;
}

async function writeServerProperties(propertiesToWrite) { // Removed instanceConfig
    const configPath = path.join(SERVER_DIRECTORY, 'server.properties');
    let content = '';
    for (const key in propertiesToWrite) {
        if (Object.hasOwnProperty.call(propertiesToWrite, key)) {
            content += `${key}=${propertiesToWrite[key]}\n`;
        }
    }
    await fs.promises.writeFile(configPath, content, 'utf8');
    log('INFO', `Wrote server.properties to ${configPath}`);
}

async function listWorlds() { // Removed instanceConfig
    const worldsPath = path.join(SERVER_DIRECTORY, 'worlds');
    if (!fs.existsSync(worldsPath)) {
        log('WARNING', `Worlds directory not found at ${worldsPath}. Returning empty world list.`);
        return [];
    }
    const entries = await fs.promises.readdir(worldsPath, { withFileTypes: true });
    const worldNames = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    log('INFO', `Listed worlds: ${worldNames.join(', ')}`);
    return worldNames;
}

async function activateWorld(worldName) { // Removed instanceConfig
    const worldsPath = path.join(SERVER_DIRECTORY, 'worlds');
    const targetWorldPath = path.join(worldsPath, worldName);
    if (!fs.existsSync(targetWorldPath)) {
        log('ERROR', `World directory '${worldName}' not found at ${targetWorldPath}. Cannot activate.`);
        return false;
    }
    try {
        const properties = await readServerProperties();
        if (properties['level-name'] === worldName) {
            log('INFO', `World '${worldName}' is already active.`);
            return true;
        }
        properties['level-name'] = worldName;
        await writeServerProperties(properties);
        log('INFO', `Activated world: ${worldName}. Restarting server for changes to take effect.`);
        await restartServer();
        return true;
    } catch (error) {
        log('ERROR', `Failed to activate world '${worldName}': ${error.message}`);
        return false;
    }
}

async function restartServer() {
    log('INFO', `Restarting Minecraft server.`);
    await stopServer();
    await new Promise(resolve => setTimeout(resolve, 3000));
    await startServer();
    log('INFO', 'Minecraft server restart command executed.');
}

async function isProcessRunning() {
    if (!serverPID) {
        log('DEBUG', `No PID found for server. Assuming not running.`);
        return false;
    }
    try {
        process.kill(serverPID, 0);
        log('DEBUG', `Process with PID ${serverPID} is running.`);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') {
            log('INFO', `Process with PID ${serverPID} not found (ESRCH).`);
        } else {
            log('ERROR', `Error checking process PID ${serverPID}: ${error.message} (Code: ${error.code})`);
        }
        serverPID = null;
        return false;
    }
}

async function sendWebhookNotification(message) {
    if (!WEBHOOK_URL) {
        log('INFO', 'Webhook URL is not configured. Skipping notification.');
        return;
    }
    const postData = JSON.stringify({ content: message });
    const url = new URL(WEBHOOK_URL);
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': postData.length },
    };
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                log('INFO', 'Webhook notification sent successfully.');
                resolve();
            } else {
                let responseData = '';
                res.on('data', (chunk) => { responseData += chunk; });
                res.on('end', () => {
                    log('ERROR', `Webhook notification failed: ${res.statusCode} - ${responseData}`);
                    reject(new Error(`Webhook notification failed: ${res.statusCode} - ${responseData}`));
                });
            }
            res.on('error', (err) => {
                log('ERROR', `Error sending webhook notification: ${err.message}`);
                reject(err);
            });
        });
        req.on('error', (err) => {
            log('ERROR', `Error sending webhook notification: ${err.message}`);
            reject(err);
        });
        req.write(postData);
        req.end();
    });
}

async function readGlobalConfig() {
    const configPath = path.join(__dirname, GLOBAL_CONFIG_FILE);
    let effectiveConfig = {
        serverName: "Default Minecraft Server", serverPortIPv4: 19132, serverPortIPv6: 19133,
        serverDirectory: "./server_data/default_server", tempDirectory: "./server_data/temp/default_server",
        backupDirectory: "./server_data/backup/default_server", worldName: "Bedrock level",
        autoStart: false, autoUpdateEnabled: true, autoUpdateIntervalMinutes: 60, logLevel: "INFO"
    };
    setLogLevel(effectiveConfig.logLevel);
    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            const configFromFile = JSON.parse(data);
            effectiveConfig = { ...effectiveConfig, ...configFromFile };
            if (configFromFile.logLevel) setLogLevel(configFromFile.logLevel);
            log('INFO', `Configuration loaded from ${configPath}`);
        } catch (error) {
            log('ERROR', `Error reading/parsing ${configPath}: ${error.message}. Using/creating default config.`);
            try { fs.writeFileSync(configPath, JSON.stringify(effectiveConfig, null, 2), 'utf8'); log('INFO', `Wrote default configuration to ${configPath}.`); }
            catch (writeError) { log('ERROR', `Failed to write default configuration to ${configPath}: ${writeError.message}`); }
        }
    } else {
        log('WARNING', `${configPath} not found. Creating with default values.`);
        try { fs.writeFileSync(configPath, JSON.stringify(effectiveConfig, null, 2), 'utf8'); log('INFO', `Created default configuration file at ${configPath}`); }
        catch (writeError) { log('ERROR', `Failed to create default configuration file at ${configPath}: ${writeError.message}`); }
    }
    const args = process.argv.slice(2);
    log('DEBUG', `CLI arguments: ${args.join(' ')}`);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]; const value = args[i+1];
        let valueConsumed = (value !== undefined && !value.startsWith('--'));
        switch (arg) {
            case '--serverName': if(valueConsumed) effectiveConfig.serverName = value; break;
            case '--serverPortIPv4': if(valueConsumed) effectiveConfig.serverPortIPv4 = parseInt(value, 10); break;
            case '--serverPortIPv6': if(valueConsumed) effectiveConfig.serverPortIPv6 = parseInt(value, 10); break;
            case '--serverDirectory': if(valueConsumed) effectiveConfig.serverDirectory = value; break;
            case '--tempDirectory': if(valueConsumed) effectiveConfig.tempDirectory = value; break;
            case '--backupDirectory': if(valueConsumed) effectiveConfig.backupDirectory = value; break;
            case '--worldName': if(valueConsumed) effectiveConfig.worldName = value; break;
            case '--autoStart': effectiveConfig.autoStart = (valueConsumed ? (value === 'true') : true); break;
            case '--autoUpdateEnabled': effectiveConfig.autoUpdateEnabled = (valueConsumed ? (value === 'true') : true); break;
            case '--logLevel': if(valueConsumed) effectiveConfig.logLevel = value.toUpperCase(); break;
            default: valueConsumed = false;
        }
        if (valueConsumed) { log('DEBUG', `CLI Override: ${arg} = ${args[i+1]}`); i++; }
        else if (arg === '--autoStart' || arg === '--autoUpdateEnabled') {
             const key = arg.substring(2).replace(/-([a-z])/g, g => g[1].toUpperCase());
             effectiveConfig[key] = true; log('DEBUG', `CLI Override (boolean flag): ${arg} = true`);
        } else if (arg === '--no-autoStart') { effectiveConfig.autoStart = false; log('DEBUG', `CLI Override (boolean flag): ${arg} = false`);
        } else if (arg === '--no-autoUpdateEnabled') { effectiveConfig.autoUpdateEnabled = false; log('DEBUG', `CLI Override (boolean flag): ${arg} = false`); }
    }
    setLogLevel(effectiveConfig.logLevel || "INFO");
    const resolvePath = (p) => path.isAbsolute(p) ? p : path.resolve(__dirname, p);
    effectiveConfig.serverDirectory = resolvePath(effectiveConfig.serverDirectory);
    effectiveConfig.tempDirectory = resolvePath(effectiveConfig.tempDirectory);
    effectiveConfig.backupDirectory = resolvePath(effectiveConfig.backupDirectory);
    log('INFO', 'Configuration loading complete.');
    log('DEBUG', `Final effective configuration: ${JSON.stringify(effectiveConfig, null, 2)}`);
    return effectiveConfig;
}

async function writeGlobalConfig(configToWrite) {
    const configPath = path.join(__dirname, GLOBAL_CONFIG_FILE);
    try {
        const storeConfig = JSON.parse(JSON.stringify(configToWrite));
        const makeRelativeIfNeeded = (absPath) => {
            if (absPath.startsWith(__dirname) && absPath !== __dirname) {
                let relPath = path.relative(__dirname, absPath);
                if (!relPath.startsWith('..') && !path.isAbsolute(relPath)) {
                    relPath = `.${path.sep}${relPath.startsWith(path.sep) ? relPath.substring(1) : relPath}`;
                }
                return relPath;
            }
            return absPath;
        };
        storeConfig.serverDirectory = makeRelativeIfNeeded(storeConfig.serverDirectory);
        storeConfig.tempDirectory = makeRelativeIfNeeded(storeConfig.tempDirectory);
        storeConfig.backupDirectory = makeRelativeIfNeeded(storeConfig.backupDirectory);
        await fs.promises.writeFile(configPath, JSON.stringify(storeConfig, null, 2), 'utf8');
        log('INFO', `Wrote configuration to ${configPath}`);
    } catch (error) {
        log('ERROR', `Error writing configuration file ${configPath}: ${error.message}`);
        throw error;
    }
}

async function startAutoUpdateScheduler() {
    const currentConfig = await readGlobalConfig(); // Ensure we use the most up-to-date config
    if (autoUpdateIntervalId) {
        clearInterval(autoUpdateIntervalId);
        autoUpdateIntervalId = null;
        log('INFO', 'Cleared existing auto-update scheduler.');
    }
    if (currentConfig.autoUpdateEnabled && currentConfig.autoUpdateIntervalMinutes > 0) {
        const intervalMs = currentConfig.autoUpdateIntervalMinutes * 60 * 1000;
        log('INFO', `Starting auto-update scheduler to run every ${currentConfig.autoUpdateIntervalMinutes} minutes.`);
        const initialCheckResult = await checkAndInstall();
        if (!initialCheckResult.success) {
            log('ERROR', `Initial auto-update check failed: ${initialCheckResult.message}`);
        }
        autoUpdateIntervalId = setInterval(async () => {
            log('INFO', 'Auto-update check initiated by scheduler.');
            const result = await checkAndInstall();
            if (!result.success) { log('ERROR', `Auto-update failed: ${result.message}`); }
        }, intervalMs);
    } else {
        log('INFO', 'Auto-update is disabled or interval is invalid. Scheduler not started.');
    }
}

module.exports = {
    init,  log, getLatestVersion, downloadFile, extractFiles, changeOwnership, storeLatestVersion,
    getStoredVersion, backupServer, copyDir, copyExistingData, stopServer, startServer, checkAndInstall,
    removeDir, readServerProperties, writeServerProperties, listWorlds, activateWorld, restartServer,
    isProcessRunning, readGlobalConfig, writeGlobalConfig, startAutoUpdateScheduler, SERVER_EXE_NAME,
};
