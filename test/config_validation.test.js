import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import app from '../app.js';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Global Configuration and Port Validation Tests', () => {
    let testDir;
    let originalConfig;

    beforeAll(async () => {
        testDir = path.join(os.tmpdir(), `config-validation-test-${Math.random().toString(36).substring(7)}`);
        fs.mkdirSync(testDir, { recursive: true });

        // Save original config if any to restore later
        originalConfig = await backend.readGlobalConfig();

        backend.init({
            serverDirectory: path.join(testDir, 'server'),
            tempDirectory: path.join(testDir, 'temp'),
            backupDirectory: path.join(testDir, 'backup'),
            logLevel: 'DEBUG'
        });
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe('POST /api/config port validations', () => {
        test('should reject invalid uiPort', async () => {
            const response = await request(app)
                .post('/api/config')
                .send({ uiPort: 70000 }); // Out of range

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('UI Port must be an integer between 1 and 65535');
        });

        test('should reject negative uiPort', async () => {
            const response = await request(app)
                .post('/api/config')
                .send({ uiPort: -1 });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('UI Port must be an integer between 1 and 65535');
        });

        test('should reject invalid serverPortIPv4', async () => {
            const response = await request(app)
                .post('/api/config')
                .send({ serverPortIPv4: 'abc' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('Server Port IPv4 must be an integer between 1 and 65535');
        });

        test('should reject invalid serverPortIPv6', async () => {
            const response = await request(app)
                .post('/api/config')
                .send({ serverPortIPv6: 0 }); // Port 0 is not allowed in this validation

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('Server Port IPv6 must be an integer between 1 and 65535');
        });

        test('should accept and store valid ports', async () => {
            const response = await request(app)
                .post('/api/config')
                .send({
                    uiPort: 3001,
                    serverPortIPv4: 19134,
                    serverPortIPv6: 19135
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            const updatedConfig = await backend.readGlobalConfig();
            expect(updatedConfig.uiPort).toBe(3001);
            expect(updatedConfig.serverPortIPv4).toBe(19134);
            expect(updatedConfig.serverPortIPv6).toBe(19135);
        });
    });

    describe('Graceful handling of non-string config paths', () => {
        test('readGlobalConfig and writeGlobalConfig should handle null/undefined/number paths', async () => {
            const configWithNonStrings = {
                serverDirectory: null,
                tempDirectory: 12345,
                backupDirectory: undefined
            };

            // Should write successfully without TypeError crashing
            await expect(backend.writeGlobalConfig(configWithNonStrings)).resolves.not.toThrow();

            // Should read successfully without TypeError crashing
            const readConfig = await backend.readGlobalConfig();
            expect(readConfig).toBeDefined();
            expect(typeof readConfig.serverDirectory).toBe('string');
            expect(typeof readConfig.tempDirectory).toBe('string');
            expect(typeof readConfig.backupDirectory).toBe('string');
        });
    });
});
