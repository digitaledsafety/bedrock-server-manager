import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import os from 'os';
import http from 'http';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'temp_integration_test');
const SERVER_DIR = path.join(TEMP_DIR, 'server');
const TEMP_DOWNLOAD_DIR = path.join(TEMP_DIR, 'temp_download');
const BACKUP_DIR = path.join(TEMP_DIR, 'backup');
const MOCK_SERVER_DIR = path.join(__dirname, 'mock_server');
const MOCK_EXECUTABLE_NAME = os.platform() === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
const MOCK_EXECUTABLE_PATH = path.join(MOCK_SERVER_DIR, MOCK_EXECUTABLE_NAME);
const MOCK_ZIP_PATH = path.join(MOCK_SERVER_DIR, 'mock-server.zip');

let mockHttpServer;
let mockServerUrl;

// We must mock the config before app is imported
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', async () => {
    const originalModule = await import('../minecraft_bedrock_installer_nodejs.js');
    return {
        ...originalModule,
        readGlobalConfig: jest.fn().mockResolvedValue({
            serverDirectory: SERVER_DIR,
            tempDirectory: TEMP_DOWNLOAD_DIR,
            backupDirectory: BACKUP_DIR,
            logLevel: "DEBUG",
            uiPort: 3003, // Use a unique port for this test run
        }),
        getLatestVersion: jest.fn().mockImplementation(async () => {
            return {
                latestVersion: '1.0.0-mock',
                downloadUrl: mockServerUrl,
            };
        }),
    };
});

const { default: app } = await import('../app.js');
let server;

// Helper function to poll status
const pollStatus = async (expectedStatus, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const res = await request(server).get('/api/status');
            if (res.body.status === expectedStatus) return;
        } catch (e) { /* ignore network errors */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Timeout waiting for status to become ${expectedStatus}`);
};

describe('Integration Tests - Server Lifecycle', () => {

    beforeAll(async () => {
        // 1. Clean up and create temp directories
        fs.rmSync(MOCK_SERVER_DIR, { recursive: true, force: true });
        fs.mkdirSync(MOCK_SERVER_DIR, { recursive: true });
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        fs.mkdirSync(TEMP_DIR, { recursive: true });

        // 2. Create mock server executable and zip
        fs.writeFileSync(MOCK_EXECUTABLE_PATH, '#!/bin/sh\necho "Mock server started"\nsleep 60');
        fs.chmodSync(MOCK_EXECUTABLE_PATH, '755');
        const zip = new AdmZip();
        zip.addLocalFile(MOCK_EXECUTABLE_PATH, '', MOCK_EXECUTABLE_NAME);
        zip.writeZip(MOCK_ZIP_PATH);

        // 3. Start local HTTP server for mock download
        mockHttpServer = await new Promise(resolve => {
            const s = http.createServer((req, res) => {
                fs.createReadStream(MOCK_ZIP_PATH).pipe(res);
            }).listen(() => resolve(s));
        });
        const { port } = mockHttpServer.address();
        mockServerUrl = `http://localhost:${port}/bedrock-server-1.0.0-mock.zip`;

        // 4. Start the actual application server
        server = app.listen(3003);
    });

    afterAll(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        if (mockHttpServer) await new Promise(resolve => mockHttpServer.close(resolve));
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        fs.rmSync(MOCK_SERVER_DIR, { recursive: true, force: true });
    });

    jest.setTimeout(30000);

    it('should download, start, and stop the server', async () => {
        // 1. Download the server
        const updateRes = await request(server).post('/api/update');
        expect(updateRes.statusCode).toBe(200);
        expect(updateRes.body.success).toBe(true);
        expect(fs.existsSync(path.join(SERVER_DIR, MOCK_EXECUTABLE_NAME))).toBe(true);

        // 2. Start the server
        const startRes = await request(server).post('/api/start');
        expect(startRes.statusCode).toBe(200);
        expect(startRes.body.success).toBe(true);

        // 3. Poll for running status
        await pollStatus('running');

        // 4. Stop the server
        const stopRes = await request(server).post('/api/stop');
        expect(stopRes.statusCode).toBe(200);
        expect(stopRes.body.success).toBe(true);

        // 5. Poll for stopped status
        await pollStatus('stopped');
    });
});
