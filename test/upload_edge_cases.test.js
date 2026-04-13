import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

// Mocking backend dependencies that might hit the real FS in undesired ways
// However, since we want to test uploadPack logic, we should probably use a temporary directory

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('uploadPack Edge Cases', () => {
    let testDir;
    let serverDir;
    let worldDir;
    let tempUploadPath;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-edge-test-'));
        serverDir = path.join(testDir, 'server');
        worldDir = path.join(serverDir, 'worlds', 'test_world');
        fs.mkdirSync(worldDir, { recursive: true });

        // Initialize backend with test directories
        backend.init({
            serverDirectory: serverDir,
            tempDirectory: path.join(testDir, 'temp'),
            backupDirectory: path.join(testDir, 'backup'),
            logLevel: 'DEBUG'
        });

        tempUploadPath = path.join(testDir, 'upload.zip');
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should fail if manifest.json is missing', async () => {
        const zip = new AdmZip();
        zip.addFile('something.txt', Buffer.from('not a manifest'));
        zip.writeZip(tempUploadPath);

        const result = await backend.uploadPack(tempUploadPath, 'test.mcpack', 'behavior', 'test_world');
        expect(result.success).toBe(false);
        expect(result.message).toContain('manifest.json not found');
    });

    it('should fail if manifest.json is invalid JSON', async () => {
        const zip = new AdmZip();
        zip.addFile('manifest.json', Buffer.from('{ invalid json '));
        zip.writeZip(tempUploadPath);

        const result = await backend.uploadPack(tempUploadPath, 'test.mcpack', 'behavior', 'test_world');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to parse manifest.json');
    });

    it('should fail if manifest.json is missing required header fields', async () => {
        const zip = new AdmZip();
        zip.addFile('manifest.json', Buffer.from(JSON.stringify({ header: { name: 'test' } })));
        zip.writeZip(tempUploadPath);

        const result = await backend.uploadPack(tempUploadPath, 'test.mcpack', 'behavior', 'test_world');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid manifest.json');
    });

    it('should detect Zip Slip attempts in .mcpack', async () => {
        const zip = new AdmZip();
        const manifest = {
            format_version: 2,
            header: {
                name: 'Test Pack',
                uuid: 'test-uuid',
                version: [1, 0, 0],
                min_engine_version: [1, 16, 0]
            },
            modules: [{ type: 'data', uuid: 'module-uuid', version: [1, 0, 0] }]
        };
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
        zip.addFile('../../../evil.txt', Buffer.from('malicious'));
        zip.writeZip(tempUploadPath);

        const result = await backend.uploadPack(tempUploadPath, 'test.mcpack', 'behavior', 'test_world');

        // The current implementation skips Zip Slip entries but continues if other things are valid.
        // It should still succeed but not extract the malicious file.
        expect(result.success).toBe(true);

        const evilPath = path.resolve(serverDir, 'behavior_packs', 'Test_Pack', '../../../evil.txt');
        expect(fs.existsSync(evilPath)).toBe(false);
    });

    it('should fail if world does not exist', async () => {
        const zip = new AdmZip();
        const manifest = {
            format_version: 2,
            header: {
                name: 'Test Pack',
                uuid: 'test-uuid',
                version: [1, 0, 0],
                min_engine_version: [1, 16, 0]
            },
            modules: [{ type: 'data', uuid: 'module-uuid', version: [1, 0, 0] }]
        };
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
        zip.writeZip(tempUploadPath);

        const result = await backend.uploadPack(tempUploadPath, 'test.mcpack', 'behavior', 'non_existent_world');
        expect(result.success).toBe(false);
        expect(result.message).toContain("World 'non_existent_world' not found");
    });
});
