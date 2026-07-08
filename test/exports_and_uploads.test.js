import { jest } from '@jest/globals';
import * as path from 'path';

// Mocking fs and adm-zip
jest.unstable_mockModule('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        unlink: jest.fn(),
        rm: jest.fn(),
        readdir: jest.fn(),
    },
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    rmSync: jest.fn(),
    createWriteStream: jest.fn(() => ({
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        pipe: jest.fn()
    })),
    readdirSync: jest.fn(),
}));

// Mock adm-zip
const mockZipInstance = {
    addLocalFolder: jest.fn(),
    writeZip: jest.fn(),
    getEntries: jest.fn(),
    readAsText: jest.fn(),
    extractAllTo: jest.fn(),
};

jest.unstable_mockModule('adm-zip', () => ({
    default: jest.fn(() => mockZipInstance)
}));

// Dynamically import the modules
const fs = await import('fs');
const { default: AdmZip } = await import('adm-zip');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Exports and Uploads Tests', () => {
    const mockConfig = {
        serverDirectory: '/mock/server',
        tempDirectory: '/mock/temp',
        backupDirectory: '/mock/backup',
        logLevel: 'ERROR'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        backend.init(mockConfig);
    });

    describe('exportBackup', () => {
        it('should successfully export a backup', async () => {
            fs.existsSync.mockReturnValue(true);
            const backupName = 'test-backup';

            const result = await backend.exportBackup(backupName);

            expect(result.success).toBe(true);
            expect(result.zipPath).toContain('/mock/temp/backup-test-backup-');
            expect(mockZipInstance.addLocalFolder).toHaveBeenCalledWith(path.join('/mock/backup', backupName));
            expect(mockZipInstance.writeZip).toHaveBeenCalled();
        });

        it('should fail if backup does not exist', async () => {
            fs.existsSync.mockReturnValue(false);
            const result = await backend.exportBackup('non-existent');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Backup not found.');
        });
    });

    describe('exportWorld', () => {
        it('should successfully export a world', async () => {
            fs.existsSync.mockReturnValue(true);
            const worldName = 'test-world';

            const result = await backend.exportWorld(worldName);

            expect(result.success).toBe(true);
            expect(result.zipPath).toContain('/mock/temp/world-test-world-');
            expect(mockZipInstance.addLocalFolder).toHaveBeenCalledWith(path.join('/mock/server', 'worlds', worldName));
            expect(mockZipInstance.writeZip).toHaveBeenCalled();
        });

        it('should fail if world does not exist', async () => {
            fs.existsSync.mockImplementation((p) => {
                if (p.includes('worlds')) return false;
                return true;
            });
            const result = await backend.exportWorld('non-existent');

            expect(result.success).toBe(false);
            expect(result.message).toBe('World not found.');
        });
    });

    describe('uploadWorld', () => {
        it('should successfully upload a world', async () => {
            const tempFilePath = '/mock/temp/upload.mcworld';
            const originalFilename = 'MyWorld.mcworld';

            mockZipInstance.getEntries.mockReturnValue([
                { entryName: 'world/level.dat', isDirectory: false, getData: jest.fn().mockReturnValue(Buffer.from('level data')) },
                { entryName: 'world/levelname.txt', isDirectory: false, getData: jest.fn().mockReturnValue(Buffer.from('My Minecraft World')) }
            ]);
            mockZipInstance.readAsText.mockReturnValue('My Minecraft World');
            fs.existsSync.mockReturnValue(false); // For collision check

            const result = await backend.uploadWorld(tempFilePath, originalFilename);

            expect(result.success).toBe(true);
            expect(result.worldName).toBe('My Minecraft World');
            expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/mock/server', 'worlds', 'My Minecraft World'), { recursive: true });
        });

        it('should fail if level.dat is missing', async () => {
            mockZipInstance.getEntries.mockReturnValue([]);
            const result = await backend.uploadWorld('/path', 'file.mcworld');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid world file: level.dat not found.');
        });
    });
});
