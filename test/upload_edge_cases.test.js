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

    describe('uploadWorld directory cleanup on failure', () => {
        it('should delete the target world directory if extraction/processing fails', async () => {
            // Write a corrupt zip file to trigger failure during AdmZip or processing
            fs.writeFileSync(tempUploadPath, 'not a zip content at all');

            const result = await backend.uploadWorld(tempUploadPath, 'failed_world.mcworld');
            expect(result.success).toBe(false);

            // Ensure directory with the resolved world name 'failed_world' does not exist
            const worldPath = path.join(serverDir, 'worlds', 'failed_world');
            expect(fs.existsSync(worldPath)).toBe(false);
        });
    });

    describe('low disk space warning on uploadWorld and uploadPack', () => {
        it('should log a WARNING during world upload if disk space is low', async () => {
            // Mock fs.promises.statfs to return low disk space
            const statfsSpy = jest.spyOn(fs.promises, 'statfs').mockResolvedValue({
                bsize: 1024,
                blocks: 1000 * 1024,
                bavail: 100 * 1024
            });

            // Capture output printed to stdout/stderr since log function writes to stdout & logStream
            const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

            const zip = new AdmZip();
            zip.addFile('level.dat', Buffer.from('dummy level data'));
            zip.addFile('levelname.txt', Buffer.from('low_space_world'));
            zip.writeZip(tempUploadPath);

            await backend.uploadWorld(tempUploadPath, 'low_space_world.mcworld');

            expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Low disk space on server drive during world upload'));

            statfsSpy.mockRestore();
            writeSpy.mockRestore();
        });

        it('should log a WARNING during pack upload if disk space is low', async () => {
            // Mock fs.promises.statfs to return low disk space
            const statfsSpy = jest.spyOn(fs.promises, 'statfs').mockResolvedValue({
                bsize: 1024,
                blocks: 1000 * 1024,
                bavail: 100 * 1024
            });

            // Capture output printed to stdout/stderr since log function writes to stdout & logStream
            const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

            const zip = new AdmZip();
            zip.writeZip(tempUploadPath); // Empty zip to trigger fast return/failure but disk check runs first

            await backend.uploadPack(tempUploadPath, 'test.mcpack', 'behavior', 'test_world');

            expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Low disk space on server drive during pack upload'));

            statfsSpy.mockRestore();
            writeSpy.mockRestore();
        });
    });
});
