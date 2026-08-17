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

    it('should process .zip archive with multiple manifests as multi-pack', async () => {
        const zip = new AdmZip();
        const bpManifest = {
            format_version: 2,
            header: {
                name: 'Multi BP',
                uuid: 'bp-uuid-123',
                version: [1, 0, 0]
            },
            modules: [{ type: 'data', uuid: 'bp-mod-123', version: [1, 0, 0] }]
        };
        const rpManifest = {
            format_version: 2,
            header: {
                name: 'Multi RP',
                uuid: 'rp-uuid-456',
                version: [1, 0, 0]
            },
            modules: [{ type: 'resources', uuid: 'rp-mod-456', version: [1, 0, 0] }]
        };

        zip.addFile('bp/manifest.json', Buffer.from(JSON.stringify(bpManifest)));
        zip.addFile('rp/manifest.json', Buffer.from(JSON.stringify(rpManifest)));
        zip.writeZip(tempUploadPath);

        const result = await backend.uploadPack(tempUploadPath, 'multi_pack.zip', undefined, 'test_world');

        expect(result.success).toBe(true);
        expect(result.message).toContain('Multi-pack processing complete');

        const bpPath = path.join(serverDir, 'behavior_packs', 'Multi_BP');
        const rpPath = path.join(serverDir, 'resource_packs', 'Multi_RP');
        expect(fs.existsSync(bpPath)).toBe(true);
        expect(fs.existsSync(rpPath)).toBe(true);

        const bpJson = JSON.parse(fs.readFileSync(path.join(worldDir, 'world_behavior_packs.json'), 'utf8'));
        const rpJson = JSON.parse(fs.readFileSync(path.join(worldDir, 'world_resource_packs.json'), 'utf8'));
        expect(bpJson).toEqual(expect.arrayContaining([{ pack_id: 'bp-uuid-123', version: [1, 0, 0] }]));
        expect(rpJson).toEqual(expect.arrayContaining([{ pack_id: 'rp-uuid-456', version: [1, 0, 0] }]));
    });

    describe('uploadWorld naming collisions', () => {
        it('should append _counter instead of (counter) on naming collision to keep names valid', async () => {
            // Create a pre-existing world folder with name 'my_world'
            const existingWorldPath = path.join(serverDir, 'worlds', 'my_world');
            fs.mkdirSync(existingWorldPath, { recursive: true });

            // Prepare a world zip upload
            const zip = new AdmZip();
            zip.addFile('level.dat', Buffer.from('dummy level data'));
            zip.addFile('levelname.txt', Buffer.from('my_world'));
            zip.writeZip(tempUploadPath);

            // Upload first collision
            const result1 = await backend.uploadWorld(tempUploadPath, 'my_world.mcworld');
            expect(result1.success).toBe(true);
            expect(result1.worldName).toBe('my_world_1');
            expect(backend.isValidWorldName(result1.worldName)).toBe(true);

            // Create that directory to trigger next collision
            fs.mkdirSync(path.join(serverDir, 'worlds', 'my_world_1'), { recursive: true });

            // Upload second collision
            const result2 = await backend.uploadWorld(tempUploadPath, 'my_world.mcworld');
            expect(result2.success).toBe(true);
            expect(result2.worldName).toBe('my_world_2');
            expect(backend.isValidWorldName(result2.worldName)).toBe(true);
        });
    });

    describe('uploadWorld failures', () => {
        it('should clean up the target world directory if extraction fails', async () => {
            // Prepare a zip file that triggers a directory-file collision during extraction
            // to naturally throw an exception inside extractZipSubdir.
            const zip = new AdmZip();
            zip.addFile('level.dat', Buffer.from('dummy level data'));
            zip.addFile('levelname.txt', Buffer.from('my_failing_world'));

            // Adding a file named 'db'
            zip.addFile('db', Buffer.from('some file contents'));
            // Adding a nested file inside 'db', which will fail with ENOTDIR since 'db' is a file
            zip.addFile('db/nested_file.txt', Buffer.from('nested content'));

            zip.writeZip(tempUploadPath);

            const result = await backend.uploadWorld(tempUploadPath, 'my_failing_world.mcworld');
            expect(result.success).toBe(false);
            expect(result.message).toContain('ENOTDIR');

            // The target directory 'my_failing_world' should have been cleaned up and not exist
            const failingWorldPath = path.join(serverDir, 'worlds', 'my_failing_world');
            expect(fs.existsSync(failingWorldPath)).toBe(false);
        });
    });
});
