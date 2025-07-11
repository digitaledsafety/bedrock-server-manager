import https from 'https';
import http from 'http';
import fs from 'fs';
import path, { dirname, join as pathJoin } from 'path';
import { exec as childProcessExec, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { URL } from 'url';
import util from 'util';
import os from 'os';
import AdmZip from 'adm-zip';

const execPromise = util.promisify(childProcessExec);

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

const MC_DOWNLOAD_API_URL = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';
const VERSION_REGEX = /bedrock-server-([\d\.]+)\.zip/;

let config = {};
let SERVER_DIRECTORY;
let TEMP_DIRECTORY;
let BACKUP_DIRECTORY;
let serverPID = null;

const MC_USER = 'minecraft';
const MC_GROUP = 'minecraft';
const LAST_VERSION_FILE = 'last_version.txt';
const WEBHOOK_URL = process.env.MC_UPDATE_WEBHOOK;
export const SERVER_EXE_NAME = os.platform() === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
const CONFIG_FILES = ['server.properties', 'permissions.json', 'whitelist.json'];
const WORLD_DIRECTORIES = ['worlds'];
const GLOBAL_CONFIG_FILE = 'config.json';

let autoUpdateIntervalId = null;

const logStream = fs.createWriteStream(pathJoin(__dirnameESM, 'mc_installer.log'), { flags: 'a' });
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, FATAL: 4 };
let currentLogLevel = LOG_LEVELS.INFO;

