const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process'); // Ensure 'exec' is imported
const { URL } = require('url');
const util = require('util'); // Ensure 'util' is imported
const execPromise = util.promisify(exec);
const os = require('os'); // Ensure 'os' is imported

// Configuration
const MC_BEDROCK_URL = 'https://www.minecraft.net/en-us/download/server/bedrock';
const VERSION_REGEX = /bedrock-server-([\d\.]+)\.zip/;
let SERVER_DIRECTORY; // Installation directory (where the active server files reside)
let TEMP_DIRECTORY;  // Temporary directory for new versions downloads and extractions
let BACKUP_DIRECTORY;    // Backup directory for old server installations
const MC_USER = 'minecraft'; // User to own the server files (Linux only)
const MC_GROUP = 'minecraft'; // Group to own the server files (Linux only)
const LAST_VERSION_FILE = 'last_version.txt'; // File to store the last known version
const WEBHOOK_URL = process.env.MC_UPDATE_WEBHOOK; // Optional webhook URL
const SERVER_EXE_NAME = os.platform() === 'win32' ? 'bedrock_server.exe' : 'bedrock_server'; // Correct executable name for current OS
const CONFIG_FILES = ['server.properties']; // List of config files to copy from old to new installation
const WORLD_DIRECTORIES = ['worlds']; // List of world directories to copy from old to new installation

