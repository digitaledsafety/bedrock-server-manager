import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Additional Defense and Safety Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getDiskUsage', () => {
        it('should safely return zero disk usage if path is null or undefined', async () => {
            const usage = await backend.getDiskUsage(null);
            expect(usage).toEqual({ total: 0, available: 0 });
        });

        it('should safely return zero disk usage if path does not exist', async () => {
            const usage = await backend.getDiskUsage('/non_existent_path_test_9999');
            expect(usage).toEqual({ total: 0, available: 0 });
        });
    });

    describe('writeServerProperties', () => {
        it('should throw explicit error if propertiesToWrite is null or not an object', async () => {
            backend.init({ serverDirectory: '/tmp/test_dir' });
            await expect(backend.writeServerProperties(null)).rejects.toThrow('Invalid server properties payload: Expected a non-null object.');
            await expect(backend.writeServerProperties("invalid")).rejects.toThrow('Invalid server properties payload: Expected a non-null object.');
        });
    });

    describe('deletePack', () => {
        it('should reject invalid or empty packId', async () => {
            backend.init({ serverDirectory: '/tmp/test_dir' });
            const res1 = await backend.deletePack('world1', 'behavior', '');
            expect(res1.success).toBe(false);
            expect(res1.message).toBe('Invalid pack ID.');

            const res2 = await backend.deletePack('world1', 'behavior', null);
            expect(res2.success).toBe(false);
            expect(res2.message).toBe('Invalid pack ID.');
        });
    });

    describe('sendServerCommand', () => {
        it('should reject commands containing newlines or control characters', async () => {
            const res1 = await backend.sendServerCommand('op player\nstop');
            expect(res1.success).toBe(false);
            expect(res1.message).toContain('Invalid command');

            const res2 = await backend.sendServerCommand('op player\r');
            expect(res2.success).toBe(false);
            expect(res2.message).toContain('Invalid command');

            const res3 = await backend.sendServerCommand('op \x00 player');
            expect(res3.success).toBe(false);
            expect(res3.message).toContain('Invalid command');
        });
    });
});
