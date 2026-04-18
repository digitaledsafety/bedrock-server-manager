import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Server Properties Newline Injection', () => {
    let tempDir;
    let serverDir;
    let propertiesPath;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newline-test-'));
        serverDir = path.join(tempDir, 'server');
        fs.mkdirSync(serverDir);
        propertiesPath = path.join(serverDir, 'server.properties');
        fs.writeFileSync(propertiesPath, 'server-name=Original\n');

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: path.join(tempDir, 'temp'),
            backupDirectory: path.join(tempDir, 'backup'),
            logLevel: 'ERROR'
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not allow newline injection in property values', async () => {
        const maliciousProperties = {
            'server-name': 'Malicious\nallow-cheats=true'
        };

        await backend.writeServerProperties(maliciousProperties);

        const content = fs.readFileSync(propertiesPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

        // If injection is successful, there will be a line exactly "allow-cheats=true"
        const hasInjection = lines.some(line => line.trim() === 'allow-cheats=true');

        // We want this to be false, but currently it might be true
        expect(hasInjection).toBe(false);
    });
});