// Logging setup
const logStream = fs.createWriteStream('mc_installer.log', { flags: 'a' });
function log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level}] ${message}\n`;
    console.log(logMessage);
    logStream.write(logMessage);
}

/**
 * Initializes the path variables based on the operating system and creates necessary directories.
 */
function init() {
    const platform = os.platform();
    log('INFO', `Detected platform: ${platform}`);

    if (platform === 'win32') {
        // For Windows, paths are typically C:\MinecraftBedrockServer\server, etc.
        const baseDir = path.join('C:', 'MinecraftBedrockServer');
        SERVER_DIRECTORY = path.join(baseDir, 'server');
        TEMP_DIRECTORY = path.join(baseDir, 'tmp');
        BACKUP_DIRECTORY = path.join(baseDir, 'backup');
    } else {
        // For Linux, paths are typically /opt/bedrock/server, etc.
        const baseDir = '/opt/bedrock';
        SERVER_DIRECTORY = path.join(baseDir, 'server');
        TEMP_DIRECTORY = path.join(baseDir, 'tmp');
        BACKUP_DIRECTORY = path.join(baseDir, 'backup');
    }

    // Create directories if they don't exist
    [SERVER_DIRECTORY, TEMP_DIRECTORY, BACKUP_DIRECTORY].forEach(dir => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                log('INFO', `Created directory: ${dir}`);
            } catch (e) {
                log('ERROR', `Failed to create directory ${dir}: ${e.message}. Installation will likely fail.`);
            }
        }
    });
}

// Initialize paths and directories when the module is loaded
init();

/**
 * Gets the latest Minecraft Bedrock server version from the download page.
 * @returns {Promise<string|null>} A promise that resolves with the latest version string, or null if not found.
 */
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
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const htmlContent = data;
                    const linkRegex = /<a\s+[^>]*?href="([^"]*?bedrock-server[^"]*?)"[^>]*?>/i;
                    const linkMatch = htmlContent.match(linkRegex);

                    if (linkMatch && linkMatch[1]) {
                        const downloadUrl = linkMatch[1];
                        log('INFO', `Download URL found: ${downloadUrl}`);

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

/**
 * Downloads a file from a given URL to a specified path.
 * @param {string} downloadUrl - The URL of the file to download.
 * @param {string} downloadPath - The full path where the file should be saved.
 * @returns {Promise<void>} A promise that resolves when the download is complete.
 */
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
            file.on('finish', () => {
                file.close(() => {
                    resolve();
                });
            });
            file.on('error', (err) => {
                fs.unlink(downloadPath, () => { // Delete the file if error occurs
                    reject(new Error(`Error writing to file: ${err.message}`));
                });
            });
            response.on('error', (err) => {
                fs.unlink(downloadPath, () => {
                    reject(new Error(`Error during download: ${err.message}`));
                });
            });
        });
    });
}

/**
 * Extracts a zip file to a specified directory.
 * @param {string} zipPath - The path to the zip file.
 * @param {string} extractPath - The directory where the contents should be extracted.
 * @returns {Promise<void>} A promise that resolves when extraction is complete.
 */
function extractFiles(zipPath, extractPath) {
    return new Promise((resolve, reject) => {
        const platform = os.platform();
        let command = '';
        if (platform === 'win32') {
            const psPath = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            // Use Expand-Archive cmdlet for extraction on Windows
            command = `${psPath} -Command "& {&'Expand-Archive' -Path '${zipPath}' -DestinationPath '${extractPath}' -Force}"`;
            log('INFO', `Using PowerShell for extraction: ${command}`);
        } else {
            // Use unzip command for extraction on Linux
            command = `unzip -o "${zipPath}" -d "${extractPath}"`; // -o for overwrite
        }
        exec(command, (error, stdout, stderr) => {
            log('INFO', `Extracting... ${stdout}`);
            if (error) {
                reject(new Error(`Extraction failed: ${error.message} ${stderr}`));
                return;
            }
            resolve();
        });
    });
}

/**
 * Recursively changes ownership of files and directories (Linux only).
 * @param {string} dirPath - The path to the directory.
 * @param {string} user - The user to set as owner.
 * @param {string} group - The group to set as owner.
 * @returns {Promise<void>} A promise that resolves when ownership is changed.
 */
async function changeOwnership(dirPath, user, group) {
    if (os.platform() === 'win32') {
        log('INFO', `Skipping changeOwnership on Windows.`);
        return; // Do nothing on Windows
    }
    try {
        await execPromise(`chown -R ${user}:${group} "${dirPath}"`);
        log('INFO', `Changed ownership of ${dirPath} to ${user}:${group}`);
    } catch (error) {
        throw new Error(`Failed to chown ${dirPath}: ${error.message}`);
    }
}

/**
 * Stores the latest Minecraft Bedrock server version in a file.
 * @param {string} version - The version string to store.
 */
function storeLatestVersion(version) {
    try {
        fs.writeFileSync(LAST_VERSION_FILE, version);
        log('INFO', `Stored latest version: ${version}`);
    } catch (error) {
        log('ERROR', `Error storing version to file: ${error.message}`);
    }
}

/**
 * Retrieves the last stored Minecraft Bedrock server version from a file.
 * @returns {string|null} The stored version string, or null if not found.
 */
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

/**
 * Backs up the current server data to a timestamped directory.
 * @returns {Promise<string>} A promise that resolves with the path to the backup directory.
 */
async function backupServer() {
    // Check if SERVER_DIRECTORY exists before attempting backup
    if (!fs.existsSync(SERVER_DIRECTORY)) {
        log('INFO', `No existing server directory found at ${SERVER_DIRECTORY}. Skipping backup.`);
        return null; // Return null if nothing to backup
    }

    const backupDir = path.join(BACKUP_DIRECTORY, new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_'));
    fs.mkdirSync(backupDir, { recursive: true });
    log('INFO', `Creating backup in ${backupDir}`);

    try {
        await copyDir(SERVER_DIRECTORY, backupDir);
        if (os.platform() !== 'win32') {
            await changeOwnership(backupDir, MC_USER, MC_GROUP);  // Ensure correct ownership of backup
        }
        log('INFO', `Backup complete in ${backupDir}`);
        return backupDir; // Return the backup directory path
    } catch (error) {
        log('ERROR', `Error during backup: ${error}`);
        // Clean up backup dir on error, but only if it was created during this attempt
        if (fs.existsSync(backupDir)) {
            await removeDir(backupDir); // Use removeDir for cleanup
        }
        throw error; // Re-throw the error to be handled in checkAndInstall
    }
}

/**
 * Copies a directory recursively.
 * @param {string} src - The source directory.
 * @param {string} dest - The destination directory.
 * @returns {Promise<void>} A promise that resolves when copying is complete.
 */
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

/**
 * Stops the Minecraft server process.
 * @returns {Promise<void>} A promise that resolves when the server is stopped.
 */
async function stopServer() {
    try {
        log('INFO', `Attempting to stop Minecraft server process.`);
        const platform = os.platform();
        let command = '';
        if (platform === 'win32') {
            // Use taskkill to forcefully stop the process by the executable name
            command = `taskkill /F /IM ${SERVER_EXE_NAME}`;
        } else {
            // Use pkill to stop the process by the executable name
            command = `pkill -f ${SERVER_EXE_NAME}`;
        }
        const { stdout, stderr } = await execPromise(command);
        if (stderr) {
            log('ERROR', `Error stopping server: ${stderr}`);
        }
        log('INFO', 'Minecraft server stop command executed.');
    } catch (error) {
        log('ERROR', `Error stopping server (process might not be running): ${error.message}`);
        // Don't throw error, we want to continue with update even if stop fails (e.g., server not running)
    }
}

/**
 * Starts the Minecraft server process.
 * @returns {Promise<void>} A promise that resolves when the server is started.
 */
async function startServer() {
    try {
        const serverExePath = path.join(SERVER_DIRECTORY, SERVER_EXE_NAME);
        if (!fs.existsSync(serverExePath)) {
            log('WARNING', `Server executable not found at ${serverExePath}. Cannot start server.`);
            // Do not throw, allow the script to continue if this is the first run and files are not yet extracted.
            return;
        }

        log('INFO', `Starting Minecraft server from ${serverExePath}`);
        // Spawn the server process in the background, inheriting stdio
        const serverProcess = spawn(serverExePath, [], {
            cwd: SERVER_DIRECTORY,
            stdio: 'inherit', // Important: Attach to process IO for server console output
            detached: true // Detach the child process from the parent, allowing the script to exit
        });

        // Unreference the child process to allow the parent to exit independently
        serverProcess.unref();

        serverProcess.on('error', (err) => {
            log('ERROR', `Server process error: ${err.message}`);
        });

        serverProcess.on('exit', (code, signal) => {
            log('INFO', `Server process exited with code ${code} and signal ${signal}`);
        });
        log('INFO', 'Minecraft server start command executed.');
    } catch (error) {
        log('ERROR', `Error starting server: ${error.message}`);
        throw error; // Re-throw to be handled by the caller (Express app)
    }
}

/**
 * Main function to check for new Minecraft Bedrock server releases and install them.
 * This function will be called by the Express app or a scheduled task.
 */
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
    let downloadUrl = `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${latestVersion}.zip`; // Default to Linux
    if (platform === 'win32') {
        downloadUrl = `https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-${latestVersion}.zip`; // Use Windows URL
    }
    const tempInstallPath = path.join(TEMP_DIRECTORY, latestVersion); // Use version in temp path
    const downloadPath = path.join(tempInstallPath, `bedrock-server-${latestVersion}.zip`); //download to temp

    try {
        // Send webhook notification before stopping server
        if (WEBHOOK_URL) {
            try {
                await sendWebhookNotification(`New Minecraft Bedrock Server version ${latestVersion} is available! Server going down for update...`);
            } catch (error) {
                log('ERROR', `Failed to send webhook notification: ${error}`);
            }
        }

        // Stop the server
        await stopServer();

        // Backup the current installation (if it exists)
        const backupDir = await backupServer();
        if (backupDir) {
            log('INFO', `Server backed up to: ${backupDir}`);
        }

        // Check if the version already exists in the temporary directory
        if (fs.existsSync(tempInstallPath)) {
            log('INFO', `Version ${latestVersion} already exists in temporary directory: ${tempInstallPath}. Skipping download and extraction.`);
        } else {
            // Create the temp directory
            fs.mkdirSync(tempInstallPath, { recursive: true });
            log('INFO', `Created temporary installation directory: ${tempInstallPath}`);

            // Download and extract the new version into the temp directory
            log('INFO', `Downloading server files from ${downloadUrl} to ${downloadPath}`);
            await downloadFile(downloadUrl, downloadPath);
            log('INFO', 'Download complete.');

            log('INFO', `Extracting files to ${tempInstallPath}`);
            await extractFiles(downloadPath, tempInstallPath);
            fs.unlinkSync(downloadPath); // Clean up the zip file
            log('INFO', 'Extraction complete.');
        }

        // Remove old installation and move new one in its place
        if (fs.existsSync(SERVER_DIRECTORY)) {
            await removeDir(SERVER_DIRECTORY);
            log('INFO', `Removed existing server directory ${SERVER_DIRECTORY}`);
        }
        // Move the newly extracted files to the active server directory
        fs.renameSync(tempInstallPath, SERVER_DIRECTORY);
        log('INFO', `Moved new server files to ${SERVER_DIRECTORY}`);

        // Copy existing data (worlds, configs) from backup to the new installation
        if (backupDir) { // Only copy if a backup was actually made
            await copyExistingData(backupDir, SERVER_DIRECTORY);
            log('INFO', `Copied existing data from backup to new server directory.`);
        }


        storeLatestVersion(latestVersion);
        log('INFO', `Successfully installed/updated to version ${latestVersion}`);

        // Change ownership for Linux systems
        await changeOwnership(SERVER_DIRECTORY, MC_USER, MC_GROUP);
        log('INFO', `Changed ownership to ${MC_USER}:${MC_GROUP} (if applicable).`);


        // Send webhook notification after update
        if (WEBHOOK_URL) {
            try {
                await sendWebhookNotification(`Minecraft Bedrock Server updated to version ${latestVersion}! Server restarting...`);
            } catch (error) {
                log('ERROR', `Failed to send webhook notification: ${error}`);
            }
        }

        // Start the server
        await startServer();
        log('INFO', 'Update process complete. Server should be starting.');
        return { success: true, message: `Server updated to version ${latestVersion}.` };

    } catch (error) {
        log('ERROR', `Error during installation: ${error.message}`);
        // Attempt to start server even if update failed, to restore service
        try {
            await startServer();
            log('INFO', 'Attempted to restart server after failed update.');
        } catch (startErr) {
            log('ERROR', `Failed to restart server after update error: ${startErr.message}`);
        }
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
            exec(`rmdir /s /q "${dirPath}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Failed to remove directory ${dirPath}: ${error.message} ${stderr}`));
                } else {
                    resolve();
                }
            });
        } else {
            // Use Linux command to remove directory recursively and forcefully
            exec(`rm -rf "${dirPath}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Failed to remove directory ${dirPath}: ${error.message} ${stderr}`));
                } else {
                    resolve();
                }
            });
        }
    });
}

