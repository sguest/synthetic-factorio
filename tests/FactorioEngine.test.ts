import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FactorioEngine, FactorioEngineOptions } from '../src/FactorioEngine';
import path from 'path';

describe('FactorioEngine', () => {
    const logMessages: string[] = [];

    beforeEach(() => {
        logMessages.length = 0;
    });

    const getEngine = (mods: string[], options: Partial<FactorioEngineOptions> = {}) => {
        return new FactorioEngine({
            ...options,
            mods,
            modDir: path.join(__dirname, 'mods'),
            logHandler: (message) => logMessages.push(message),
        });
    }

    it('should load basic data across all phases', () => {
        const engine = getEngine(['mod-a']);
        engine.runDataPhase();
        const data = engine.getRawData();
        expect(data.item['test-item']).toEqual({
            type: 'item',
            name: 'test-item',
            icon: '__mod-a__/graphics/test-item.png'
        });
        expect(data.item['test-item-update']).toEqual({
            type: 'item',
            name: 'test-item-update',
            icon: '__mod-a__/graphics/test-item-update.png'
        });
        expect(data.item['test-item-final']).toEqual({
            type: 'item',
            name: 'test-item-final',
            icon: '__mod-a__/graphics/test-item-final.png'
        });
    });

    describe('multi-mod loading', () => {
        it('should respect dependency order', () => {
            const engine = getEngine(['mod-c', 'mod-b']);

            engine.runDataPhase();

            expect(logMessages).toContain('Loading mod b');
            expect(logMessages).toContain('Loading mod c');
            expect(logMessages.indexOf('Loading mod b')).toBeLessThan(logMessages.indexOf('Loading mod c'));
        });

        it('should handle different mods loading the same path', () => {
            const engine = getEngine(['mod-c', 'mod-b']);

            engine.runDataPhase();

            expect(logMessages).toContain('Log file mod b');
            expect(logMessages).toContain('Log file mod c');
            expect(logMessages.indexOf('Log file mod c')).toBeLessThan(logMessages.indexOf('Log file mod b'));
        });
    });

    it('should handle loading lualib and vanilla mods by name', () => {
        const engine = getEngine(['mod-d']);

        engine.runDataPhase();

        expect(logMessages).toContain('loaded lualib-file');
        expect(logMessages).toContain('loaded base-file');
    });

    it('should populate "mods" global', () => {
        let engine = getEngine(['mod-a']);

        engine.runDataPhase();

        expect(logMessages).not.toContain('Detected mod d from mod a');

        engine = getEngine(['mod-a', 'mod-d']);
        engine.runDataPhase();

        expect(logMessages).toContain('Detected mod d from mod a');
    });

    it('should load settings', () => {
        const engine = getEngine(['mod-a']);

        engine.runSettingsPhase();

        engine.runDataPhase();

        expect(logMessages).toContain('string setting is str-value');
    });


    it('should accept overridden settings', () => {
        const engine = getEngine(['mod-a']);

        engine.runSettingsPhase();

        engine.setSettings({ startup: { 'test-string-setting': 'new-value' } })

        engine.runDataPhase();

        expect(logMessages).toContain('string setting is new-value');
    });

    describe('mod graph validation', () => {
        it('should fail when a dependency is missing', () => {
            expect(() => {
                const engine = getEngine(['mod-c']);
                engine.runDataPhase();
            }).toThrow();
        });

        it('should not fail when an ignored dependency is missing', () => {
            expect(() => {
                const engine = getEngine(['mod-c'], { ignoredDependencies: ['mod-b'] });
                engine.runDataPhase();
            }).not.toThrow();
        });

        it('should not throw on missing optional dependencies', () => {
            expect(() => {
                const engine = getEngine(['mod-d']);
                engine.runDataPhase();
            }).not.toThrow();
        });

        it('should throw when incompatible dependency found', () => {
            expect(() => {
                const engine = getEngine(['mod-d', 'mod-e']);
                engine.runDataPhase();
            }).toThrow();
        });

        it('should throw on circular dependency', () => {
            expect(() => {
                const engine = getEngine(['mod-e', 'mod-f']);
                engine.runDataPhase();
            }).toThrow();
        });
    });

    it('should preserve errors', () => {
        expect(() => {
            const engine = getEngine(['mod-error']);
            engine.runDataPhase();
        }).toThrow("attempt to index a nil value (global 'non_global')");
    });

    describe('control phase', () => {
        it('should run registered on_init functions', () => {
            const engine = getEngine(['mod-a']);
            engine.runControlPhase();
            engine.triggerInit();
            expect(logMessages).toContain('init from mod-a');
        });

        it('should run registered event handlers', () => {
            const engine = getEngine(['mod-a']);
            engine.runControlPhase();
            engine.triggerEvent('custom-event', { value: 'my-value' });
            expect(logMessages).toContain('custom event from mod-a with payload my-value');
        });

        it('should maintain storage between runs', () => {
            const engine = getEngine(['mod-b']);
            engine.runControlPhase();
            engine.triggerEvent('custom-event', {});
            engine.triggerEvent('custom-event', {});
            expect(logMessages).toContain('val is 1.0');
            expect(logMessages).toContain('val is 2.0');
        });

        it('should register and call remotes', () => {
            const engine = getEngine(['mod-b']);
            const remoteFn = vi.fn().mockReturnValue('some-value');
            engine.registerRemote('some-interface', 'some-function', remoteFn);
            engine.runControlPhase();
            engine.triggerInit();
            expect(logMessages).toContain('some-value from interface');
        });
    });
});