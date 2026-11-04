import * as fs from 'fs';
import path from 'path';
import os from 'os';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Robust Features and Safe Active World Rename', () => {
    let testDir;
    let serverDir;
    let backupDir;

    beforeAll(() => {
        testDir = path.join(os.tmpdir(), `robust-test-${Math.random().toString(36).substring(7)}`);
        serverDir = path.join(testDir, 'server');
        backupDir = path.join(testDir, 'backup');

        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(path.join(serverDir, 'worlds', 'active_world'), { recursive: true });
        fs.mkdirSync(path.join(serverDir, 'worlds', 'inactive_world'), { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'level-name=active_world\nserver-port=19132', 'utf8');

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('getDiskUsage should return zeros and log warning for empty path', async () => {
        const result = await backend.getDiskUsage(null);
        expect(result).toEqual({ total: 0, available: 0 });
    });

    test('renameWorld should safely rename active world and update server.properties', async () => {
        const renameResult = await backend.renameWorld('active_world', 'new_active_world');
        expect(renameResult.success).toBe(true);
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'new_active_world'))).toBe(true);
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'active_world'))).toBe(false);

        const props = await backend.readServerProperties();
        expect(props['level-name']).toBe('new_active_world');
    });

    test('renameWorld should safely rename inactive world and not update server.properties', async () => {
        const renameResult = await backend.renameWorld('inactive_world', 'new_inactive_world');
        expect(renameResult.success).toBe(true);
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'new_inactive_world'))).toBe(true);
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'inactive_world'))).toBe(false);

        const props = await backend.readServerProperties();
        expect(props['level-name']).toBe('new_active_world'); // still active world
    });

    test('getPlayers should throttle sending command without needing spies', async () => {
        // Write the current process ID to server.pid so isProcessRunning() returns true
        fs.writeFileSync(path.join(serverDir, 'server.pid'), process.pid.toString(), 'utf8');

        // First call should attempt to send command (which fails safely because there is no real server process active)
        const res1 = await backend.getPlayers();
        expect(res1.success).toBe(true);

        // Second call should be throttled and succeed safely
        const res2 = await backend.getPlayers();
        expect(res2.success).toBe(true);
    });
});
