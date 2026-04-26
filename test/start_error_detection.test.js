import { jest } from '@jest/globals';
import request from 'supertest';
import * as fs from 'fs';
import path from 'path';
import os from 'os';

describe('Server Start Error Detection', () => {
    let testDir;
    let serverDir;
    let app;

    beforeAll(async () => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-error-test-'));
        serverDir = path.join(testDir, 'server');
        fs.mkdirSync(serverDir);

        // Create a dummy "executable" that exits with an error
        const exePath = path.join(serverDir, os.platform() === 'win32' ? 'bedrock_server.exe' : 'bedrock_server');
        if (os.platform() === 'win32') {
            fs.writeFileSync(exePath, 'exit 1');
        } else {
            fs.writeFileSync(exePath, '#!/bin/sh\nexit 1');
            fs.chmodSync(exePath, 0o755);
        }

        process.argv = [
            'node', 'app.js',
            '--serverDirectory', serverDir,
            '--tempDirectory', path.join(testDir, 'temp'),
            '--backupDirectory', path.join(testDir, 'backup'),
            '--no-autoStart'
        ];

        const appModule = await import('../app.js');
        app = appModule.default;
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should report error when server fails to start immediately', async () => {
        // Increase timeout for this test as backend waits 5 seconds
        const res = await request(app).post('/api/start').timeout(10000);

        expect(res.statusCode).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/Server failed to start/);
    }, 15000);
});
