import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dgram and child_process at the top level
const mockCreateSocket = jest.fn();
jest.unstable_mockModule('dgram', () => ({
  default: { createSocket: mockCreateSocket },
  createSocket: mockCreateSocket,
}));

const mockSpawn = jest.fn().mockReturnValue({
  pid: 12345,
  stdin: { write: jest.fn() },
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn((event, cb) => {
    if (event === 'exit') {
      // Don't exit prematurely
    }
  }),
  unref: jest.fn(),
});

jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Active World Rename Server Lifecycle Control', () => {
    let tempDir;
    let serverDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-lifecycle-test-'));
        serverDir = path.join(tempDir, 'server');
        fs.mkdirSync(serverDir);
        fs.mkdirSync(path.join(serverDir, 'worlds', 'active_world'), { recursive: true });
        fs.mkdirSync(path.join(serverDir, 'worlds', 'other_world'), { recursive: true });

        // Setup server.properties with active_world
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'level-name=active_world\n');

        // Create dummy server executable
        const dummyExePath = path.join(serverDir, backend.getServerExeName());
        fs.writeFileSync(dummyExePath, 'dummy content');

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: path.join(tempDir, 'temp'),
            backupDirectory: path.join(tempDir, 'backup'),
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should stop and restart the server when renaming the active world while server is running', async () => {
        // Mock that the server is running by writing server.pid and mocking process.kill
        fs.writeFileSync(path.join(serverDir, 'server.pid'), '12345');

        let serverRunning = true;
        const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
            if (pid === 12345) {
                if (signal === 0) {
                    if (serverRunning) return true;
                    const err = new Error('Process not found');
                    err.code = 'ESRCH';
                    throw err;
                }
                if (signal === 'SIGTERM') {
                    serverRunning = false;
                    return true;
                }
            }
            return true;
        });

        // Mock UDP port check to always return available
        const mockSocket = {
            once: jest.fn((event, cb) => {
                if (event === 'listening') cb();
            }),
            bind: jest.fn(),
            close: jest.fn((cb) => { if (cb) cb(); })
        };
        mockCreateSocket.mockReturnValue(mockSocket);

        // Rename the active world
        const result = await backend.renameWorld('active_world', 'renamed_active_world');

        expect(result.success).toBe(true);
        expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
        expect(mockSpawn).toHaveBeenCalled(); // startServer was called to restart the server

        // Verify world directory renamed
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'active_world'))).toBe(false);
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'renamed_active_world'))).toBe(true);

        // Verify server.properties updated
        const properties = fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8');
        expect(properties).toContain('level-name=renamed_active_world');
    }, 10000);

    it('should NOT stop or restart the server when renaming a non-active world while server is running', async () => {
        // Mock that the server is running
        fs.writeFileSync(path.join(serverDir, 'server.pid'), '12345');

        let serverRunning = true;
        const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
            if (pid === 12345 && signal === 0) {
                if (serverRunning) return true;
                const err = new Error('Process not found');
                err.code = 'ESRCH';
                throw err;
            }
            return true;
        });

        // Rename other_world (which is NOT active)
        const result = await backend.renameWorld('other_world', 'renamed_other_world');

        expect(result.success).toBe(true);
        expect(killSpy).not.toHaveBeenCalledWith(12345, 'SIGTERM'); // Should not stop the server

        // Verify directory renamed
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'other_world'))).toBe(false);
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'renamed_other_world'))).toBe(true);

        // Verify server.properties NOT updated
        const properties = fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8');
        expect(properties).toContain('level-name=active_world');
    });
});
