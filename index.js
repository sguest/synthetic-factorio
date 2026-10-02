import { FactorioEngine } from "./src/FactorioEngine.js";
import { ModManager } from "./src/ModManager.js";
import { loadEnvFile } from 'node:process';
loadEnvFile();
var manager = new ModManager();
await manager.installVanillaMods();
await manager.installPortalMod('SimpleSeablock', { checkLatest: true });
await manager.installPortalMod('Krastorio2-spaced-out', { omitDependencies: ['Krastorio2Assets', 'Krastorio2MenuSimulations', 'k2so-assets'], checkLatest: true });
await manager.installPortalMod('space-is-fake', { omitDependencies: ['cr-commons'], checkLatest: true });
await manager.installPortalMod('any-planet-start', { checkLatest: true });
await manager.installPortalMod('bobores', { checkLatest: true });
var engine = new FactorioEngine({
    mods: ['base', 'space-age', 'quality', 'recycler', 'elevated-rails', 'SimpleSeablock', 'space-is-fake', 'Krastorio2-spaced-out', 'Krastorio2', 'flib', 'bobores', 'boblibrary'],
    ignoredDependencies: ['cr-commons', 'Krastorio2Assets', 'Krastorio2MenuSimulations', 'k2so-assets'],
    logHandler: () => { },
});
engine.runSettingsPhase();
engine.setSettings({ startup: { 'simple-seablock-disable-pumpjacks': false } });
engine.runDataPhase();
engine.runControlPhase(['SimpleSeablock']);
const createCalls = [];
const createEntity = (entity) => {
    createCalls.push(entity);
};
engine.triggerEvent(20, {
    position: { x: 0, y: 0 },
    surface: { name: 'nauvis', create_entity: createEntity },
});
console.log(createCalls);
console.log(engine.getRawData()['item']['pumpjack']);
