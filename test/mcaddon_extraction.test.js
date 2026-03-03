import { jest } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock fs and other things for uploadPack
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue('[]'),
    writeFile: jest.fn().mockResolvedValue(),
    readdir: jest.fn(),
  },
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ write: jest.fn() })),
}));

const backend = await import('../minecraft_bedrock_installer_nodejs.js');
const fs_mock = await import('fs');

describe('MCAddon Extraction', () => {
  it('should process an addon with manifest at the root and extract files correctly', async () => {
    const testAddonPath = path.join(__dirname, 'test_addon.mcaddon');
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
        header: {
            uuid: 'test-uuid',
            version: [1, 0, 0],
            name: 'Test Pack'
        },
        modules: [{ type: 'data' }]
    })));
    zip.addFile('data.json', Buffer.from('TESTDATA'));
    zip.writeZip(testAddonPath);

    backend.init({ serverDirectory: '/mock/server' });

    const result = await backend.uploadPack(testAddonPath, 'test_addon.mcaddon', null, 'test_world');

    const writeCalls = fs_mock.writeFileSync.mock.calls;
    const dataJsonWrite = writeCalls.find(call => call[0].includes('data.json'));

    expect(dataJsonWrite).toBeDefined();
    expect(dataJsonWrite[1].toString()).toBe('TESTDATA');

    // Cleanup
    if (fs.existsSync(testAddonPath)) fs.unlinkSync(testAddonPath);
  });
});
