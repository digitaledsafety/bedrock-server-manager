import request from 'supertest';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import app from '../app.js';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Rename World Feature', () => {
    let testDir;
    let serverDir;
    let worldsDir;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-world-test-'));
        serverDir = path.join(testDir, 'server');
        worldsDir = path.join(serverDir, 'worlds');
        fs.mkdirSync(worldsDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: path.join(testDir, 'temp'),
            backupDirectory: path.join(testDir, 'backup'),
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('renameWorld backend function renames directory and updates server.properties', async () => {
        const oldName = 'OldWorld';
        const newName = 'NewWorld';
        const oldPath = path.join(worldsDir, oldName);
        const newPath = path.join(worldsDir, newName);
        const propertiesPath = path.join(serverDir, 'server.properties');

        fs.mkdirSync(oldPath);
        fs.writeFileSync(propertiesPath, `level-name=${oldName}\n`);

        const result = await backend.renameWorld(oldName, newName);

        expect(result.success).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(true);

        const updatedProperties = fs.readFileSync(propertiesPath, 'utf8');
        expect(updatedProperties).toContain(`level-name=${newName}`);
    });

    test('POST /api/rename-world renames a world', async () => {
        const oldName = 'OldWorldAPI';
        const newName = 'NewWorldAPI';
        const oldPath = path.join(worldsDir, oldName);
        const newPath = path.join(worldsDir, newName);

        fs.mkdirSync(oldPath);

        const response = await request(app)
            .post('/api/rename-world')
            .send({ oldWorldName: oldName, newWorldName: newName });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(true);
    });

    test('POST /api/rename-world returns 400 for invalid names', async () => {
        const response = await request(app)
            .post('/api/rename-world')
            .send({ oldWorldName: 'ValidName', newWorldName: 'Invalid/Name' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBeDefined();
    });

    test('renameWorld returns error if target name already exists', async () => {
        const oldName = 'OldWorldExist';
        const newName = 'ExistingWorld';
        fs.mkdirSync(path.join(worldsDir, oldName));
        fs.mkdirSync(path.join(worldsDir, newName));

        const result = await backend.renameWorld(oldName, newName);
        expect(result.success).toBe(false);
        expect(result.message).toContain('already exists');
    });
});
