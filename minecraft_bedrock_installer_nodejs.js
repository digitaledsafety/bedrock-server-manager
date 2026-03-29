import https from 'https';
import http from 'http';
import * as fs from 'fs';
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

const LAST_VERSION_FILE = 'last_version.txt';
const WEBHOOK_URL = process.env.MC_UPDATE_WEBHOOK;
const CONFIG_FILES = ['server.properties', 'permissions.json', 'whitelist.json', 'allowlist.json'];
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
            process.stdout.write(initialLogMessage);
            logStream.write(initialLogMessage);
        }
    } else {
        const warningMessage = `${new Date().toISOString()} [WARNING] Invalid log level: ${levelName}. Defaulting to INFO.\n`;
        process.stderr.write(warningMessage);
        logStream.write(warningMessage);
        currentLogLevel = LOG_LEVELS.INFO;
    }
}

export function log(level, message) {
    const messageLevel = LOG_LEVELS[level.toUpperCase()];
    if (messageLevel === undefined) {
        process.stderr.write(`Invalid log level used in log() call: ${level}\n`);
        return;
    }
    if (messageLevel >= currentLogLevel) {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} [${level.toUpperCase()}] ${message}\n`;
        process.stdout.write(logMessage);
        logStream.write(logMessage);
    }
}

/**
 * Validates a world name to prevent path traversal and ensure it follows a safe pattern.
 * @param {string} worldName - The name of the world to validate.
 * @returns {boolean} True if the world name is valid, false otherwise.
 */
export function isValidWorldName(worldName) {
    if (!worldName || typeof worldName !== 'string') return false;
    const worldNameRegex = /^[a-zA-Z0-9_ -]+$/;
    // Prevent path traversal and check against allowed characters
    if (worldName.includes('.') || worldName.includes('/') || worldName.includes('\\') || !worldNameRegex.test(worldName)) {
        return false;
    }
    return true;
}

export function getServerExeName() {
    const platform = os.platform();
    const serverType = config.serverType || 'bedrock';

    if (serverType === 'bedrock_education') {
        if (platform === 'win32') {
            return 'bedrock_server.exe';
        } else {
            return 'bedrock_server_edu';
        }
    } else { // Default to bedrock
        return platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
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
    const serverType = config.serverType || 'bedrock';
    const platform = os.platform();

    if (serverType === 'java') {
        log('INFO', 'Java server type is not yet supported.');
        return null;
    }

    if (serverType === 'bedrock_education') {
       const redirectUrlString = platform === 'win32'
            ? 'https://aka.ms/downloadmee-winServerBeta'
            : 'https://aka.ms/downloadmee-linuxServerBeta';

        // Wrap https.get in a promise to use with async/await
        const downloadUrl = await new Promise((resolve, reject) => {
            const request = https.get(new URL(redirectUrlString), (res) => {
                res.resume(); // Consume response data
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    resolve(res.headers.location);
                } else {
                    reject(new Error(`Failed to get redirect location. Status: ${res.statusCode}`));
                }
            });
            request.on('error', (err) => {
                reject(new Error(`Error getting Minecraft Education Edition download link: ${err.message}`));
            });
        });

        log('DEBUG', `Redirected to: ${downloadUrl}`);
        const versionRegex = /MinecraftEducation_Server_(?:Windows|Linux)_([\d\.]+)\.zip/;
        const versionMatch = downloadUrl.match(versionRegex);

       if (versionMatch && versionMatch[1]) {
            const version = versionMatch[1].trim();
            log('INFO', `Found Minecraft Education Edition server version ${version} from redirect.`);
            return { latestVersion: version, downloadUrl: downloadUrl };
        } else {
            const error = new Error(`Could not extract version from the redirected URL: ${downloadUrl}`);
            log('ERROR', error.message);
            throw error;
        }
    }

    // Default to bedrock
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
                    let targetDownloadType;
                    if (serverType === 'bedrock_preview' || serverType === 'bedrock_server_preview') {
                        targetDownloadType = platform === 'win32' ? 'serverBedrockPreviewWindows' : 'serverBedrockPreviewLinux';
                    } else {
                        targetDownloadType = platform === 'win32' ? 'serverBedrockWindows' : 'serverBedrockLinux';
                    }
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
        try {
            log('INFO', `Using adm-zip for extraction for ${zipPath} to ${extractPath}.`);
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(extractPath, true); // true for overwrite
            log('INFO', `Extraction completed successfully.`);

            // 2. Set permissions for specific executable files (e.g., a script named 'script.sh')
            const executableFilePath = path.join(extractPath, getServerExeName());

            try {
                // Set permissions to 755 (owner can read/write/execute, others can read/execute)
                fs.chmodSync(executableFilePath, 0o755);
                log('INFO', `Permissions set to 755 for ${executableFilePath}`);
            } catch (err) {
                log('ERROR', `Failed to set permissions for ${executableFilePath}: ${err.message}`);
            }

            resolve();
        } catch (error) {
            log('ERROR', `Extraction failed for ${zipPath}: ${error.message}`);
            reject(new Error(`Extraction failed: ${error.message}`));
        }
    });
}

export async function changeOwnership(dirPath, user, group) {
    if (os.platform() === 'win32' || !user || !group) {
        log('INFO', 'Skipping changeOwnership on Windows or if user/group is not configured.');
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
        fs.cpSync(SERVER_DIRECTORY, backupDir, { recursive: true });
        if (os.platform() !== 'win32') {
            await changeOwnership(backupDir, config.minecraftUser, config.minecraftGroup);
        }
        log('INFO', `Backup complete in ${backupDir}`);
        return backupDir;
    } catch (error) {
        log('ERROR', `Error during backup: ${error}`);
        if (fs.existsSync(backupDir)) {
            fs.rmSync(backupDir, { recursive: true, force: true });
        }
        throw error;
    }
}

export async function copyDir(src, dest) {
    log('DEBUG', `Using fs.cpSync for copyDir from ${src} to ${dest}`);
    fs.cpSync(src, dest, { recursive: true });
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
            fs.cpSync(srcPath, destPath, { recursive: true });
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

/**
 * Attempts to recover the server PID from the server.pid file.
 * @returns {number|null} The recovered PID, or null if not found or invalid.
 */
function recoverPID() {
    if (SERVER_DIRECTORY) {
        const pidFile = pathJoin(SERVER_DIRECTORY, 'server.pid');
        if (fs.existsSync(pidFile)) {
            try {
                const pidString = fs.readFileSync(pidFile, 'utf8').trim();
                const pid = parseInt(pidString, 10);
                if (!isNaN(pid)) {
                    serverPID = pid;
                    log('INFO', `Recovered server PID from file: ${serverPID}`);
                    return serverPID;
                }
            } catch (error) {
                log('ERROR', `Failed to read PID file: ${error.message}`);
            }
        }
    }
    return null;
}

export async function stopServer() {
    if (!serverPID) {
        recoverPID();
    }

    if (!serverPID) {
        log('INFO', `Server process PID not found. Server may already be stopped.`);
        return;
    }

    const pidToKill = serverPID;
    try {
        log('INFO', `Attempting to stop Minecraft server process with PID: ${pidToKill}.`);
        process.kill(pidToKill, 'SIGTERM');
        log('INFO', `SIGTERM signal sent to PID: ${pidToKill}.`);

        // Wait for process to exit
        let isRunning = true;
        for (let i = 0; i < 50; i++) { // 5 seconds total
            try {
                process.kill(pidToKill, 0);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
                isRunning = false;
                break;
            }
        }

        if (isRunning) {
            log('WARNING', `Server process ${pidToKill} did not exit after 5 seconds. Sending SIGKILL.`);
            try {
                process.kill(pidToKill, 'SIGKILL');
            } catch (e) {
                log('ERROR', `Failed to send SIGKILL to PID ${pidToKill}: ${e.message}`);
            }
        }

        const pidFile = pathJoin(SERVER_DIRECTORY, 'server.pid');
        if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
        }
        log('INFO', `Server process ${pidToKill} stopped.`);
    } catch (error) {
        log('ERROR', `Error stopping server with PID ${pidToKill} (process might not exist): ${error.message}`);
    } finally {
        if (serverPID === pidToKill) {
            serverPID = null;
        }
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
        const serverExePath = pathJoin(SERVER_DIRECTORY, getServerExeName());
        if (!fs.existsSync(serverExePath)) {
            log('WARNING', `Server executable not found at ${serverExePath}. Cannot start server. Run update/install first.`);
            return;
        }
        log('INFO', `Starting Minecraft server from ${serverExePath}`);
        const serverProcess = spawn(serverExePath, [], {
            cwd: SERVER_DIRECTORY,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true
        });
        if (serverProcess.pid) {
            serverPID = serverProcess.pid;
            log('INFO', `Server process started with PID: ${serverPID}.`);
            try {
                fs.writeFileSync(pathJoin(SERVER_DIRECTORY, 'server.pid'), serverPID.toString(), 'utf8');
            } catch (error) {
                log('ERROR', `Failed to write PID file: ${error.message}`);
            }

            const serverLogPath = pathJoin(SERVER_DIRECTORY, 'server.log');
            const serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'a' });

            serverProcess.stdout.on('data', (data) => {
                serverLogStream.write(data);
                process.stdout.write(data); // Also log to manager's stdout
            });

            serverProcess.stderr.on('data', (data) => {
                serverLogStream.write(data);
                process.stderr.write(data); // Also log to manager's stderr
            });

            serverProcess.on('close', () => {
                serverLogStream.end();
            });

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
            fs.rmSync(SERVER_DIRECTORY, { recursive: true, force: true });
            log('INFO', `Removed existing server directory ${SERVER_DIRECTORY}`);
        }
        log('INFO', `Moving new server files from ${tempInstallPath} to ${SERVER_DIRECTORY}`);
        try {
            fs.renameSync(tempInstallPath, SERVER_DIRECTORY);
        } catch (renameError) {
            log('WARNING', `fs.renameSync failed (${renameError.message}). Attempting copy-and-remove fallback.`);
            fs.cpSync(tempInstallPath, SERVER_DIRECTORY, { recursive: true });
            fs.rmSync(tempInstallPath, { recursive: true, force: true });
        }
        log('INFO', 'Successfully moved new server files to SERVER_DIRECTORY.');
        if (backupDir) {
            await copyExistingData(backupDir, SERVER_DIRECTORY);
            log('INFO', `Copied existing data from backup to new server directory.`);
        }
        storeLatestVersion(latestVersion);
        log('INFO', `Successfully installed/updated to version ${latestVersion}`);
        await changeOwnership(SERVER_DIRECTORY, config.minecraftUser, config.minecraftGroup);
        log('INFO', `Changed ownership to ${config.minecraftUser}:${config.minecraftGroup} (if applicable).`);
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
 */
function removeDir(dirPath) {
    log('DEBUG', `Using fs.rmSync for removeDir: ${dirPath}`);
    fs.rmSync(dirPath, { recursive: true, force: true });
}


export async function clearServerLogs() {
    if (!SERVER_DIRECTORY) {
        log('WARNING', 'SERVER_DIRECTORY not set. Cannot clear logs.');
        return false;
    }
    const serverLogPath = pathJoin(SERVER_DIRECTORY, 'server.log');
    try {
        if (fs.existsSync(serverLogPath)) {
            await fs.promises.writeFile(serverLogPath, '', 'utf8');
            log('INFO', `Server log file cleared: ${serverLogPath}`);
            return true;
        } else {
            log('INFO', `Server log file does not exist: ${serverLogPath}`);
            return true;
        }
    } catch (error) {
        log('ERROR', `Error clearing server logs: ${error.message}`);
        return false;
    }
}

export async function readServerProperties() {
    const configPath = pathJoin(SERVER_DIRECTORY, 'server.properties');
    if (!SERVER_DIRECTORY || !fs.existsSync(configPath)) { // Check SERVER_DIRECTORY is defined
        log('WARNING', `server.properties not found at ${configPath} (or server directory not set). Returning empty config.`);
        return {};
    }
    const data = await fs.promises.readFile(configPath, 'utf8');
    const properties = {};
    data.split(/\r?\n/).forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const separatorIndex = trimmedLine.indexOf('=');
            if (separatorIndex !== -1) {
                const key = trimmedLine.substring(0, separatorIndex).trim();
                const value = trimmedLine.substring(separatorIndex + 1).trim();
                if (key) { properties[key] = value; }
            }
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

export async function deleteWorld(worldName) {
    if (!SERVER_DIRECTORY) {
        log('ERROR', 'SERVER_DIRECTORY not set. Cannot delete world.');
        return { success: false, message: 'Server directory not configured.' };
    }
    if (!isValidWorldName(worldName)) {
        log('ERROR', `Invalid worldName format for deletion: ${worldName}`);
        return { success: false, message: 'Invalid world name format.' };
    }

    try {
        const properties = await readServerProperties();
        if (properties['level-name'] === worldName) {
            log('WARNING', `Attempted to delete active world: ${worldName}`);
            return { success: false, message: 'Cannot delete the currently active world.' };
        }

        const worldsPath = pathJoin(SERVER_DIRECTORY, 'worlds');
        const targetWorldPath = pathJoin(worldsPath, worldName);

        if (!fs.existsSync(targetWorldPath)) {
            log('WARNING', `World directory '${worldName}' not found at ${targetWorldPath}.`);
            return { success: false, message: 'World not found.' };
        }

        await fs.promises.rm(targetWorldPath, { recursive: true, force: true });
        log('INFO', `Deleted world: ${worldName}`);
        return { success: true, message: `World '${worldName}' deleted successfully.` };
    } catch (error) {
        log('ERROR', `Failed to delete world '${worldName}': ${error.message}`);
        return { success: false, message: `Failed to delete world: ${error.message}` };
    }
}

export async function activateWorld(worldName) {
    if (!SERVER_DIRECTORY) {
        log('ERROR', 'SERVER_DIRECTORY not set. Cannot activate world.');
        return false;
    }
    if (!isValidWorldName(worldName)) {
        log('ERROR', `Invalid worldName format: ${worldName}`);
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
        recoverPID();
    }

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
            const pidFile = pathJoin(SERVER_DIRECTORY, 'server.pid');
            if (fs.existsSync(pidFile)) {
                try {
                    fs.unlinkSync(pidFile);
                    log('INFO', `Removed stale PID file: ${pidFile}`);
                } catch (unlinkError) {
                    log('ERROR', `Failed to remove stale PID file: ${unlinkError.message}`);
                }
            }
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
        autoStart: true, autoUpdateEnabled: false, autoUpdateIntervalMinutes: 60, logLevel: "INFO",
        minecraftUser: "minecraft", minecraftGroup: "minecraft", serverType: "bedrock"
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
            case '--uiPort': if(valueConsumed) effectiveConfig.uiPort = parseInt(value, 10); break;
            case '--autoStart': effectiveConfig.autoStart = (valueConsumed ? (value === 'true') : true); break;
            case '--autoUpdateEnabled': effectiveConfig.autoUpdateEnabled = (valueConsumed ? (value === 'true') : true); break;
            case '--logLevel': if(valueConsumed) effectiveConfig.logLevel = value.toUpperCase(); break;
            case '--serverType': if(valueConsumed) effectiveConfig.serverType = value; break;
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
    if (!isValidWorldName(worldName)) {
        return { success: false, message: 'Invalid world name format.' };
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

            // Pre-calculate all pack roots in this .mcaddon
            const allPackRoots = manifestEntries.map(entry => {
                let root = path.dirname(entry.entryName);
                return root === '.' ? '' : root;
            });

            for (const manifestEntry of manifestEntries) {
                let packRootInZip = path.dirname(manifestEntry.entryName);
                if (packRootInZip === '.') packRootInZip = '';
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
                    fs.rmSync(finalPackPath, { recursive: true, force: true });
                }
                fs.mkdirSync(finalPackPath, { recursive: true });

                zipEntries.forEach(zipEntry => {
                    if (zipEntry.isDirectory) return;

                    let isEntryInPack = false;
                    let relativePathInPack = '';

                    if (packRootInZip === '') {
                        // If this pack is at the root, it owns all files EXCEPT those that belong to other packs
                        // (which are in subdirectories identified as pack roots).
                        const entryName = zipEntry.entryName;
                        const belongsToOtherPack = allPackRoots.some(otherRoot => {
                            if (otherRoot === '') return false; // Don't compare with self
                            return entryName.startsWith(otherRoot + '/');
                        });

                        if (!belongsToOtherPack) {
                            isEntryInPack = true;
                            relativePathInPack = entryName;
                        }
                    } else {
                        // If this pack is in a subdirectory, it owns everything under that prefix
                        const prefix = packRootInZip + '/';
                        if (zipEntry.entryName.startsWith(prefix)) {
                            isEntryInPack = true;
                            relativePathInPack = path.relative(packRootInZip, zipEntry.entryName);
                        }
                    }

                    if (isEntryInPack && relativePathInPack) {
                        const targetFilePath = path.join(finalPackPath, relativePathInPack);

                        // Security: Check for Zip Slip vulnerability
                        const resolvedTargetFilePath = path.resolve(targetFilePath);
                        const resolvedFinalPackPath = path.resolve(finalPackPath) + path.sep;
                        if (!resolvedTargetFilePath.startsWith(resolvedFinalPackPath)) {
                            log('WARNING', `Zip Slip attempt detected in .mcaddon: ${zipEntry.entryName}`);
                            return; // Skip this entry
                        }

                        const targetFileDir = path.dirname(targetFilePath);
                        if (!fs.existsSync(targetFileDir)) {
                            fs.mkdirSync(targetFileDir, { recursive: true });
                        }
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
                    fs.rmSync(finalPackPath, { recursive: true, force: true }); // Clean up extracted pack
                }
            }
            if (packsProcessedCount === 0 && !overallSuccess) {
                 return { success: false, message: "Failed to process any valid packs from the .mcaddon. " + messages.join(" ") };
            }
            return { success: overallSuccess, message: `.mcaddon processing complete. ${packsProcessedCount} pack(s) processed. Details: ${messages.join(" ")} Restart server if needed.` };

        } else { // Handle as .mcpack
            log('INFO', `Processing .mcpack file: ${originalFilename} with requested type: ${requestedPackType || 'Auto-detect'}`);

            const manifestEntry = zipEntries.find(entry => entry.entryName.endsWith('manifest.json') && !entry.isDirectory);
            if (!manifestEntry) {
                return { success: false, message: 'manifest.json not found in the uploaded .mcpack.' };
            }
            let packRootInZip = path.dirname(manifestEntry.entryName);
            if (packRootInZip === '.') packRootInZip = '';
            let manifestData;
            try {
                manifestData = JSON.parse(zip.readAsText(manifestEntry));
            } catch (e) {
                return { success: false, message: `Failed to parse manifest.json in the uploaded .mcpack: ${e.message}` };
            }

            if (!manifestData.header || !manifestData.header.uuid || !manifestData.header.version || !manifestData.header.name) {
                return { success: false, message: 'Invalid manifest.json: missing header, uuid, version, or name.' };
            }

            let packType = requestedPackType;
            if (!packType) {
                // Auto-detect pack type
                const moduleType = manifestData.modules && manifestData.modules[0] ? manifestData.modules[0].type : null;
                if (moduleType === 'data') {
                    packType = 'behavior';
                } else if (moduleType === 'resources') {
                    packType = 'resource';
                } else {
                    return { success: false, message: 'Could not auto-detect pack type from manifest. Please specify manually.' };
                }
                log('INFO', `Auto-detected pack type: ${packType}`);
            }

            let targetPackDirName;
            let worldPackJsonFile;

            switch (packType) {
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
            const packId = manifestData.header.uuid;
            const packVersion = manifestData.header.version;
            const packName = manifestData.header.name;

            let packDirNameInFilesystem = packName.replace(/[^a-zA-Z0-9_-]/g, '_') || packId;
            const finalPackPath = path.join(finalPackDirPathBase, packDirNameInFilesystem);

            if (fs.existsSync(finalPackPath)) {
                log('INFO', `Removing existing directory for pack '${packName}': ${finalPackPath}`);
                fs.rmSync(finalPackPath, { recursive: true, force: true });
            }
            fs.mkdirSync(finalPackPath, { recursive: true });

            zipEntries.forEach(zipEntry => {
                if (zipEntry.isDirectory) return;

                let isEntryInPack = false;
                let relativePathInPack = '';

                if (packRootInZip === '') {
                    isEntryInPack = true;
                    relativePathInPack = zipEntry.entryName;
                } else {
                    const prefix = packRootInZip + '/';
                    if (zipEntry.entryName.startsWith(prefix)) {
                        isEntryInPack = true;
                        relativePathInPack = path.relative(packRootInZip, zipEntry.entryName);
                    }
                }

                if (isEntryInPack && relativePathInPack) {
                    const targetFilePath = path.join(finalPackPath, relativePathInPack);

                    // Security: Check for Zip Slip vulnerability
                    const resolvedTargetFilePath = path.resolve(targetFilePath);
                    const resolvedFinalPackPath = path.resolve(finalPackPath) + path.sep;
                    if (!resolvedTargetFilePath.startsWith(resolvedFinalPackPath)) {
                        log('WARNING', `Zip Slip attempt detected in .mcpack: ${zipEntry.entryName}`);
                        return; // Skip this entry
                    }

                    const targetFileDir = path.dirname(targetFilePath);
                    if (!fs.existsSync(targetFileDir)) {
                        fs.mkdirSync(targetFileDir, { recursive: true });
                    }
                    fs.writeFileSync(targetFilePath, zipEntry.getData());
                }
            });
            log('INFO', `Extracted .mcpack '${packName}' to ${finalPackPath}`);

            const updateSuccess = await updateWorldPackJson(worldPath, worldPackJsonFile, packId, packVersion);
            if (!updateSuccess) {
                fs.rmSync(finalPackPath, { recursive: true, force: true });
                return { success: false, message: `Failed to update ${worldPackJsonFile} for .mcpack '${packName}'.` };
            }
            return { success: true, message: `Pack '${packName}' uploaded and applied to ${worldName}. Restart server if needed.` };
        }

    } catch (error) {
        log('ERROR', `Error processing pack upload for ${originalFilename}: ${error.message} ${error.stack}`);
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
