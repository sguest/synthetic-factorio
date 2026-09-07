import { describe, it } from 'vitest';
import { ModManager } from '../src/ModManager';
import { FactorioEngine } from '../src/FactorioEngine';

describe('End-to-end test', () => {
    it('should download vanilla mods and run data and settings phase', async () => {
        const manager = new ModManager();
        await manager.installVanillaMods();

        const engine = new FactorioEngine({
            mods: ['base', 'space-age', 'quality', 'recycler', 'elevated-rails']
        });
        engine.runSettingsPhase();
        engine.runDataPhase();
    });
})