/**
 * Reads the server.properties file and returns its contents as an object.
 * @returns {Promise<Object>} A promise that resolves with the server properties as a key-value object.
 */
async function readServerProperties() {
    const configPath = path.join(SERVER_DIRECTORY, 'server.properties');
    if (!fs.existsSync(configPath)) {
        log('WARNING', `server.properties not found at ${configPath}. Returning empty config.`);
        return {};
    }
    const data = await fs.promises.readFile(configPath, 'utf8');
    const config = {};
    data.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, value] = trimmedLine.split('=').map(s => s.trim());
            if (key) {
                config[key] = value || '';
            }
        }
    });
    log('INFO', `Read server.properties from ${configPath}`);
    return config;
}

/**
 * Writes an object to the server.properties file.
 * @param {Object} config - The configuration object to write.
 * @returns {Promise<void>} A promise that resolves when the file is written.
 */
async function writeServerProperties(config) {
    const configPath = path.join(SERVER_DIRECTORY, 'server.properties');
    let content = '';
    for (const key in config) {
        if (Object.hasOwnProperty.call(config, key)) {
            content += `${key}=${config[key]}\n`;
        }
    }
    await fs.promises.writeFile(configPath, content, 'utf8');
    log('INFO', `Wrote server.properties to ${configPath}`);
}

