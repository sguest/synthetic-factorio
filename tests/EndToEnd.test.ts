import { describe, expect, it } from 'vitest';
import { ModManager } from '../src/ModManager';
import { FactorioEngine } from '../src/FactorioEngine';

describe('End-to-end test', () => {
    it('should download vanilla mods and SimpleSeablock, and run data and settings phase', async () => {
        const manager = new ModManager();
        await manager.installVanillaMods();
        await manager.installPortalMod('SimpleSeablock');

        const engine = new FactorioEngine({
            mods: ['base', 'space-age', 'quality', 'recycler', 'elevated-rails', 'SimpleSeablock']
        });
        engine.runSettingsPhase();
        engine.runDataPhase();

        const data = engine.getRawData();

        // A few arbitrary assertions from the various mods. The main purpose of this test is that it doesn't crash.
        expect(data.item.pumpjack).toEqual(expect.objectContaining({
            name: 'pumpjack',
            'place_result': 'pumpjack',
            type: 'item',
            subgroup: 'extraction-machine',
        }));

        expect(data.furnace.recycler).toEqual(expect.objectContaining({
            type: 'furnace',
            name: 'recycler',
            use_mirroring: true,
            source_inventory_size: 1,
        }));

        expect(data.quality.legendary).toEqual(expect.objectContaining({
            type: 'quality',
            name: 'legendary',
            level: 5,
            subgroup: 'qualities',
        }));

        expect(data.recipe['rail-support']).toEqual(expect.objectContaining({
            type: 'recipe',
            name: 'rail-support',
            enabled: false,
            results: { 1: {type: 'item', name: 'rail-support', amount: 1} },
        }));

        expect(data.planet.vulcanus).toEqual(expect.objectContaining({
            name: 'vulcanus',
            type: 'planet',
            'solar_power_in_space': 600,
            gravity_pull: 10,
        }));

        expect(data.plant['ashland-tree-plant']).toEqual(expect.objectContaining({
            name: 'ashland-tree-plant',
            corpse: 'ashland-lichen-tree-stump',
            max_health: 50,
        }));
    });
})