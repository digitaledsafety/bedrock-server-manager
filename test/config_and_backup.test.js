import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import app from '../app.js';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Configuration Caching and World Backup Tests', () => {
    let testDir;
    let serverDir;
    let backupDir;

    beforeAll(() => {
        testDir = path.join(os.tmpdir(), `config-backup-test-${Math.random().toString(36).substring(7)}`);
        serverDir = path.join(testDir, 'server');
        backupDir = path.join(testDir, 'backup');

        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(path.join(serverDir, 'worlds', 'test_world'), { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'level-name=test_world\nserver-port=19132', 'utf8');

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('getConfig should return the current configuration from memory', () => {
        const config = backend.getConfig();
        expect(config).toBeDefined();
        expect(config.serverDirectory).toBe(serverDir);
    });

    test('backupWorld should create a backup of a specific world', async () => {
        const resultDir = await backend.backupWorld('test_world');
        expect(resultDir).toBeDefined();
        expect(fs.existsSync(resultDir)).toBe(true);
        expect(fs.existsSync(path.join(resultDir, 'test_world'))).toBe(true);
    });

    test('POST /api/backup-world should trigger world backup', async () => {
        const response = await request(app)
            .post('/api/backup-world')
            .send({ worldName: 'test_world' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('Backup for world \'test_world\' created');
    });

    test('POST /api/properties should validate numeric ranges', async () => {
        const response = await request(app)
            .post('/api/properties')
            .send({ 'server-port': 70000 }); // Out of range (max 65535)

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Validation failed');
        expect(response.body.details).toContain("Property 'IPv4 Port' must be no more than 65535.");
    });

    test('POST /api/properties should validate select options', async () => {
        const response = await request(app)
            .post('/api/properties')
            .send({ 'gamemode': 'invalid_mode' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Validation failed');
        expect(response.body.details).toContain("Property 'Default Game Mode' must be one of: survival, creative, adventure.");
    });

    test('POST /api/properties should accept valid values', async () => {
        const response = await request(app)
            .post('/api/properties')
            .send({ 'server-port': 19133, 'gamemode': 'creative' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const properties = await backend.readServerProperties();
        expect(properties['server-port']).toBe('19133');
        expect(properties['gamemode']).toBe('creative');
    });
});