/**
 * Lists all existing world directories within the SERVER_DIRECTORY.
 * @returns {Promise<string[]>} A promise that resolves with an array of world names.
 */
async function listWorlds() {
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

/**
 * Activates a specific world by updating server.properties.
 * @param {string} worldName - The name of the world to activate.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function activateWorld(worldName) {
    const worldsPath = path.join(SERVER_DIRECTORY, 'worlds');
    const targetWorldPath = path.join(worldsPath, worldName);

    if (!fs.existsSync(targetWorldPath)) {
        log('ERROR', `World directory '${worldName}' not found at ${targetWorldPath}. Cannot activate.`);
        return false;
    }

    try {
        const config = await readServerProperties();
        if (config['level-name'] === worldName) {
            log('INFO', `World '${worldName}' is already active.`);
            return true;
        }

        config['level-name'] = worldName;
        await writeServerProperties(config);
        log('INFO', `Activated world: ${worldName}. Restarting server for changes to take effect.`);
        await restartServer(); // Restart server to load new world
        return true;
    } catch (error) {
        log('ERROR', `Failed to activate world '${worldName}': ${error.message}`);
        return false;
    }
}

/**
 * Restarts the Minecraft server process.
 * This function is added for convenience for the frontend.
 * @returns {Promise<void>} A promise that resolves when the server is restarted.
 */
async function restartServer() {
    log('INFO', `Restarting Minecraft server.`);
    await stopServer();
    // Give a small delay to ensure the process has fully terminated
    await new Promise(resolve => setTimeout(resolve, 3000));
    await startServer();
    log('INFO', 'Minecraft server restart command executed.');
}

/**
 * Helper function to check if a process is running (cross-platform).
 * @param {string} processName - The name of the process executable (e.g., 'bedrock_server.exe' or 'bedrock_server').
 * @returns {Promise<boolean>} True if the process is running, false otherwise.
 */
async function isProcessRunning(processName) {
    const platform = os.platform();
    let command;
    if (platform === 'win32') {
        command = `tasklist /FI "IMAGENAME eq ${processName}"`;
    } else {
        command = `pgrep -x ${processName}`;
    }

    try {
        const { stdout } = await execPromise(command);
        console.log(stdout);
        
        if(stdout.includes("No tasks are running")) {
            return false;
        }

        return stdout.trim().length > 0;
    } catch (error) {
        // Command might fail if process is not found (e.g., pgrep returns non-zero exit code)
        return false;
    }
}


/**
 * Sends a webhook notification to a specified URL.
 * @param {string} message The message to send.
 * @returns {Promise<void>}
 */
async function sendWebhookNotification(message) {
    if (!WEBHOOK_URL) {
        log('INFO', 'Webhook URL is not configured. Skipping notification.');
        return;
    }

    const postData = JSON.stringify({
        content: message,
    });

    const url = new URL(WEBHOOK_URL);
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': postData.length,
        },
    };

    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                log('INFO', 'Webhook notification sent successfully.');
                resolve();
            } else {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
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


// Export functions for use by the Express.js frontend
module.exports = {
    init,
    log,
    getLatestVersion,
    downloadFile,
    extractFiles,
    changeOwnership,
    storeLatestVersion,
    getStoredVersion,
    backupServer,
    copyDir,
    stopServer,
    startServer,
    checkAndInstall,
    removeDir,
    readServerProperties,
    writeServerProperties,
    listWorlds,
    activateWorld,
    restartServer,
    isProcessRunning, // Export the new helper function
    SERVER_DIRECTORY, // Export for frontend to know where files are
    SERVER_EXE_NAME // Export SERVER_EXE_NAME
};
