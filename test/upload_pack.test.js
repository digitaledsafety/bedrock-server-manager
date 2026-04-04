import { jest } from '@jest/globals';
import path from 'path';

// Mock fs and AdmZip
jest.unstable_mockModule('fs', () => ({
    promises: {
        mkdir: jest.fn(),
        writeFile: jest.fn(),
        rm: jest.fn(),
        readFile: jest.fn(),
    },
    existsSync: jest.fn(),
    createWriteStream: jest.fn().mockReturnValue({ write: jest.fn(), on: jest.fn() }),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

jest.unstable_mockModule('adm-zip', () => {
    return {
        default: jest.fn().mockImplementation(() => ({
            getEntries: jest.fn(),
            readAsText: jest.fn(),
        }))
    };
});

const fsMock = await import('fs');
const fsPromises = fsMock.promises;
const AdmZip = (await import('adm-zip')).default;
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('uploadPack', () => {
    const serverDir = '/server';
    const worldName = 'testWorld';

    beforeEach(() => {
        jest.clearAllMocks();
        backend.init({ serverDirectory: serverDir });
        fsMock.existsSync.mockReturnValue(true);
    });

    it('should process a valid .mcpack (behavior)', async () => {
        const tempFile = '/tmp/test.mcpack';
        const originalName = 'test.mcpack';

        const mockManifest = {
            header: { uuid: 'uuid1', version: [1, 0, 0], name: 'Test Pack' },
            modules: [{ type: 'data' }]
        };

        const mockZipEntries = [
            { entryName: 'manifest.json', isDirectory: false, getData: () => Buffer.from(JSON.stringify(mockManifest)) },
            { entryName: 'test.txt', isDirectory: false, getData: () => Buffer.from('content') }
        ];

        // Access the mocked AdmZip constructor to set up instances
        const zipInstance = {
            getEntries: jest.fn().mockReturnValue(mockZipEntries),
            readAsText: jest.fn().mockReturnValue(JSON.stringify(mockManifest)),
        };
        AdmZip.mockImplementation(() => zipInstance);

        // Mock world pack JSON handling
        fsPromises.readFile.mockResolvedValue('[]');

        const result = await backend.uploadPack(tempFile, originalName, null, worldName);

        expect(result.success).toBe(true);
        expect(fsPromises.mkdir).toHaveBeenCalledWith(expect.stringContaining('behavior_packs'), expect.any(Object));
        expect(fsPromises.writeFile).toHaveBeenCalledWith(expect.stringContaining('world_behavior_packs.json'), expect.any(String), 'utf8');
    });

    it('should prevent Zip Slip', async () => {
        const tempFile = '/tmp/slip.mcpack';
        const originalName = 'slip.mcpack';

        const mockManifest = {
            header: { uuid: 'uuid1', version: [1, 0, 0], name: 'Slip' },
            modules: [{ type: 'data' }]
        };

        const mockZipEntries = [
            { entryName: 'manifest.json', isDirectory: false, getData: () => Buffer.from(JSON.stringify(mockManifest)) },
            { entryName: '../evil.txt', isDirectory: false, getData: () => Buffer.from('evil') }
        ];

        const zipInstance = {
            getEntries: jest.fn().mockReturnValue(mockZipEntries),
            readAsText: jest.fn().mockReturnValue(JSON.stringify(mockManifest)),
        };
        AdmZip.mockImplementation(() => zipInstance);

        fsPromises.readFile.mockResolvedValue('[]');

        const result = await backend.uploadPack(tempFile, originalName, null, worldName);

        expect(result.success).toBe(true); // Still success because manifest was valid
        // Check that evil.txt was NOT written outside the pack dir
        const writeCalls = fsPromises.writeFile.mock.calls;
        const evilWrite = writeCalls.find(call => call[0].includes('evil.txt'));
        expect(evilWrite).toBeUndefined();
    });
});
