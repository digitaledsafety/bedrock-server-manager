import { jest } from '@jest/globals';
import request from 'supertest';

// Mocking the backend for the app test
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
    isProcessRunning: jest.fn(),
    startServer: jest.fn(),
    stopServer: jest.fn(),
    restartServer: jest.fn(),
    checkAndInstall: jest.fn(),
    readServerProperties: jest.fn(),
    writeServerProperties: jest.fn(),
    listWorlds: jest.fn(),
    deleteWorld: jest.fn(),
    activateWorld: jest.fn(),
    readGlobalConfig: jest.fn(),
    writeGlobalConfig: jest.fn(),
    init: jest.fn(),
    startAutoUpdateScheduler: jest.fn(),
    getStoredVersion: jest.fn(),
    clearServerLogs: jest.fn(),
    createWorld: jest.fn(),
    backupServer: jest.fn(),
    sendServerCommand: jest.fn(),
    log: jest.fn(),
    isValidWorldName: jest.fn((name) => !/[./\\]/.test(name)),
}));

// Dynamically import the app after mocks are defined
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Enhancements API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/backup', () => {
        it('should trigger backup successfully', async () => {
            backend.backupServer.mockResolvedValue('/path/to/backup');

            const response = await request(app).post('/api/backup');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('/path/to/backup');
            expect(backend.backupServer).toHaveBeenCalled();
        });

        it('should return 500 if backup fails', async () => {
            backend.backupServer.mockResolvedValue(null);

            const response = await request(app).post('/api/backup');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
        });
    });

    describe('POST /api/command', () => {
        it('should send command successfully', async () => {
            backend.sendServerCommand.mockResolvedValue({ success: true, message: 'Command sent' });

            const response = await request(app)
                .post('/api/command')
                .send({ command: 'list' });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(backend.sendServerCommand).toHaveBeenCalledWith('list');
        });

        it('should return 400 if command is missing', async () => {
            const response = await request(app).post('/api/command').send({});

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('required');
        });

        it('should return 400 if backend fails to send command', async () => {
            backend.sendServerCommand.mockResolvedValue({ success: false, message: 'Not running' });

            const response = await request(app)
                .post('/api/command')
                .send({ command: 'list' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });
    });
});
