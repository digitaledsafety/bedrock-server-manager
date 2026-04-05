import { jest } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Zip Slip Protection', () => {
  let tempDir;
  let serverDir;
  let worldName = 'test_world';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-slip-test-'));
    serverDir = path.join(tempDir, 'server');
    fs.mkdirSync(serverDir);
    fs.mkdirSync(path.join(serverDir, 'worlds', worldName), { recursive: true });

    backend.init({
      serverDirectory: serverDir,
      tempDirectory: path.join(tempDir, 'temp'),
      backupDirectory: path.join(tempDir, 'backup'),
      logLevel: 'DEBUG'
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should prevent extraction of files outside the target directory (Zip Slip)', async () => {
    const zip = new AdmZip();
    const manifest = {
      header: {
        uuid: 'test-uuid',
        version: [1, 0, 0],
        name: 'Test Pack'
      },
      modules: [{ type: 'data', uuid: 'module-uuid', version: [1, 0, 0] }]
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    // Attempt to write a file outside the target directory using relative path
    zip.addFile('../../../zip-slip-malicious.txt', Buffer.from('malicious content'));

    const zipPath = path.join(tempDir, 'malicious.mcpack');
    zip.writeZip(zipPath);

    const result = await backend.uploadPack(zipPath, 'malicious.mcpack', 'behavior', worldName);

    expect(result.success).toBe(true); // uploadPack itself might succeed but skip the malicious file

    const maliciousFilePath = path.resolve(serverDir, 'behavior_packs', 'Test_Pack', '..', '..', '..', 'zip-slip-malicious.txt');
    expect(fs.existsSync(maliciousFilePath)).toBe(false);

    // Verify that manifest.json was extracted correctly
    const manifestPath = path.join(serverDir, 'behavior_packs', 'Test_Pack', 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('should prevent Zip Slip in .mcaddon files', async () => {
    const zip = new AdmZip();
    const manifest = {
      header: {
        uuid: 'addon-uuid',
        version: [1, 0, 0],
        name: 'Addon Pack'
      },
      modules: [{ type: 'data', uuid: 'module-uuid', version: [1, 0, 0] }]
    };
    // Nested pack
    zip.addFile('pack1/manifest.json', Buffer.from(JSON.stringify(manifest)));
    zip.addFile('pack1/../../../zip-slip-addon.txt', Buffer.from('malicious addon content'));

    const zipPath = path.join(tempDir, 'malicious.mcaddon');
    zip.writeZip(zipPath);

    const result = await backend.uploadPack(zipPath, 'malicious.mcaddon', undefined, worldName);

    expect(result.success).toBe(true);

    const maliciousFilePath = path.resolve(serverDir, 'behavior_packs', 'Addon_Pack', '..', '..', '..', 'zip-slip-addon.txt');
    expect(fs.existsSync(maliciousFilePath)).toBe(false);
  });
});
