import { jest } from '@jest/globals';
import request from 'supertest';
import * as fs from 'fs';
import path from 'path';
import os from 'os';

// This test uses a temporary directory for real FS operations to test pack management logic
describe('Pack Management Extended', () => {
    let testDir;
    let serverDir;
    let backend;
    let app;

    beforeAll(async () => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-'));
        serverDir = path.join(testDir, 'server');
        fs.mkdirSync(serverDir);
        fs.mkdirSync(path.join(serverDir, 'worlds'));
        fs.mkdirSync(path.join(serverDir, 'worlds', 'test_world'));
        fs.mkdirSync(path.join(serverDir, 'behavior_packs'));

        // Write a mock manifest and world_behavior_packs.json
        const packUuid = 'test-pack-uuid';
        const packDir = path.join(serverDir, 'behavior_packs', 'test_pack');
        fs.mkdirSync(packDir);
        fs.writeFileSync(path.join(packDir, 'manifest.json'), JSON.stringify({
            header: { uuid: packUuid, name: 'Test Pack', version: [1, 0, 0] }
        }));
        fs.writeFileSync(path.join(serverDir, 'worlds', 'test_world', 'world_behavior_packs.json'), JSON.stringify([
            { pack_id: packUuid, version: [1, 0, 0] }
        ]));

        // Set CLI args to override backend config when app.js calls readGlobalConfig
        process.argv = [
            'node', 'app.js',
            '--serverDirectory', serverDir,
            '--tempDirectory', path.join(testDir, 'temp'),
            '--backupDirectory', path.join(testDir, 'backup'),
            '--no-autoStart'
        ];

        // Import backend and initialize
        backend = await import('../minecraft_bedrock_installer_nodejs.js');

        const appModule = await import('../app.js');
        app = appModule.default;
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should list packs for a world', async () => {
        const res = await request(app).get('/api/worlds/test_world/packs');
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.behaviorPacks).toHaveLength(1);
        expect(res.body.behaviorPacks[0].name).toBe('Test Pack');
    });

    it('should delete a pack from a world', async () => {
        const packUuid = 'test-pack-uuid';
        const res = await request(app)
            .post('/api/delete-pack')
            .send({ worldName: 'test_world', packId: packUuid, packType: 'behavior' });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify it's gone from the file
        const packs = JSON.parse(fs.readFileSync(path.join(serverDir, 'worlds', 'test_world', 'world_behavior_packs.json'), 'utf8'));
        expect(packs).toHaveLength(0);
    });
});