function setLogLevel(levelName) {
    const levelNameToUse = (levelName || "INFO").toUpperCase();
    const newLevel = LOG_LEVELS[levelNameToUse];
    if (newLevel !== undefined) {
        const oldLogLevel = currentLogLevel;
        currentLogLevel = newLevel;
        // Log this message only if the new level allows INFO messages AND the old level also allowed it,
        // or if we are increasing verbosity to INFO from something more restrictive.
        if (LOG_LEVELS.INFO >= currentLogLevel && (LOG_LEVELS.INFO >= oldLogLevel || currentLogLevel <= oldLogLevel) ) {
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

export function log(level, message) {
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

export function init(effectiveConfigFromRead) {
    config = effectiveConfigFromRead;
    setLogLevel(config.logLevel || "INFO");
    log('INFO', `Initializing with configuration: ${JSON.stringify(config, null, 2)}`);
    SERVER_DIRECTORY = config.serverDirectory;
    TEMP_DIRECTORY = config.tempDirectory;
    BACKUP_DIRECTORY = config.backupDirectory;
    log('INFO', `Using Server Directory: ${SERVER_DIRECTORY}`);
    log('INFO', `Using Temp Directory: ${TEMP_DIRECTORY}`);
    log('INFO', `Using Backup Directory: ${BACKUP_DIRECTORY}`);
    const dirsToCreate = [SERVER_DIRECTORY, TEMP_DIRECTORY, BACKUP_DIRECTORY].filter(Boolean);
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

export async function getLatestVersion() {
    return new Promise((resolve, reject) => {
        const apiURL = new URL(MC_DOWNLOAD_API_URL);
        https.get(apiURL, { headers: { 'Accept-Language': 'en-US,en;q=0.5' } }, (res) => {
            let data = '';
            if (res.statusCode < 200 || res.statusCode >= 300) {
                log('ERROR', `Failed to fetch download links from API. Status: ${res.statusCode} ${res.statusMessage}. Response: ${data}`);
                return reject(new Error(`API error! Status code: ${res.statusCode}`));
            }
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonResponse = JSON.parse(data);
                    const platform = os.platform();
                    const targetDownloadType = platform === 'win32' ? 'serverBedrockWindows' : 'serverBedrockLinux';
                    let foundLink = null;
                    if (jsonResponse && jsonResponse.result && jsonResponse.result.links) {
                        foundLink = jsonResponse.result.links.find(link => link.downloadType === targetDownloadType);
                    }
                    if (foundLink && foundLink.downloadUrl) {
                        const downloadUrl = foundLink.downloadUrl;
                        log('DEBUG', `Found download URL via API: ${downloadUrl}`);
                        const versionMatch = downloadUrl.match(VERSION_REGEX);
                        if (versionMatch && versionMatch[1]) {
                            resolve({ latestVersion: versionMatch[1].trim(), downloadUrl: downloadUrl });
                        } else {
                            log('WARNING', `Could not extract version from API download URL: ${downloadUrl}`);
                            resolve(null);
                        }
                    } else {
                        log('WARNING', `Could not find download link for '${targetDownloadType}' in API response.`);
                        resolve(null);
                    }
                } catch (error) {
                    log('ERROR', `Error parsing JSON response from download API: ${error.message}. Response: ${data}`);
                    reject(error);
                }
            });
        }).on('error', err => {
            log('ERROR', `Error fetching data from download API: ${err.message}`);
            reject(err);
        });
    });
}

export function downloadFile(downloadUrl, downloadPath) {
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

export function extractFiles(zipPath, extractPath) {
    return new Promise((resolve, reject) => {
        const platform = os.platform();
        let childProcess;
        if (platform === 'win32') {
            const psPath = pathJoin(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
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
            log('DEBUG', `Extraction stdout: ${stdoutData}`);
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

export async function changeOwnership(dirPath, user, group) {
    if (os.platform() === 'win32') {
        log('INFO', `Skipping changeOwnership on Windows.`);
        return;
    }
    const validBasePaths = [SERVER_DIRECTORY, BACKUP_DIRECTORY].filter(Boolean);
    if (!validBasePaths.some(base => dirPath.startsWith(base))) {
        log('ERROR', `changeOwnership attempted on restricted path: ${dirPath}. Expected to be within configured server or backup directories.`);
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
                if (stdoutData) log('DEBUG', `chown stdout: ${stdoutData}`);
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

export function storeLatestVersion(version) {
    try {
        fs.writeFileSync(pathJoin(__dirnameESM, LAST_VERSION_FILE), version);
        log('INFO', `Stored latest version: ${version}`);
    } catch (error) {
        log('ERROR', `Error storing version to file: ${error.message}`);
    }
}

export function getStoredVersion() {
    try {
        const lastVersionFilePath = pathJoin(__dirnameESM, LAST_VERSION_FILE);
        if (fs.existsSync(lastVersionFilePath)) {
            const version = fs.readFileSync(lastVersionFilePath, 'utf8').trim();
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

export async function backupServer() {
    if (!SERVER_DIRECTORY || !fs.existsSync(SERVER_DIRECTORY)) {
        log('INFO', `Server directory not found or not set. Skipping backup.`);
        return null;
    }
    const backupDir = pathJoin(BACKUP_DIRECTORY, new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_'));
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

export async function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = pathJoin(src, entry.name);
        const destPath = pathJoin(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

export async function copyExistingData(backupDir, newInstallDir) {
    log('INFO', `Copying existing data from ${backupDir} to ${newInstallDir}`);

    const directoriesToCopy = [
        ...WORLD_DIRECTORIES,
        'behavior_packs',
        'resource_packs',
        'development_behavior_packs',
        'development_resource_packs'
    ];

    for (const dirName of directoriesToCopy) {
        const srcPath = pathJoin(backupDir, dirName);
        const destPath = pathJoin(newInstallDir, dirName);
        if (fs.existsSync(srcPath)) {
            log('INFO', `Copying directory: ${dirName}`);
            await copyDir(srcPath, destPath);
        } else {
            log('INFO', `Backup directory not found (this is okay if not used): ${srcPath}`);
        }
    }

    for (const file of CONFIG_FILES) {
        const srcPath = pathJoin(backupDir, file);
        const destPath = pathJoin(newInstallDir, file);
        if (fs.existsSync(srcPath)) {
            log('INFO', `Copying config file: ${file}`);
            fs.copyFileSync(srcPath, destPath);
        } else {
            log('WARNING', `Backup config file not found: ${srcPath}`);
        }
    }
    log('INFO', 'Finished copying existing data.');
}

export async function stopServer() {
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

export async function startServer() {
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
        const serverExePath = pathJoin(SERVER_DIRECTORY, SERVER_EXE_NAME);
        if (!fs.existsSync(serverExePath)) {
            log('WARNING', `Server executable not found at ${serverExePath}. Cannot start server. Run update/install first.`);
            return;
        }
        log('INFO', `Starting Minecraft server from ${serverExePath}`);
        const serverProcess = spawn(serverExePath, [], {
            cwd: SERVER_DIRECTORY,
            stdio: 'inherit',
            detached: false
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

export async function checkAndInstall() {
    log('INFO', 'Checking for new Minecraft Bedrock server releases...');
    const versionInfo = await getLatestVersion();
    if (!versionInfo || !versionInfo.latestVersion || !versionInfo.downloadUrl) {
        log('WARNING', 'Failed to retrieve the latest version or download URL. Aborting update check.');
        return { success: false, message: 'Failed to retrieve latest version information from API.' };
    }
    const { latestVersion, downloadUrl: apiDownloadUrl } = versionInfo;

    const lastVersion = getStoredVersion();
    if (lastVersion && latestVersion === lastVersion) {
        log('INFO', 'No new version found. Server is up to date.');
        return { success: true, message: 'Server is already up to date.' };
    }
    log('INFO', `New version found: ${latestVersion}. Current version: ${lastVersion || 'None'}`);
   
    const tempInstallPath = pathJoin(TEMP_DIRECTORY, latestVersion);
    const downloadPath = pathJoin(tempInstallPath, `bedrock-server-${latestVersion}.zip`);
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
            log('INFO', `Downloading server files from ${apiDownloadUrl} to ${downloadPath}`);
            await downloadFile(apiDownloadUrl, downloadPath);
            log('INFO', 'Download complete.');
            log('INFO', `Extracting files to ${tempInstallPath}`);
            await extractFiles(downloadPath, tempInstallPath);
            fs.unlinkSync(downloadPath);
            log('INFO', 'Extraction complete.');
        }

        log('DEBUG', `Preparing to move files from temporary path: ${tempInstallPath} to SERVER_DIRECTORY: ${SERVER_DIRECTORY}`);
        if (!fs.existsSync(tempInstallPath)) {
            throw new Error(`Temporary installation path ${tempInstallPath} not found after extraction.`);
        }

        if (SERVER_DIRECTORY && fs.existsSync(SERVER_DIRECTORY)) { // Check if SERVER_DIRECTORY is defined
            log('INFO', `Removing existing server directory: ${SERVER_DIRECTORY}`);
            await removeDir(SERVER_DIRECTORY);
            log('INFO', `Removed existing server directory ${SERVER_DIRECTORY}`);
        }
        log('INFO', `Moving new server files from ${tempInstallPath} to ${SERVER_DIRECTORY}`);
        fs.renameSync(tempInstallPath, SERVER_DIRECTORY);
        log('INFO', 'Successfully moved new server files to SERVER_DIRECTORY.');
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

/**
 * Removes a directory recursively. Cross-platform compatible.
 * @param {string} dirPath The path to the directory to remove.
 * @returns {Promise<void>} A promise that resolves when the directory is removed.
 */
function removeDir(dirPath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(dirPath)) {
            resolve(); // Resolve if the directory does not exist
            return;
        }

        const platform = os.platform();
        if (platform === 'win32') {
            // Use Windows command to remove directory recursively and quietly
            childProcessExec(`rmdir /s /q "${dirPath}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Failed to remove directory ${dirPath}: ${error.message} ${stderr}`));
                } else {
                    resolve();
                }
            });
        } else {
            // Use Linux command to remove directory recursively and forcefully
            childProcessExec(`rm -rf "${dirPath}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Failed to remove directory ${dirPath}: ${error.message} ${stderr}`));
                } else {
                    resolve();
                }
            });
        }
    });
}


export async function readServerProperties() {
    const configPath = pathJoin(SERVER_DIRECTORY, 'server.properties');
    if (!SERVER_DIRECTORY || !fs.existsSync(configPath)) { // Check SERVER_DIRECTORY is defined
        log('WARNING', `server.properties not found at ${configPath} (or server directory not set). Returning empty config.`);
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

export async function writeServerProperties(propertiesToWrite) {
    if (!SERVER_DIRECTORY) {
        log('ERROR', 'SERVER_DIRECTORY not set. Cannot write server.properties.');
        throw new Error('Server directory not configured.');
    }
    const configPath = pathJoin(SERVER_DIRECTORY, 'server.properties');
    let content = '';
    for (const key in propertiesToWrite) {
        if (Object.hasOwnProperty.call(propertiesToWrite, key)) {
            content += `${key}=${propertiesToWrite[key]}\n`;
        }
    }
    await fs.promises.writeFile(configPath, content, 'utf8');
    log('INFO', `Wrote server.properties to ${configPath}`);
}

export async function listWorlds() {
    if (!SERVER_DIRECTORY) {
        log('WARNING', 'SERVER_DIRECTORY not set. Cannot list worlds.');
        return [];
    }
    const worldsPath = pathJoin(SERVER_DIRECTORY, 'worlds');
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

export async function activateWorld(worldName) {
    if (!SERVER_DIRECTORY) {
        log('ERROR', 'SERVER_DIRECTORY not set. Cannot activate world.');
        return false;
    }
    const worldsPath = pathJoin(SERVER_DIRECTORY, 'worlds');
    const targetWorldPath = pathJoin(worldsPath, worldName);
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

export async function restartServer() {
    log('INFO', `Restarting Minecraft server.`);
    await stopServer();
    await new Promise(resolve => setTimeout(resolve, 3000));
    await startServer();
    log('INFO', 'Minecraft server restart command executed.');
}

export async function isProcessRunning() {
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

export async function sendWebhookNotification(message) {
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

export async function readGlobalConfig() {
    const configPath = pathJoin(__dirnameESM, GLOBAL_CONFIG_FILE);
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
    const resolvePath = (p) => path.isAbsolute(p) ? p : path.resolve(__dirnameESM, p);
    effectiveConfig.serverDirectory = resolvePath(effectiveConfig.serverDirectory);
    effectiveConfig.tempDirectory = resolvePath(effectiveConfig.tempDirectory);
    effectiveConfig.backupDirectory = resolvePath(effectiveConfig.backupDirectory);
    log('INFO', 'Configuration loading complete.');
    log('DEBUG', `Final effective configuration: ${JSON.stringify(effectiveConfig, null, 2)}`);
    return effectiveConfig;
}

export async function writeGlobalConfig(configToWrite) {
    const configPath = pathJoin(__dirnameESM, GLOBAL_CONFIG_FILE);
    try {
        const storeConfig = JSON.parse(JSON.stringify(configToWrite));
        const makeRelativeIfNeeded = (absPath) => {
            if (absPath.startsWith(__dirnameESM) && absPath !== __dirnameESM) {
                let relPath = path.relative(__dirnameESM, absPath);
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

// --- Pack Management ---

/**
 * Reads the manifest.json file from a pack directory.
 * @param {string} packPath - The path to the pack directory.
 * @returns {Promise<object|null>} The manifest content as an object, or null if not found or error.
 */
async function readManifest(packPath) {
    const manifestFilePath = path.join(packPath, 'manifest.json');
    try {
        if (!fs.existsSync(manifestFilePath)) {
            log('WARNING', `Manifest file not found at: ${manifestFilePath}`);
            return null;
        }
        const manifestContent = await fs.promises.readFile(manifestFilePath, 'utf8');
        const manifestJson = JSON.parse(manifestContent);
        log('INFO', `Successfully read manifest for pack at: ${packPath}`);
        return manifestJson;
    } catch (error) {
        log('ERROR', `Error reading or parsing manifest at ${manifestFilePath}: ${error.message}`);
        return null;
    }
}

/**
 * Updates the world's pack configuration file (e.g., world_behavior_packs.json).
 * @param {string} worldPath - Path to the world directory.
 * @param {string} packTypeJsonFile - The name of the JSON file (e.g., 'world_behavior_packs.json').
 * @param {string} packId - The UUID of the pack.
 * @param {Array<number>} packVersion - The version array of the pack.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function updateWorldPackJson(worldPath, packTypeJsonFile, packId, packVersion) {
    const packJsonPath = path.join(worldPath, packTypeJsonFile);
    let packsConfig = [];
    try {
        if (fs.existsSync(packJsonPath)) {
            const content = await fs.promises.readFile(packJsonPath, 'utf8');
            packsConfig = JSON.parse(content);
            if (!Array.isArray(packsConfig)) {
                log('WARNING', `Invalid format in ${packJsonPath}. Expected array. Re-initializing.`);
                packsConfig = [];
            }
        }

        // Remove existing entry for the same pack_id, if any
        packsConfig = packsConfig.filter(pack => pack.pack_id !== packId);

        // Add the new pack entry
        packsConfig.push({
            pack_id: packId,
            version: packVersion
        });

        await fs.promises.writeFile(packJsonPath, JSON.stringify(packsConfig, null, 2), 'utf8');
        log('INFO', `Updated ${packJsonPath} with pack ID: ${packId}`);
        return true;
    } catch (error) {
        log('ERROR', `Failed to update ${packJsonPath}: ${error.message}`);
        return false;
    }
}

/**
 * Uploads and applies a pack (or packs from an addon) to a specific world.
 * @param {string} tempFilePath - Path to the temporary uploaded file (.mcpack or .mcaddon).
 * @param {string} originalFilename - The original name of the uploaded file.
 * @param {string} requestedPackType - Type of pack if uploading a single .mcpack ('behavior', 'resource', 'dev_behavior', 'dev_resource'). Ignored for .mcaddon.
 * @param {string} worldName - Name of the world to apply the pack(s) to.
 * @returns {Promise<{success: boolean, message: string}>} Result object.
 */
export async function uploadPack(tempFilePath, originalFilename, requestedPackType, worldName) {
    if (!SERVER_DIRECTORY) {
        return { success: false, message: 'Server directory not configured.' };
    }
    if (!worldName) {
        return { success: false, message: 'World name is required.' };
    }

    const worldPath = path.join(SERVER_DIRECTORY, 'worlds', worldName);
    if (!fs.existsSync(worldPath)) {
        return { success: false, message: `World '${worldName}' not found.` };
    }

    const isMcAddon = originalFilename.toLowerCase().endsWith('.mcaddon');
    let overallSuccess = true;
    let messages = [];
    let packsProcessedCount = 0;

    try {
        const zip = new AdmZip(tempFilePath);
        const zipEntries = zip.getEntries();
        if (zipEntries.length === 0) {
            return { success: false, message: 'Uploaded file is empty or invalid.' };
        }

        if (isMcAddon) {
            log('INFO', `Processing .mcaddon file: ${originalFilename}`);
            // Find all manifest.json files to identify individual packs
            const manifestEntries = zipEntries.filter(entry => entry.entryName.endsWith('manifest.json') && !entry.isDirectory);

            if (manifestEntries.length === 0) {
                return { success: false, message: 'No valid packs found within the .mcaddon file.' };
            }

            for (const manifestEntry of manifestEntries) {
                const packRootInZip = path.dirname(manifestEntry.entryName);
                const manifestData = JSON.parse(zip.readAsText(manifestEntry));

                if (!manifestData.header || !manifestData.header.uuid || !manifestData.header.version || !manifestData.header.name) {
                    log('WARNING', `Skipping pack in .mcaddon due to invalid manifest (missing header/uuid/version/name): ${manifestEntry.entryName}`);
                    messages.push(`Skipped pack from ${manifestEntry.entryName} (invalid manifest).`);
                    overallSuccess = false;
                    continue;
                }

                const packId = manifestData.header.uuid;
                const packVersion = manifestData.header.version;
                const packName = manifestData.header.name;

                // Determine pack type from manifest module type or location (simplistic for now)
                let packTypeModule = manifestData.modules && manifestData.modules[0] ? manifestData.modules[0].type : null;
                let currentPackTargetDirName;
                let currentWorldPackJsonFile;

                if (packTypeModule === 'data' || packRootInZip.toLowerCase().includes('behavior')) { // Assuming 'data' is behavior
                    currentPackTargetDirName = 'behavior_packs';
                    currentWorldPackJsonFile = 'world_behavior_packs.json';
                } else if (packTypeModule === 'resources' || packRootInZip.toLowerCase().includes('resource')) { // Assuming 'resources' is resource
                    currentPackTargetDirName = 'resource_packs';
                    currentWorldPackJsonFile = 'world_resource_packs.json';
                } else {
                    log('WARNING', `Skipping pack '${packName}' in .mcaddon: Could not determine pack type (behavior/resource) from manifest: ${manifestEntry.entryName}`);
                    messages.push(`Skipped pack '${packName}' (unknown type).`);
                    overallSuccess = false;
                    continue;
                }

                const packDirNameInFilesystem = packName.replace(/[^a-zA-Z0-9_-]/g, '_') || packId;
                const finalPackDirPathBase = path.join(SERVER_DIRECTORY, currentPackTargetDirName);
                const finalPackPath = path.join(finalPackDirPathBase, packDirNameInFilesystem);

                if (!fs.existsSync(finalPackDirPathBase)) {
                    fs.mkdirSync(finalPackDirPathBase, { recursive: true });
                }
                if (fs.existsSync(finalPackPath)) {
                    log('INFO', `Removing existing directory for pack '${packName}': ${finalPackPath}`);
                    await removeDir(finalPackPath);
                }
                fs.mkdirSync(finalPackPath, { recursive: true });

                zipEntries.forEach(zipEntry => {
                    if (zipEntry.entryName.startsWith(packRootInZip + '/') && !zipEntry.isDirectory) {
                        const relativePathInPack = path.relative(packRootInZip, zipEntry.entryName);
                        if (relativePathInPack) { // Ensure it's not the root itself if packRootInZip is ""
                            const targetFilePath = path.join(finalPackPath, relativePathInPack);
                            const targetFileDir = path.dirname(targetFilePath);
                            if (!fs.existsSync(targetFileDir)) {
                                fs.mkdirSync(targetFileDir, { recursive: true });
                            }
                            fs.writeFileSync(targetFilePath, zipEntry.getData());
                        }
                    } else if (packRootInZip === "" && zipEntry.entryName.indexOf('/') === -1 && !zipEntry.isDirectory) {
                        // Handle case where manifest is at the root of zip, and files are at root too
                         const targetFilePath = path.join(finalPackPath, zipEntry.entryName);
                         fs.writeFileSync(targetFilePath, zipEntry.getData());
                    }
                });
                log('INFO', `Extracted pack '${packName}' to ${finalPackPath}`);

                const updateSuccess = await updateWorldPackJson(worldPath, currentWorldPackJsonFile, packId, packVersion);
                if (updateSuccess) {
                    messages.push(`Applied pack '${packName}'.`);
                    packsProcessedCount++;
                } else {
                    messages.push(`Failed to apply pack '${packName}' to world JSON.`);
                    overallSuccess = false;
                    await removeDir(finalPackPath); // Clean up extracted pack
                }
            }
            if (packsProcessedCount === 0 && !overallSuccess) {
                 return { success: false, message: "Failed to process any valid packs from the .mcaddon. " + messages.join(" ") };
            }
            return { success: overallSuccess, message: `.mcaddon processing complete. ${packsProcessedCount} pack(s) processed. Details: ${messages.join(" ")} Restart server if needed.` };

        } else { // Handle as .mcpack
            log('INFO', `Processing .mcpack file: ${originalFilename} with requested type: ${requestedPackType}`);
            let targetPackDirName;
            let worldPackJsonFile;

            switch (requestedPackType) {
                case 'behavior':
                    targetPackDirName = 'behavior_packs';
                    worldPackJsonFile = 'world_behavior_packs.json';
                    break;
                case 'resource':
                    targetPackDirName = 'resource_packs';
                    worldPackJsonFile = 'world_resource_packs.json';
                    break;
                case 'dev_behavior':
                    targetPackDirName = 'development_behavior_packs';
                    worldPackJsonFile = 'world_behavior_packs.json'; // Assumed to be listed
                    break;
                case 'dev_resource':
                    targetPackDirName = 'development_resource_packs';
                    worldPackJsonFile = 'world_resource_packs.json'; // Assumed to be listed
                    break;
                default:
                    return { success: false, message: 'Invalid pack type specified for .mcpack.' };
            }

            const finalPackDirPathBase = path.join(SERVER_DIRECTORY, targetPackDirName);
            if (!fs.existsSync(finalPackDirPathBase)) {
                fs.mkdirSync(finalPackDirPathBase, { recursive: true });
            }

            const manifestEntry = zipEntries.find(entry => entry.entryName.endsWith('manifest.json') && !entry.isDirectory);
            if (!manifestEntry) {
                return { success: false, message: 'manifest.json not found in the uploaded .mcpack.' };
            }
            const packRootInZip = path.dirname(manifestEntry.entryName);
            const manifestData = JSON.parse(zip.readAsText(manifestEntry));

            if (!manifestData.header || !manifestData.header.uuid || !manifestData.header.version || !manifestData.header.name) {
                return { success: false, message: 'Invalid manifest.json: missing header, uuid, version, or name.' };
            }
            const packId = manifestData.header.uuid;
            const packVersion = manifestData.header.version;
            const packName = manifestData.header.name;

            let packDirNameInFilesystem = packName.replace(/[^a-zA-Z0-9_-]/g, '_') || packId;
            const finalPackPath = path.join(finalPackDirPathBase, packDirNameInFilesystem);

            if (fs.existsSync(finalPackPath)) {
                log('INFO', `Removing existing directory for pack '${packName}': ${finalPackPath}`);
                await removeDir(finalPackPath);
            }
            fs.mkdirSync(finalPackPath, { recursive: true });

            zipEntries.forEach(zipEntry => {
                 if (zipEntry.entryName.startsWith(packRootInZip) && !zipEntry.isDirectory) {
                    // Make sure path.relative doesn't return an empty string if packRootInZip is the entry itself (e.g. "manifest.json")
                    // or if packRootInZip is "." and entryName is "manifest.json"
                    let relativePathInPack = path.relative(packRootInZip, zipEntry.entryName);
                    if (packRootInZip === "." && zipEntry.entryName.indexOf('/') === -1) relativePathInPack = zipEntry.entryName;


                    if(relativePathInPack){
                        const targetFilePath = path.join(finalPackPath, relativePathInPack);
                        const targetFileDir = path.dirname(targetFilePath);
                        if (!fs.existsSync(targetFileDir)) {
                            fs.mkdirSync(targetFileDir, { recursive: true });
                        }
                        fs.writeFileSync(targetFilePath, zipEntry.getData());
                    } else if (manifestEntry.entryName === zipEntry.entryName && packRootInZip === path.dirname(manifestEntry.entryName)) {
                        // if packRootInZip is the directory of manifest, and this is the manifest, place it at root of finalPackPath
                        const targetFilePath = path.join(finalPackPath, path.basename(zipEntry.entryName));
                         fs.writeFileSync(targetFilePath, zipEntry.getData());
                    }
                }
            });
            log('INFO', `Extracted .mcpack '${packName}' to ${finalPackPath}`);

            const updateSuccess = await updateWorldPackJson(worldPath, worldPackJsonFile, packId, packVersion);
            if (!updateSuccess) {
                await removeDir(finalPackPath);
                return { success: false, message: `Failed to update ${worldPackJsonFile} for .mcpack '${packName}'.` };
            }
            return { success: true, message: `Pack '${packName}' uploaded and applied to ${worldName}. Restart server if needed.` };
        }

    } catch (error) {
        log('ERROR', `Error processing pack upload for ${originalFilename}: ${error.message} ${error.stack}`);
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (unlinkError) {
            log('WARNING', `Could not delete temporary file ${tempFilePath} after error: ${unlinkError.message}`);
        }
        return { success: false, message: `Error processing pack: ${error.message}` };
    }
}


// --- End Pack Management ---

export async function startAutoUpdateScheduler() {
    const currentConfig = await readGlobalConfig();
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
